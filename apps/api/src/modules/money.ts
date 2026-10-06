import { Body, Controller, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import {
  addMonthsClamped,
  dayCloseSchema,
  daybookEntrySchema,
  daybookRejectSchema,
  DAYBOOK_REQUEST_STATUSES,
  diffDays,
  expenseCategorySchema,
  fundDepositSchema,
  fundSchema,
  fundTransferSchema,
  handoverSchema,
  investmentSchema,
  investorPayoutSchema,
  investorReturnRunSchema,
  investorSchema,
  todayIST,
} from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { BooksService } from '../common/books.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, assertOwned, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';
import { ProfitLossService } from './reports';

const bankSide = (mode: string) => (mode === 'CASH' ? 'cash' : 'bank');

// =====================================================================
// Funds
// =====================================================================
@Injectable()
export class FundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: Ctx, branchId?: string) {
    const funds = await this.prisma.fund.findMany({ where: branchScope(ctx, branchId), orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
    const [branches, outstanding, investors] = await Promise.all([
      this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.loan.groupBy({ by: ['fundId'], where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, _sum: { netDisbursed: true }, _count: true }),
      this.prisma.investor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    return funds.map((f) => ({
      ...f,
      branchName: branches.find((b) => b.id === f.branchId)?.name,
      investorName: investors.find((i) => i.id === f.investorId)?.name,
      activeLoans: outstanding.find((o) => o.fundId === f.id)?._count ?? 0,
      lentOut: outstanding.find((o) => o.fundId === f.id)?._sum.netDisbursed ?? 0,
    }));
  }

  async create(ctx: Ctx, input: z.infer<typeof fundSchema>) {
    assertBranch(ctx, input.branchId);
    if (!(await this.prisma.branch.findFirst({ where: { id: input.branchId, tenantId: ctx.tenantId } }))) throw notFound('Branch');
    if (await this.prisma.fund.findFirst({ where: { tenantId: ctx.tenantId, branchId: input.branchId, name: input.name } })) throw conflict('A fund with this name exists in the branch');
    await assertOwned(this.prisma.investor, ctx, input.investorId, 'Investor');
    const f = await this.prisma.fund.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Fund', f.id, undefined, input);
    return f;
  }

  async fund(ctx: Ctx, id: string) {
    const f = await this.prisma.fund.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!f) throw notFound('Fund');
    assertBranch(ctx, f.branchId);
    return f;
  }

  async txns(ctx: Ctx, id: string) {
    await this.fund(ctx, id);
    return this.prisma.fundTxn.findMany({ where: { fundId: id }, orderBy: { createdAt: 'desc' }, take: 500 });
  }

  /** Owner capital or a bank loan coming in. Investor money comes in through an investment instead. */
  async deposit(ctx: Ctx, id: string, input: z.infer<typeof fundDepositSchema>) {
    const f = await this.fund(ctx, id);
    if (f.sourceType === 'INVESTOR') throw bad('Add investor money through Investors so returns are tracked');
    await this.prisma.tx(async (tx) => {
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: id, amount: input.amount, type: 'DEPOSIT', date: input.date, note: input.note ?? undefined, userId: ctx.userId });
      await this.books.daybook(tx, {
        tenantId: ctx.tenantId,
        branchId: f.branchId,
        date: input.date,
        direction: 'IN',
        amount: input.amount,
        mode: input.mode,
        particulars: `${f.name}: ${input.note ?? 'capital in'}`,
        systemCategory: 'CAPITAL_IN',
        refType: 'Fund',
        refId: id,
        userId: ctx.userId,
      });
    });
    await this.audit.log(ctx, 'DEPOSIT', 'Fund', id, undefined, input);
    return this.fund(ctx, id);
  }

