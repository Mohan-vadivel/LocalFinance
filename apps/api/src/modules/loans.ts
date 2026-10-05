import { Body, Controller, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import {
  defaultFirstDue,
  disburseSchema,
  forecloseSchema,
  formatINR,
  generateSchedule,
  loanDecisionSchema,
  loanRequestSchema,
  productSchema,
  summarize,
  todayIST,
  waivePenaltySchema,
  writeOffSchema,
  type LoanTerms,
} from '@localfinance/shared';
import type { Loan, LoanProduct, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { BooksService, positionOf } from '../common/books.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, forbidden, notFound, rule } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';
import { CollectionsService } from './collections';

const termsOf = (l: Pick<Loan, 'principal' | 'frequency' | 'tenure' | 'interestMethod' | 'interestRate' | 'feePercent' | 'feeFlat'>): LoanTerms => ({
  principal: l.principal,
  frequency: l.frequency as LoanTerms['frequency'],
  tenure: l.tenure,
  interestMethod: l.interestMethod as LoanTerms['interestMethod'],
  interestRate: l.interestRate,
  feePercent: l.feePercent,
  feeFlat: l.feeFlat,
});

@Injectable()
export class LoansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
    private readonly collections: CollectionsService,
  ) {}

  // ---------- Products ----------
  products(ctx: Ctx, all = false) {
    return this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId, ...(all ? {} : { active: true }) }, orderBy: { name: 'asc' } });
  }

  async saveProduct(ctx: Ctx, input: z.infer<typeof productSchema>, id?: string) {
    if (input.minAmount > input.maxAmount) throw bad('Minimum amount is more than the maximum');
    rule(() => summarize({ ...input, principal: input.minAmount })); // validates fees against the smallest loan
    if (id) {
      const p = await this.prisma.loanProduct.findFirst({ where: { id, tenantId: ctx.tenantId } });
      if (!p) throw notFound('Product');
      const u = await this.prisma.loanProduct.update({ where: { id }, data: input });
      await this.audit.log(ctx, 'UPDATE', 'LoanProduct', id, p, input);
      return u;
    }
    if (await this.prisma.loanProduct.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } })) throw conflict('A product with this name exists');
    const p = await this.prisma.loanProduct.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'LoanProduct', p.id, undefined, input);
    return p;
  }

  // ---------- Queries ----------
  async list(ctx: Ctx, q: { status?: string; stage?: string; branchId?: string; customerId?: string; q?: string; page?: number; queue?: string }) {
    const take = 50;
    const page = Math.max(1, q.page ?? 1);
    const where: Prisma.LoanWhereInput = {
      ...branchScope(ctx, q.branchId),
      ...(q.status ? { status: { in: q.status.split(',') } } : {}),
      ...(q.stage ? { stage: q.stage } : {}),
      ...(q.customerId ? { customerId: q.customerId } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { legacyNo: { equals: q.q.trim(), mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }, { customer: { phone: { contains: q.q } } }] } : {}),
    };
    if (q.queue === 'approvals') {
      // What this user can act on: managers see branch stage, Tenant Admin sees everything waiting.
      where.status = 'REQUESTED';
      if (ctx.role !== 'TENANT_ADMIN') where.stage = 'BRANCH';
    }
    if (q.queue === 'mine') where.requestedById = ctx.userId;
    const [rows, total] = await Promise.all([
      this.prisma.loan.findMany({ where, include: { customer: { select: { name: true, code: true, phone: true } }, instalments: true }, orderBy: { createdAt: 'desc' }, take, skip: (page - 1) * take }),
      this.prisma.loan.count({ where }),
    ]);
    const products = await this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    return {
      total,
      page,
      pageSize: take,
      rows: rows.map(({ instalments, ...l }) => ({
        ...l,
        productName: products.find((p) => p.id === l.productId)?.name,
        position: l.status === 'ACTIVE' ? positionOf({ ...l, instalments }) : null,
      })),
    };
  }

  async get(ctx: Ctx, id: string) {
    const l = await this.prisma.loan.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { instalments: { orderBy: { seq: 'asc' } }, approvals: { orderBy: { createdAt: 'asc' } }, customer: true },
    });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    const [collections, ledger, users, product, fund] = await Promise.all([
      this.prisma.collection.findMany({ where: { loanId: id }, orderBy: { collectedAt: 'desc' } }),
      this.prisma.ledgerEntry.findMany({ where: { loanId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.loanProduct.findUnique({ where: { id: l.productId } }),
      l.fundId ? this.prisma.fund.findUnique({ where: { id: l.fundId } }) : null,
    ]);
    const name = (uid?: string | null) => users.find((u) => u.id === uid)?.name;
    return {
      ...l,
      productName: product?.name,
      fundName: fund?.name,
      requestedByName: name(l.requestedById),
      approvedByName: name(l.approvedById),
      approvals: l.approvals.map((a) => ({ ...a, userName: name(a.userId) })),
      position: l.status === 'ACTIVE' ? positionOf(l) : null,
      summary: summarize(termsOf(l)),
      collections: collections.map((c) => ({ ...c, agentName: name(c.agentId) })),
      ledger,
    };
  }

  /** Shows the schedule and cash to customer before a request is raised. */
  async preview(ctx: Ctx, input: { productId: string; principal: number; disbursedOn?: string }) {
    const product = await this.product(ctx, input.productId);
    const terms = { ...termsOf({ ...product, principal: input.principal }) };
    const start = input.disbursedOn ?? todayIST();
    return rule(() => ({
      summary: summarize(terms),
      schedule: generateSchedule(terms, defaultFirstDue(start, terms.frequency), ctx.settings),
    }));
  }

  private async product(ctx: Ctx, id: string): Promise<LoanProduct> {
    const p = await this.prisma.loanProduct.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!p) throw notFound('Product');
    return p;
  }

  // ---------- Request and approval ----------
  async request(ctx: Ctx, input: z.infer<typeof loanRequestSchema>) {
    if (input.clientRef) {
      const existing = await this.prisma.loan.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
      if (existing) return existing;
    }
    const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
    if (!customer) throw notFound('Customer');
    assertBranch(ctx, customer.branchId);
    if (customer.status !== 'ACTIVE') throw bad('This customer is blacklisted or closed');
    const product = await this.product(ctx, input.productId);
    if (!product.active) throw bad('This product is no longer offered');
    if (input.principal < product.minAmount || input.principal > product.maxAmount) {
      throw bad(`Amount must be between ${formatINR(product.minAmount)} and ${formatINR(product.maxAmount)}`);
    }
    rule(() => summarize(termsOf({ ...product, principal: input.principal })));
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if ((await this.prisma.loan.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } })) >= t.maxActiveLoans) {
      throw bad(`Your plan allows ${t.maxActiveLoans} active loans`);
    }
    const branch = await this.prisma.branch.findUniqueOrThrow({ where: { id: customer.branchId } });
    const loan = await this.prisma.tx(async (tx) => {
      const seq = await this.books.nextNumber(tx, ctx.tenantId, 'loanSeq');
      const l = await tx.loan.create({
        data: {
          tenantId: ctx.tenantId,
          branchId: customer.branchId,
          customerId: customer.id,
          productId: product.id,
          number: `${branch.code}-${String(seq).padStart(6, '0')}`,
          principal: input.principal,
          frequency: product.frequency,
          tenure: product.tenure,
          interestMethod: product.interestMethod,
          interestRate: product.interestRate,
          feePercent: product.feePercent,
          feeFlat: product.feeFlat,
          penaltyType: product.penaltyType,
          penaltyValue: product.penaltyValue,
          graceDays: product.graceDays,
          purpose: input.purpose,
          notes: input.notes,
          requestedById: ctx.userId,
          clientRef: input.clientRef,
        },
      });
      await tx.loanApproval.create({ data: { loanId: l.id, step: 'REQUEST', userId: ctx.userId, decision: 'REQUEST', reason: input.notes ?? null } });
      return l;
    });
    await this.audit.log(ctx, 'REQUEST', 'Loan', loan.id, undefined, input);
    return loan;
  }

  /** The requester fixes a sent-back request and resubmits it. */
  async resubmit(ctx: Ctx, id: string, input: z.infer<typeof loanRequestSchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    if (!['SENT_BACK', 'REQUESTED'].includes(l.status)) throw bad('Only open requests can be changed');
    const product = await this.product(ctx, input.productId);
    if (input.principal < product.minAmount || input.principal > product.maxAmount) throw bad('Amount is outside the product range');
    const u = await this.prisma.tx(async (tx) => {
      const loan = await tx.loan.update({
        where: { id },
        data: {
          productId: product.id,
          principal: input.principal,
          frequency: product.frequency,
          tenure: product.tenure,
          interestMethod: product.interestMethod,
          interestRate: product.interestRate,
          feePercent: product.feePercent,
          feeFlat: product.feeFlat,
          penaltyType: product.penaltyType,
          penaltyValue: product.penaltyValue,
          graceDays: product.graceDays,
          purpose: input.purpose,
          notes: input.notes,
          status: 'REQUESTED',
          stage: 'BRANCH',
        },
      });
      await tx.loanApproval.create({ data: { loanId: id, step: 'REQUEST', userId: ctx.userId, decision: 'RESUBMIT' } });
      return loan;
    });
    await this.audit.log(ctx, 'RESUBMIT', 'Loan', id, l, input);
    return u;
  }

  async decide(ctx: Ctx, id: string, input: z.infer<typeof loanDecisionSchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    if (l.status !== 'REQUESTED') throw bad('This request is not waiting for a decision');
    if (l.requestedById === ctx.userId && ctx.role !== 'TENANT_ADMIN') throw forbidden('You cannot approve your own request');
    if (l.stage === 'ADMIN' && ctx.role !== 'TENANT_ADMIN') throw forbidden('This request is waiting for the Tenant Admin');
    if (input.decision !== 'APPROVE' && !input.reason) throw bad('Give a reason');

    const isAdmin = ctx.role === 'TENANT_ADMIN';
    const step = l.stage;
    let data: Prisma.LoanUpdateInput;
    let decision: string = input.decision;
    if (input.decision === 'APPROVE') {
      if (isAdmin || l.principal <= ctx.approvalLimit) {
        data = { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() };
      } else {
        // Above this manager's limit: their approval is a recommendation and the request goes to the Tenant Admin.
        data = { stage: 'ADMIN' };
        decision = 'RECOMMEND';
      }
    } else if (input.decision === 'REJECT') {
      data = { status: 'REJECTED' };
    } else {
      data = { status: 'SENT_BACK', stage: 'BRANCH' };
    }
    const u = await this.prisma.tx(async (tx) => {
      await tx.loanApproval.create({ data: { loanId: id, step, userId: ctx.userId, decision, reason: input.reason ?? null } });
      return tx.loan.update({ where: { id }, data });
    });
    await this.audit.log(ctx, decision, 'Loan', id, { status: l.status, stage: l.stage }, input);
    return { ...u, escalated: decision === 'RECOMMEND' };
  }

  // ---------- Disbursement ----------
  async disburse(ctx: Ctx, id: string, input: z.infer<typeof disburseSchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { customer: true } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    if (l.status !== 'APPROVED') throw bad('Only approved loans can be disbursed');
    const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId, active: true } });
    if (!fund) throw notFound('Fund');
    if (fund.branchId !== l.branchId) throw bad('Use a fund of the loan\'s branch');
    const terms = termsOf(l);
    const summary = rule(() => summarize(terms));
    const firstDue = input.firstDueDate ?? defaultFirstDue(input.disbursedOn, terms.frequency);
    if (firstDue <= input.disbursedOn) throw bad('First due date must be after the disbursement date');
    const schedule = rule(() => generateSchedule(terms, firstDue, ctx.settings));

    await this.prisma.tx(async (tx) => {
      // Fund pays out the cash the customer actually receives.
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: fund.id, amount: -summary.netDisbursed, type: 'DISBURSEMENT', date: input.disbursedOn, refId: l.id, note: l.number, userId: ctx.userId });
      const updated = await tx.loan.updateMany({
        where: { id, status: 'APPROVED' },
        data: {
          status: 'ACTIVE',
          disbursedOn: input.disbursedOn,
          firstDueDate: firstDue,
          fundId: fund.id,
          disburseMode: input.mode,
          fee: summary.fee,
          upfrontInterest: summary.upfrontInterest,
          netDisbursed: summary.netDisbursed,
          totalInterest: summary.totalInterest,
        },
      });
      if (updated.count !== 1) throw conflict('This loan was already disbursed');
      await tx.instalment.createMany({
        data: schedule.map((r) => ({ tenantId: ctx.tenantId, loanId: id, seq: r.seq, dueDate: r.dueDate, principalDue: r.principalDue, interestDue: r.interestDue })),
      });
      const owed = schedule.reduce((s, r) => s + r.totalDue, 0);
      await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: id, customerId: l.customerId, date: input.disbursedOn, type: 'DISBURSEMENT', description: `Loan ${l.number} disbursed (${formatINR(summary.netDisbursed)} paid out)`, debit: owed });
      const dbBase = { tenantId: ctx.tenantId, branchId: l.branchId, date: input.disbursedOn, mode: input.mode, refType: 'Loan', refId: id, userId: ctx.userId };
      await this.books.daybook(tx, { ...dbBase, direction: 'OUT', amount: l.principal, particulars: `Loan ${l.number} to ${l.customer.name}`, systemCategory: 'LOAN_DISBURSEMENT' });
      await this.books.daybook(tx, { ...dbBase, direction: 'IN', amount: summary.fee, particulars: `Processing fee ${l.number}`, systemCategory: 'PROCESSING_FEE' });
      await this.books.daybook(tx, { ...dbBase, direction: 'IN', amount: summary.upfrontInterest, particulars: `Upfront interest ${l.number}`, systemCategory: 'UPFRONT_INTEREST' });
    });
    await this.audit.log(ctx, 'DISBURSE', 'Loan', id, undefined, input);
    const first = schedule[0];
    void this.notify
      .sms(ctx.tenantId, l.customer.phone, l.customer.language, 'sms.disbursement', {
        business: ctx.tenantName,
        loan: l.number,
        amount: formatINR(l.principal),
        date: input.disbursedOn,
        instalment: formatINR(first.totalDue),
        frequency: l.frequency.toLowerCase(),
      }, ctx.settings.smsTemplates?.disbursement)
      .catch(() => undefined);
    return this.get(ctx, id);
  }

  // ---------- After disbursement ----------
  async foreclose(ctx: Ctx, id: string, input: z.infer<typeof forecloseSchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    const pos = positionOf(l, input.date);
    const expected = pos.totalOutstanding - input.interestWaived;
    if (input.interestWaived > pos.interestOutstanding) throw bad('Waiver is more than the unpaid interest');
    if (input.amount !== expected) throw bad(`Foreclosure amount must be ${formatINR(expected)}`);
    const res = await this.prisma.tx((tx) =>
      this.collections.applyPayment(tx, ctx, id, {
        amount: input.amount,
        mode: input.mode,
        date: input.date,
        collectedAt: new Date(),
        clientRef: `foreclose-${randomUUID()}`,
        note: input.reason,
        kind: 'FORECLOSURE',
        waiveInterest: input.interestWaived,
      }),
    );
    await this.audit.log(ctx, 'FORECLOSE', 'Loan', id, undefined, input);
    return { ...res, loan: await this.get(ctx, id) };
  }

  async writeOff(ctx: Ctx, id: string, input: z.infer<typeof writeOffSchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    if (l.status !== 'ACTIVE') throw bad('Only active loans can be written off');
    const pos = positionOf(l, input.date);
    await this.prisma.tx(async (tx) => {
      await tx.loan.update({ where: { id }, data: { status: 'WRITTEN_OFF', writtenOffAmount: pos.principalOutstanding, closedOn: input.date } });
      await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: id, customerId: l.customerId, date: input.date, type: 'WRITE_OFF', description: `Written off: ${input.reason}`, credit: pos.principalOutstanding + pos.interestOutstanding });
    });
    await this.audit.log(ctx, 'WRITE_OFF', 'Loan', id, pos, input);
    return this.get(ctx, id);
  }

  async waivePenalty(ctx: Ctx, id: string, input: z.infer<typeof waivePenaltySchema>) {
    const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
    if (!l) throw notFound('Loan');
    assertBranch(ctx, l.branchId);
    const pos = positionOf(l);
    if (input.amount > pos.penaltyOutstanding) throw bad(`Only ${formatINR(pos.penaltyOutstanding)} penalty is outstanding`);
    const closes = pos.principalOutstanding + pos.interestOutstanding === 0 && input.amount === pos.penaltyOutstanding;
    await this.prisma.loan.update({ where: { id }, data: { penaltyWaived: { increment: input.amount }, ...(closes ? { status: 'CLOSED', closedOn: todayIST() } : {}) } });
    await this.audit.log(ctx, 'WAIVE_PENALTY', 'Loan', id, undefined, input);
    return this.get(ctx, id);
  }
}