  /** Head office to branch, fund to fund, or a cash float to an agent for the day. */
  async transfer(ctx: Ctx, input: z.infer<typeof fundTransferSchema>) {
    const from = await this.fund(ctx, input.fromFundId);
    if (!input.toFundId === !input.toUserId) throw bad('Choose either a fund or an agent to transfer to');
    await this.prisma.tx(async (tx) => {
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: from.id, amount: -input.amount, type: input.toUserId ? 'FLOAT_OUT' : 'TRANSFER_OUT', date: input.date, note: input.note ?? undefined, userId: ctx.userId });
      if (input.toFundId) {
        const to = await tx.fund.findFirst({ where: { id: input.toFundId, tenantId: ctx.tenantId } });
        if (!to) throw notFound('Fund');
        if (to.id === from.id) throw bad('Choose a different fund');
        await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: to.id, amount: input.amount, type: 'TRANSFER_IN', date: input.date, note: input.note ?? undefined, userId: ctx.userId });
        if (to.branchId !== from.branchId) {
          const base = { tenantId: ctx.tenantId, date: input.date, amount: input.amount, mode: input.mode, refType: 'FundTransfer', userId: ctx.userId };
          await this.books.daybook(tx, { ...base, branchId: from.branchId, direction: 'OUT', particulars: `Transfer to ${to.name}`, systemCategory: 'FUND_TRANSFER_OUT' });
          await this.books.daybook(tx, { ...base, branchId: to.branchId, direction: 'IN', particulars: `Transfer from ${from.name}`, systemCategory: 'FUND_TRANSFER_IN' });
        }
      } else {
        const agent = await tx.user.findFirst({ where: { id: input.toUserId!, tenantId: ctx.tenantId, active: true } });
        if (!agent) throw notFound('Agent');
        // The float leaves the fund but stays the branch's cash: it comes back at handover.
        await tx.agentFloat.create({ data: { tenantId: ctx.tenantId, branchId: from.branchId, agentId: agent.id, fundId: from.id, date: input.date, amount: input.amount, createdById: ctx.userId } });
      }
    });
    await this.audit.log(ctx, 'TRANSFER', 'Fund', from.id, undefined, input);
    return { ok: true };
  }
}

@Controller('funds')
export class FundsController {
  constructor(private readonly svc: FundsService) {}
  @Get() @Perm('fund.manage', 'loan.disburse', 'report.view') list(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string) {
    return this.svc.list(ctx, branchId);
  }
  @Post() @Perm('fund.manage') create(@CurrentCtx() ctx: Ctx, @Body(V(fundSchema)) b: z.infer<typeof fundSchema>) {
    return this.svc.create(ctx, b);
  }
  @Get(':id/transactions') @Perm('fund.manage', 'report.view') txns(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.txns(ctx, id);
  }
  @Post(':id/deposit') @Perm('fund.manage') deposit(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(fundDepositSchema)) b: z.infer<typeof fundDepositSchema>) {
    return this.svc.deposit(ctx, id, b);
  }
  @Post('transfer') @Perm('fund.manage') transfer(@CurrentCtx() ctx: Ctx, @Body(V(fundTransferSchema)) b: z.infer<typeof fundTransferSchema>) {
    return this.svc.transfer(ctx, b);
  }
}

// =====================================================================
// Investors
// =====================================================================
@Injectable()
export class InvestorsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
    private readonly pl: ProfitLossService,
  ) {}

  async list(ctx: Ctx) {
    const investors = await this.prisma.investor.findMany({ where: { tenantId: ctx.tenantId }, include: { investments: { include: { txns: true } } }, orderBy: { name: 'asc' } });
    return investors.map(({ investments, ...i }) => ({ ...i, ...this.totals(investments.flatMap((x) => x.txns)), investments: investments.length }));
  }

  private totals(txns: { type: string; amount: number }[]) {
    const sum = (t: string) => txns.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
    const invested = sum('INVESTMENT');
    const withdrawn = sum('WITHDRAWAL');
    const returnsEarned = sum('RETURN_DUE');
    const paidOut = sum('PAYOUT');
    return { invested, withdrawn, principalBalance: invested - withdrawn, returnsEarned, paidOut, balanceDue: returnsEarned - paidOut };
  }

  async get(ctx: Ctx, id: string) {
    const i = await this.prisma.investor.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { investments: { include: { txns: { orderBy: { createdAt: 'asc' } } }, orderBy: { date: 'asc' } } } });
    if (!i) throw notFound('Investor');
    const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    return {
      ...i,
      ...this.totals(i.investments.flatMap((x) => x.txns)),
      investments: i.investments.map((inv) => ({ ...inv, branchName: branches.find((b) => b.id === inv.branchId)?.name, ...this.totals(inv.txns) })),
    };
  }

  async save(ctx: Ctx, input: z.infer<typeof investorSchema>, id?: string) {
    if (id) {
      const before = await this.prisma.investor.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!before) throw notFound('Investor');
      const u = await this.prisma.investor.update({ where: { id }, data: input });
      await this.audit.log(ctx, 'UPDATE', 'Investor', id, before, input);
      return u;
    }
    const c = await this.prisma.investor.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Investor', c.id, undefined, input);
    return c;
  }

  async invest(ctx: Ctx, input: z.infer<typeof investmentSchema>) {
    const investor = await this.prisma.investor.findFirst({ where: { id: input.investorId, tenantId: ctx.tenantId } });
    if (!investor) throw notFound('Investor');
    const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId } });
    if (!fund || fund.branchId !== input.branchId) throw bad('Choose a fund of the selected branch');
    if (input.maturityDate && input.maturityDate <= input.date) throw bad('Maturity date must be after the investment date');
    const inv = await this.prisma.tx(async (tx) => {
      const inv = await tx.investment.create({
        data: {
          tenantId: ctx.tenantId,
          investorId: investor.id,
          branchId: input.branchId,
          fundId: fund.id,
          amount: input.amount,
          date: input.date,
          returnType: input.returnType,
          returnRate: input.returnRate,
          payoutFrequencyMonths: input.payoutFrequencyMonths,
          maturityDate: input.maturityDate ?? null,
        },
      });
      await tx.investorTxn.create({ data: { tenantId: ctx.tenantId, investmentId: inv.id, investorId: investor.id, type: 'INVESTMENT', amount: input.amount, date: input.date, mode: input.mode, createdById: ctx.userId } });
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: fund.id, amount: input.amount, type: 'INVESTOR_IN', date: input.date, refId: inv.id, note: investor.name, userId: ctx.userId });
      await this.books.daybook(tx, { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date, direction: 'IN', amount: input.amount, mode: input.mode, particulars: `Investment from ${investor.name}`, systemCategory: 'INVESTOR_IN', refType: 'Investment', refId: inv.id, userId: ctx.userId });
      return inv;
    });
    await this.audit.log(ctx, 'INVEST', 'Investment', inv.id, undefined, input);
    return inv;
  }

  /**
   * Works out each active investment's return for a period. Fixed: principal balance × rate% × months.
   * Profit share: rate% of the branch's net profit before investor returns, split by each investor's share of the
   * branch's investor money. Running the same period twice does nothing.
   */
  async runReturns(ctx: Ctx, input: z.infer<typeof investorReturnRunSchema>) {
    if (input.periodEnd < input.periodStart) throw bad('Period end is before period start');
    const investments = await this.prisma.investment.findMany({
      where: { tenantId: ctx.tenantId, status: 'ACTIVE', date: { lte: input.periodEnd } },
      include: { txns: true, investor: true },
    });
    const created: { investmentId: string; investor: string; amount: number }[] = [];
    const profitCache = new Map<string, number>();
    for (const inv of investments) {
      if (inv.txns.some((t) => t.type === 'RETURN_DUE' && t.periodStart === input.periodStart && t.periodEnd === input.periodEnd)) continue;
      const principal = inv.txns.filter((t) => t.type === 'INVESTMENT').reduce((s, t) => s + t.amount, 0) - inv.txns.filter((t) => t.type === 'WITHDRAWAL').reduce((s, t) => s + t.amount, 0);
      if (principal <= 0) continue;
      const start = inv.date > input.periodStart ? inv.date : input.periodStart;
      const end = inv.maturityDate && inv.maturityDate < input.periodEnd ? inv.maturityDate : input.periodEnd;
      const days = diffDays(end, start) + 1;
      if (days <= 0) continue;
      let amount = 0;
      if (inv.returnType === 'FIXED_MONTHLY') {
        // Pro-rated by days using a 30-day month.
        amount = Math.round((principal * inv.returnRate * days) / 100 / 30);
      } else {
        if (!profitCache.has(inv.branchId)) {
          const pl = await this.pl.compute(ctx, { from: input.periodStart, to: input.periodEnd, branchId: inv.branchId }, { excludeInvestorReturns: true });
          profitCache.set(inv.branchId, pl.netProfit);
        }
        const profit = profitCache.get(inv.branchId)!;
        const branchInvestor = investments
          .filter((x) => x.branchId === inv.branchId && x.returnType === 'PROFIT_SHARE')
          .reduce((s, x) => s + x.txns.filter((t) => t.type === 'INVESTMENT').reduce((a, t) => a + t.amount, 0) - x.txns.filter((t) => t.type === 'WITHDRAWAL').reduce((a, t) => a + t.amount, 0), 0);
        amount = profit > 0 && branchInvestor > 0 ? Math.round(((profit * inv.returnRate) / 100) * (principal / branchInvestor)) : 0;
      }
      if (amount <= 0) continue;
      await this.prisma.investorTxn.create({
        data: { tenantId: ctx.tenantId, investmentId: inv.id, investorId: inv.investorId, type: 'RETURN_DUE', amount, date: input.periodEnd, periodStart: input.periodStart, periodEnd: input.periodEnd, createdById: ctx.userId },
      });
      created.push({ investmentId: inv.id, investor: inv.investor.name, amount });
    }
    await this.audit.log(ctx, 'RUN_RETURNS', 'Investment', null, undefined, { ...input, created });
    return { created, total: created.reduce((s, c) => s + c.amount, 0) };
  }

  /** A payout of returns or a withdrawal of principal; Tenant Admin approval is required (`investor.manage` + role). */
  async payout(ctx: Ctx, input: z.infer<typeof investorPayoutSchema>) {
    if (ctx.role !== 'TENANT_ADMIN') throw forbidden('Investor payouts are approved by the Tenant Admin');
    const inv = await this.prisma.investment.findFirst({ where: { id: input.investmentId, tenantId: ctx.tenantId }, include: { txns: true, investor: true } });
    if (!inv) throw notFound('Investment');
    const t = this.totals(inv.txns);
    if (input.kind === 'PAYOUT' && input.amount > t.balanceDue) throw bad('Payout is more than the returns due');
    if (input.kind === 'WITHDRAWAL' && input.amount > t.principalBalance) throw bad('Withdrawal is more than the invested balance');
    const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId } });
    if (!fund) throw notFound('Fund');
    await this.prisma.tx(async (tx) => {
      await tx.investorTxn.create({ data: { tenantId: ctx.tenantId, investmentId: inv.id, investorId: inv.investorId, type: input.kind, amount: input.amount, date: input.date, mode: input.mode, note: input.note, createdById: ctx.userId } });
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: fund.id, amount: -input.amount, type: 'INVESTOR_OUT', date: input.date, refId: inv.id, note: inv.investor.name, userId: ctx.userId });
      await this.books.daybook(tx, {
        tenantId: ctx.tenantId,
        branchId: fund.branchId,
        date: input.date,
        direction: 'OUT',
        amount: input.amount,
        mode: input.mode,
        particulars: `${input.kind === 'PAYOUT' ? 'Return paid to' : 'Principal returned to'} ${inv.investor.name}`,
        systemCategory: input.kind === 'PAYOUT' ? 'INVESTOR_PAYOUT' : 'INVESTOR_WITHDRAWAL',
        refType: 'Investment',
        refId: inv.id,
        userId: ctx.userId,
      });
      if (input.kind === 'WITHDRAWAL' && input.amount === t.principalBalance) await tx.investment.update({ where: { id: inv.id }, data: { status: 'CLOSED' } });
    });
    await this.audit.log(ctx, input.kind, 'Investment', inv.id, undefined, input);
    return this.get(ctx, inv.investorId);
  }

  /** Returns due, period by period, for investments whose next payout date has come. */
  async duePayouts(ctx: Ctx) {
    const today = todayIST();
    const invs = await this.prisma.investment.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, include: { txns: true, investor: true } });
    return invs
      .map((inv) => {
        const t = this.totals(inv.txns);
        const lastPayout = inv.txns.filter((x) => x.type === 'PAYOUT').map((x) => x.date).sort().pop() ?? inv.date;
        const next = addMonthsClamped(lastPayout, inv.payoutFrequencyMonths, Number(lastPayout.slice(8)));
        return { investmentId: inv.id, investor: inv.investor.name, balanceDue: t.balanceDue, nextPayout: next, due: next <= today && t.balanceDue > 0 };
      })
      .filter((x) => x.balanceDue > 0);
  }
}