const listQuery = z.object({
  status: z.string().optional(),
  stage: z.string().optional(),
  branchId: z.string().optional(),
  customerId: z.string().optional(),
  q: z.string().optional(),
  queue: z.enum(['approvals', 'mine']).optional(),
  page: z.coerce.number().int().positive().optional(),
});
const previewSchema = z.object({ productId: z.string(), principal: z.number().int().positive(), disbursedOn: z.string().optional() });

@Controller()
export class LoansController {
  constructor(private readonly svc: LoansService) {}

  @Get('products') products(@CurrentCtx() ctx: Ctx, @Query('all') all?: string) {
    return this.svc.products(ctx, all === 'true');
  }
  @Post('products') @Perm('settings.manage') createProduct(@CurrentCtx() ctx: Ctx, @Body(V(productSchema)) b: z.infer<typeof productSchema>) {
    return this.svc.saveProduct(ctx, b);
  }
  @Put('products/:id') @Perm('settings.manage') updateProduct(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(productSchema)) b: z.infer<typeof productSchema>) {
    return this.svc.saveProduct(ctx, b, id);
  }

  @Get('loans') @Perm('customer.view', 'loan.request', 'loan.approve', 'report.view') list(@CurrentCtx() ctx: Ctx, @Query(V(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, q);
  }
  @Get('loans/:id') @Perm('customer.view', 'loan.request', 'loan.approve', 'collection.record') get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }
  @Post('loans/preview') @Perm('loan.request', 'loan.approve') preview(@CurrentCtx() ctx: Ctx, @Body(V(previewSchema)) b: z.infer<typeof previewSchema>) {
    return this.svc.preview(ctx, b);
  }
  @Post('loans') @Perm('loan.request') request(@CurrentCtx() ctx: Ctx, @Body(V(loanRequestSchema)) b: z.infer<typeof loanRequestSchema>) {
    return this.svc.request(ctx, b);
  }
  @Put('loans/:id') @Perm('loan.request') resubmit(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(loanRequestSchema)) b: z.infer<typeof loanRequestSchema>) {
    return this.svc.resubmit(ctx, id, b);
  }
  @Post('loans/:id/decision') @Perm('loan.approve') decide(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(loanDecisionSchema)) b: z.infer<typeof loanDecisionSchema>) {
    return this.svc.decide(ctx, id, b);
  }
  @Post('loans/:id/disburse') @Perm('loan.disburse') disburse(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(disburseSchema)) b: z.infer<typeof disburseSchema>) {
    return this.svc.disburse(ctx, id, b);
  }
  @Post('loans/:id/foreclose') @Perm('loan.manage') foreclose(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(forecloseSchema)) b: z.infer<typeof forecloseSchema>) {
    return this.svc.foreclose(ctx, id, b);
  }
  @Post('loans/:id/write-off') @Perm('loan.manage') writeOff(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(writeOffSchema)) b: z.infer<typeof writeOffSchema>) {
    return this.svc.writeOff(ctx, id, b);
  }
  @Post('loans/:id/waive-penalty') @Perm('loan.manage') waive(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(waivePenaltySchema)) b: z.infer<typeof waivePenaltySchema>) {
    return this.svc.waivePenalty(ctx, id, b);
  }
}