@Controller('investors')
export class InvestorsController {
  constructor(private readonly svc: InvestorsService) {}
  @Get() @Perm('investor.manage') list(@CurrentCtx() ctx: Ctx) {
    return this.svc.list(ctx);
  }
  @Get('payouts-due') @Perm('investor.manage') due(@CurrentCtx() ctx: Ctx) {
    return this.svc.duePayouts(ctx);
  }
  @Get(':id') @Perm('investor.manage', 'pl.view') get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }
  @Post() @Perm('investor.manage') create(@CurrentCtx() ctx: Ctx, @Body(V(investorSchema)) b: z.infer<typeof investorSchema>) {
    return this.svc.save(ctx, b);
  }
  @Put(':id') @Perm('investor.manage') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(investorSchema)) b: z.infer<typeof investorSchema>) {
    return this.svc.save(ctx, b, id);
  }
  @Post('investments') @Perm('investor.manage') invest(@CurrentCtx() ctx: Ctx, @Body(V(investmentSchema)) b: z.infer<typeof investmentSchema>) {
    return this.svc.invest(ctx, b);
  }
  @Post('returns/run') @Perm('investor.manage') run(@CurrentCtx() ctx: Ctx, @Body(V(investorReturnRunSchema)) b: z.infer<typeof investorReturnRunSchema>) {
    return this.svc.runReturns(ctx, b);
  }
  @Post('payouts') @Perm('investor.manage') payout(@CurrentCtx() ctx: Ctx, @Body(V(investorPayoutSchema)) b: z.infer<typeof investorPayoutSchema>) {
    return this.svc.payout(ctx, b);
  }
}

// =====================================================================
// Day book and day close
// =====================================================================
@Injectable()
export class DaybookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
  ) {}

  categories(ctx: Ctx) {
    return this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
  }

  async createCategory(ctx: Ctx, input: z.infer<typeof expenseCategorySchema>) {
    if (await this.prisma.expenseCategory.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } })) throw conflict('Category exists');
    return this.prisma.expenseCategory.create({ data: { ...input, tenantId: ctx.tenantId } });
  }

  /** Balances carried into a date: from the last close before it, plus entries after that close. */
  async opening(tenantId: string, branchId: string, date: string) {
    const lastClose = await this.prisma.dayClose.findFirst({ where: { tenantId, branchId, date: { lt: date } }, orderBy: { date: 'desc' } });
    const since = lastClose?.date;
    const entries = await this.prisma.daybookEntry.findMany({ where: { tenantId, branchId, date: { lt: date, ...(since ? { gt: since } : {}) } } });
    const bal = { cash: lastClose?.closingCash ?? 0, bank: lastClose?.closingBank ?? 0 };
    for (const e of entries) bal[bankSide(e.mode)] += e.direction === 'IN' ? e.amount : -e.amount;
    return bal;
  }

  /** One branch's day (or a range) with opening and closing cash and bank. branchId omitted = all branches combined. */
  async view(ctx: Ctx, q: { branchId?: string; from: string; to?: string }) {
    const to = q.to ?? q.from;
    const scope = branchScope(ctx, q.branchId);
    const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId, ...(scope.branchId ? { id: scope.branchId as string | { in: string[] } } : {}) } });
    const opening = { cash: 0, bank: 0 };
    for (const b of branches) {
      const o = await this.opening(ctx.tenantId, b.id, q.from);
      opening.cash += o.cash;
      opening.bank += o.bank;
    }
    const [entries, categories, users, closes] = await Promise.all([
      this.prisma.daybookEntry.findMany({ where: { ...scope, date: { gte: q.from, lte: to } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId } }),
      this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.dayClose.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: branches.map((b) => b.id) }, date: { gte: q.from, lte: to } } }),
    ]);
    const reqIds = entries.filter((e) => e.refType === 'DaybookRequest' && e.refId).map((e) => e.refId!);
    const approvals = reqIds.length ? await this.prisma.daybookRequest.findMany({ where: { tenantId: ctx.tenantId, id: { in: reqIds } }, select: { id: true, decidedById: true } }) : [];
    const closing = { ...opening };
    let receipts = 0;
    let payments = 0;
    for (const e of entries) {
      closing[bankSide(e.mode)] += e.direction === 'IN' ? e.amount : -e.amount;
      if (e.direction === 'IN') receipts += e.amount;
      else payments += e.amount;
    }
    return {
      from: q.from,
      to,
      branches: branches.map((b) => ({ id: b.id, name: b.name })),
      opening,
      closing,
      receipts,
      payments,
      closed: closes,
      entries: entries.map((e) => ({
        ...e,
        categoryName: e.categoryId ? categories.find((c) => c.id === e.categoryId)?.name : null,
        createdByName: users.find((u) => u.id === e.createdById)?.name,
        approvedByName: users.find((u) => u.id === approvals.find((a) => a.id === e.refId)?.decidedById)?.name,
      })),
    };
  }

  /**
   * Adds a day book line. Someone with day book approval (the branch manager, the owner) posts it straight away;
   * anyone else sends it to the branch manager, and it reaches the day book only once approved.
   */
  async addEntry(ctx: Ctx, input: z.infer<typeof daybookEntrySchema>) {
    assertBranch(ctx, input.branchId);
    await assertOwned(this.prisma.branch, ctx, input.branchId, 'Branch');
    const cat = await this.prisma.expenseCategory.findFirst({ where: { id: input.categoryId, tenantId: ctx.tenantId } });
    if (!cat) throw notFound('Category');
    if (input.date > todayIST()) throw bad('Entries cannot be in the future');
    if (!ctx.permissions.has('daybook.approve')) {
      if (await this.prisma.dayClose.findUnique({ where: { branchId_date: { branchId: input.branchId, date: input.date } } })) throw bad('That day is already closed', 'errors.dayClosed');
      const r = await this.prisma.daybookRequest.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          date: input.date,
          direction: input.direction,
          categoryId: cat.id,
          amount: input.amount,
          mode: input.mode,
          particulars: input.particulars,
          billUrl: input.billUrl ?? null,
          requestedById: ctx.userId,
        },
      });
      await this.audit.log(ctx, 'CREATE', 'DaybookRequest', r.id, undefined, input);
      return { pending: true, request: r };
    }
    const e = await this.prisma.tx((tx) =>
      this.books.daybook(tx, {
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        date: input.date,
        direction: input.direction,
        amount: input.amount,
        mode: input.mode,
        particulars: input.particulars,
        categoryId: cat.id,
        source: 'MANUAL',
        userId: ctx.userId,
        billUrl: input.billUrl,
      }),
    );
    await this.audit.log(ctx, 'CREATE', 'DaybookEntry', e?.id, undefined, input);
    return e;
  }

  /**
   * Day book entries waiting for, or past, a branch manager's decision. Approvers and day book viewers see their
   * branches; everyone else sees only what they entered or were made responsible for.
   */
  async requests(ctx: Ctx, q: z.infer<typeof requestsQuery>) {
    const all = ctx.permissions.has('daybook.approve') || ctx.permissions.has('daybook.view');
    const rows = await this.prisma.daybookRequest.findMany({
      where: {
        ...branchScope(ctx, q.branchId),
        ...(q.status ? { status: q.status } : {}),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
        ...(all ? {} : { OR: [{ requestedById: ctx.userId }, { responsibleId: ctx.userId }] }),
      },
      orderBy: [{ status: 'desc' }, { date: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const [users, categories, branches] = await Promise.all([
      this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    const name = (id: string | null) => (id ? users.find((u) => u.id === id)?.name : undefined);
    return rows.map((r) => ({
      ...r,
      branchName: branches.find((b) => b.id === r.branchId)?.name,
      categoryName: categories.find((c) => c.id === r.categoryId)?.name,
      requestedByName: name(r.requestedById),
      decidedByName: name(r.decidedById),
      responsibleName: name(r.responsibleId),
    }));
  }

  private async pendingRequest(ctx: Ctx, id: string) {
    const r = await this.prisma.daybookRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw notFound('Day book entry');
    assertBranch(ctx, r.branchId);
    if (r.status !== 'PENDING') throw bad('This entry has already been decided');
    if (r.requestedById === ctx.userId) throw forbidden('You cannot approve or reject your own entry');
    return r;
  }

  /** Posts the entry to the day book on the day it was entered for, in the name of the person who entered it. */
  async approve(ctx: Ctx, id: string) {
    const r = await this.pendingRequest(ctx, id);
    const e = await this.prisma.tx(async (tx) => {
      // Claims the request first, so two managers approving at once cannot post it twice.
      const claimed = await tx.daybookRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: ctx.userId, decidedAt: new Date() } });
      if (!claimed.count) throw bad('This entry has already been decided');
      const entry = await this.books.daybook(tx, {
        tenantId: r.tenantId,
        branchId: r.branchId,
        date: r.date,
        direction: r.direction as 'IN' | 'OUT',
        amount: r.amount,
        mode: r.mode,
        particulars: r.particulars,
        categoryId: r.categoryId,
        source: 'MANUAL',
        refType: 'DaybookRequest',
        refId: r.id,
        userId: r.requestedById,
        billUrl: r.billUrl,
      });
      await tx.daybookRequest.update({ where: { id }, data: { entryId: entry?.id } });
      return entry;
    });
    await this.audit.log(ctx, 'APPROVE', 'DaybookRequest', id, r, { entryId: e?.id });
    return e;
  }

  /** Keeps the entry out of the day book and records why, and who must answer for the amount. */
  async reject(ctx: Ctx, id: string, input: z.infer<typeof daybookRejectSchema>) {
    const r = await this.pendingRequest(ctx, id);
    const responsibleId = input.responsibleId ?? r.requestedById;
    await assertOwned(this.prisma.user, ctx, responsibleId, 'Staff');
    const claimed = await this.prisma.daybookRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: ctx.userId, decidedAt: new Date(), reason: input.reason, responsibleId },
    });
    if (!claimed.count) throw bad('This entry has already been decided');
    await this.audit.log(ctx, 'REJECT', 'DaybookRequest', id, r, { ...input, responsibleId });
    return this.prisma.daybookRequest.findUnique({ where: { id } });
  }

  /** Locks a day. Blocked until every agent who collected cash that day has handed over. */
  async close(ctx: Ctx, input: z.infer<typeof dayCloseSchema>) {
    assertBranch(ctx, input.branchId);
    await assertOwned(this.prisma.branch, ctx, input.branchId, 'Branch');
    if (input.date > todayIST()) throw bad('Cannot close a future day');
    if (await this.prisma.dayClose.findUnique({ where: { branchId_date: input } })) throw bad('That day is already closed', 'errors.dayClosed');
    const agents = await this.prisma.collection.groupBy({ by: ['agentId'], where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date, reversedAt: null, mode: 'CASH' } });
    const floats = await this.prisma.agentFloat.groupBy({ by: ['agentId'], where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date } });
    const agentIds = [...new Set([...agents.map((a) => a.agentId), ...floats.map((f) => f.agentId)])];
    const handovers = await this.prisma.handover.findMany({ where: { tenantId: ctx.tenantId, agentId: { in: agentIds }, date: input.date } });
    const pending = agentIds.filter((a) => !handovers.some((h) => h.agentId === a));
    if (pending.length) {
      const names = await this.prisma.user.findMany({ where: { id: { in: pending } }, select: { name: true } });
      throw bad(`Waiting for cash handover from ${names.map((n) => n.name).join(', ')}`);
    }
    const waiting = await this.prisma.daybookRequest.count({ where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date, status: 'PENDING' } });
    if (waiting) throw bad(`Waiting for the branch manager to approve or reject ${waiting} day book ${waiting === 1 ? 'entry' : 'entries'}`, 'errors.daybookApprovalsPending');
    const day = await this.view(ctx, { branchId: input.branchId, from: input.date });
    const c = await this.prisma.dayClose.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        date: input.date,
        openingCash: day.opening.cash,
        openingBank: day.opening.bank,
        closingCash: day.closing.cash,
        closingBank: day.closing.bank,
        closedById: ctx.userId,
      },
    });
    await this.audit.log(ctx, 'CLOSE_DAY', 'DayClose', c.id, undefined, input);
    return c;
  }

  /** Reopens a closed day for a correction; Tenant Admin only, always logged. Later closes are reopened too. */
  async reopen(ctx: Ctx, input: z.infer<typeof dayCloseSchema>) {
    if (ctx.role !== 'TENANT_ADMIN') throw forbidden('Only the Tenant Admin can reopen a closed day');
    await assertOwned(this.prisma.branch, ctx, input.branchId, 'Branch');
    const closes = await this.prisma.dayClose.findMany({ where: { tenantId: ctx.tenantId, branchId: input.branchId, date: { gte: input.date } } });
    if (!closes.length) throw bad('That day is not closed');
    await this.prisma.dayClose.deleteMany({ where: { id: { in: closes.map((c) => c.id) } } });
    await this.audit.log(ctx, 'REOPEN_DAY', 'DayClose', null, closes, input);
    return { reopened: closes.map((c) => c.date) };
  }
}

const daybookQuery = z.object({ branchId: z.string().optional(), from: z.string(), to: z.string().optional() });
const requestsQuery = z.object({ branchId: z.string().optional(), status: z.enum(DAYBOOK_REQUEST_STATUSES).optional(), from: z.string().optional(), to: z.string().optional() });

@Controller('daybook')
export class DaybookController {
  constructor(private readonly svc: DaybookService) {}
  @Get() @Perm('daybook.view', 'daybook.manage') view(@CurrentCtx() ctx: Ctx, @Query(V(daybookQuery)) q: z.infer<typeof daybookQuery>) {
    return this.svc.view(ctx, q);
  }
  @Get('categories') @Perm('daybook.view', 'daybook.manage', 'daybook.request') categories(@CurrentCtx() ctx: Ctx) {
    return this.svc.categories(ctx);
  }
  @Post('categories') @Perm('daybook.manage') createCategory(@CurrentCtx() ctx: Ctx, @Body(V(expenseCategorySchema)) b: z.infer<typeof expenseCategorySchema>) {
    return this.svc.createCategory(ctx, b);
  }
  @Post('entries') @Perm('daybook.manage', 'daybook.request', 'daybook.approve') add(@CurrentCtx() ctx: Ctx, @Body(V(daybookEntrySchema)) b: z.infer<typeof daybookEntrySchema>) {
    return this.svc.addEntry(ctx, b);
  }
  @Get('requests') @Perm('daybook.view', 'daybook.manage', 'daybook.request', 'daybook.approve') requests(@CurrentCtx() ctx: Ctx, @Query(V(requestsQuery)) q: z.infer<typeof requestsQuery>) {
    return this.svc.requests(ctx, q);
  }
  @Post('requests/:id/approve') @Perm('daybook.approve') approve(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.approve(ctx, id);
  }
  @Post('requests/:id/reject') @Perm('daybook.approve') reject(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(daybookRejectSchema)) b: z.infer<typeof daybookRejectSchema>) {
    return this.svc.reject(ctx, id, b);
  }
  @Post('close') @Perm('daybook.manage') close(@CurrentCtx() ctx: Ctx, @Body(V(dayCloseSchema)) b: z.infer<typeof dayCloseSchema>) {
    return this.svc.close(ctx, b);
  }
  @Post('reopen') @Perm('daybook.manage') reopen(@CurrentCtx() ctx: Ctx, @Body(V(dayCloseSchema)) b: z.infer<typeof dayCloseSchema>) {
    return this.svc.reopen(ctx, b);
  }
}

// =====================================================================
// Cash handover
// =====================================================================
@Injectable()
export class HandoverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
  ) {}

  /** Expected cash per agent for a branch day: floats given plus cash collected. */
  async pending(ctx: Ctx, branchId: string, date: string) {
    assertBranch(ctx, branchId);
    const [cols, floats, handovers, users] = await Promise.all([
      this.prisma.collection.groupBy({ by: ['agentId', 'mode'], where: { tenantId: ctx.tenantId, branchId, date, reversedAt: null }, _sum: { amount: true }, _count: true }),
      this.prisma.agentFloat.groupBy({ by: ['agentId'], where: { tenantId: ctx.tenantId, branchId, date }, _sum: { amount: true } }),
      this.prisma.handover.findMany({ where: { tenantId: ctx.tenantId, branchId, date } }),
      this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    const agentIds = [...new Set([...cols.map((c) => c.agentId), ...floats.map((f) => f.agentId)])];
    return agentIds.map((agentId) => {
      const cash = cols.filter((c) => c.agentId === agentId && c.mode === 'CASH').reduce((s, c) => s + (c._sum.amount ?? 0), 0);
      const upi = cols.filter((c) => c.agentId === agentId && c.mode !== 'CASH').reduce((s, c) => s + (c._sum.amount ?? 0), 0);
      const float = floats.find((f) => f.agentId === agentId)?._sum.amount ?? 0;
      return {
        agentId,
        agentName: users.find((u) => u.id === agentId)?.name,
        cash,
        upi,
        float,
        expected: cash + float,
        handover: handovers.find((h) => h.agentId === agentId) ?? null,
      };
    });
  }

  async verify(ctx: Ctx, input: z.infer<typeof handoverSchema>) {
    if (input.agentId === ctx.userId) throw forbidden('Someone else must confirm your handover');
    const rows = await this.pending(ctx, input.branchId, input.date);
    const row = rows.find((r) => r.agentId === input.agentId);
    if (!row) throw bad('This agent has nothing to hand over for that day');
    if (row.handover) throw bad('Already handed over');
    const h = await this.prisma.tx(async (tx) => {
      const created = await tx.handover.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          agentId: input.agentId,
          date: input.date,
          expected: row.expected,
          received: input.received,
          difference: input.received - row.expected,
          note: input.note,
          verifiedById: ctx.userId,
        },
      });
      // The day's floats go back into the funds they came from.
      const floats = await tx.agentFloat.findMany({ where: { tenantId: ctx.tenantId, agentId: input.agentId, branchId: input.branchId, date: input.date } });
      for (const f of floats) {
        await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: f.fundId, amount: f.amount, type: 'FLOAT_RETURN', date: input.date, refId: created.id, userId: ctx.userId });
      }
      return created;
    });
    await this.audit.log(ctx, 'HANDOVER', 'Handover', h.id, undefined, h);
    return h;
  }

  async list(ctx: Ctx, q: { from?: string; to?: string; branchId?: string; differencesOnly?: boolean }) {
    const rows = await this.prisma.handover.findMany({
      where: {
        ...branchScope(ctx, q.branchId),
        ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
        ...(q.differencesOnly ? { difference: { not: 0 } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    return rows.map((r) => ({ ...r, agentName: users.find((u) => u.id === r.agentId)?.name, verifiedByName: users.find((u) => u.id === r.verifiedById)?.name }));
  }
}

@Controller('handovers')
export class HandoverController {
  constructor(private readonly svc: HandoverService) {}
  @Get('pending') @Perm('handover.verify') pending(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId: string, @Query('date') date?: string) {
    if (!branchId) throw bad('Choose a branch');
    return this.svc.pending(ctx, branchId, date ?? todayIST());
  }
  @Get() @Perm('handover.verify', 'report.view') list(@CurrentCtx() ctx: Ctx, @Query('from') from?: string, @Query('to') to?: string, @Query('branchId') branchId?: string, @Query('differencesOnly') d?: string) {
    return this.svc.list(ctx, { from, to, branchId, differencesOnly: d === 'true' });
  }
  @Post() @Perm('handover.verify') verify(@CurrentCtx() ctx: Ctx, @Body(V(handoverSchema)) b: z.infer<typeof handoverSchema>) {
    return this.svc.verify(ctx, b);
  }
}
