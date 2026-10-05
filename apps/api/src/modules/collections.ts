import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  allocatePayment,
  collectionSchema,
  distanceMetres,
  formatINR,
  penaltyCharged,
  reverseCollectionSchema,
  syncSchema,
  todayIST,
  visitSchema,
} from '@localfinance/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { BooksService, penaltyRule, positionOf, toState } from '../common/books.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, forbidden, notFound, rule } from '../common/errors';
import { NotifyService } from '../common/notify.service';
import { PrismaService, type Tx } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

type CollectionInput = z.infer<typeof collectionSchema>;

const istDate = (d: Date) => todayIST(d);

@Injectable()
export class CollectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
    private readonly notify: NotifyService,
  ) {}

  /**
   * Applies money to a loan inside a transaction: allocation, instalments, penalty, ledger, fund, day book.
   * `waiveInterest` (foreclosure) forgives that much future interest first.
   */
  async applyPayment(
    tx: Tx,
    ctx: Ctx,
    loanId: string,
    p: { amount: number; mode: string; date: string; collectedAt: Date; clientRef: string; upiRef?: string | null; lat?: number | null; lng?: number | null; note?: string | null; kind?: 'INSTALMENT' | 'FORECLOSURE'; waiveInterest?: number; agentId?: string },
  ) {
    const loan = await tx.loan.findFirst({ where: { id: loanId, tenantId: ctx.tenantId }, include: { instalments: { orderBy: { seq: 'asc' } }, customer: true } });
    if (!loan) throw notFound('Loan');
    assertBranch(ctx, loan.branchId);
    if (loan.status !== 'ACTIVE') throw bad('Only active loans can take payments');

    let instalments = loan.instalments;
    if (p.waiveInterest) {
      // Forgive unpaid interest from the last instalment backwards.
      let left = p.waiveInterest;
      for (const ins of [...instalments].reverse()) {
        if (left <= 0) break;
        const unpaid = ins.interestDue - ins.interestPaid;
        const cut = Math.min(unpaid, left);
        if (cut > 0) {
          await tx.instalment.update({ where: { id: ins.id }, data: { interestDue: { decrement: cut } } });
          left -= cut;
        }
      }
      if (left > 0) throw bad('Interest waiver is more than the unpaid interest');
      await tx.loan.update({ where: { id: loan.id }, data: { interestWaived: { increment: p.waiveInterest } } });
      await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: loan.id, customerId: loan.customerId, date: p.date, type: 'WAIVER', description: 'Interest waived on early closure', credit: p.waiveInterest });
      instalments = await tx.instalment.findMany({ where: { loanId: loan.id }, orderBy: { seq: 'asc' } });
    }

    const states = instalments.map(toState);
    const charged = penaltyCharged(states, penaltyRule(loan), p.date);
    const penaltyOutstanding = Math.max(0, charged - loan.penaltyPaid - loan.penaltyWaived);
    const alloc = rule(() => allocatePayment(p.amount, states, penaltyOutstanding, ctx.settings.paymentOrder), 'collection.tooMuch');

    for (const a of alloc.perInstalment) {
      await tx.instalment.update({
        where: { id: a.id },
        data: { principalPaid: { increment: a.principal }, interestPaid: { increment: a.interest }, ...(a.fullyPaid ? { paidOn: p.date } : {}) },
      });
    }

    const customer = loan.customer;
    let distanceM: number | null = null;
    if (p.lat != null && p.lng != null && customer.lat != null && customer.lng != null) {
      distanceM = Math.round(distanceMetres({ lat: p.lat, lng: p.lng }, { lat: customer.lat, lng: customer.lng }));
    }
    const flagged = distanceM != null && ctx.settings.geoCheckMetres > 0 && distanceM > ctx.settings.geoCheckMetres;
    const receiptNo = await this.books.receiptNo(tx, ctx.tenantId);
    const collection = await tx.collection.create({
      data: {
        tenantId: ctx.tenantId,
        branchId: loan.branchId,
        loanId: loan.id,
        customerId: loan.customerId,
        agentId: p.agentId ?? ctx.userId,
        routeId: customer.routeId,
        amount: p.amount,
        principal: alloc.principal,
        interest: alloc.interest,
        penalty: alloc.penalty,
        mode: p.mode,
        upiRef: p.upiRef ?? null,
        date: p.date,
        collectedAt: p.collectedAt,
        lat: p.lat ?? null,
        lng: p.lng ?? null,
        distanceM,
        flagged,
        receiptNo,
        note: p.note ?? null,
        kind: p.kind ?? 'INSTALMENT',
        clientRef: p.clientRef,
        allocations: { create: alloc.perInstalment.map((a) => ({ instalmentId: a.id, principal: a.principal, interest: a.interest })) },
      },
    });

    if (alloc.penalty > 0) {
      await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: loan.id, customerId: loan.customerId, date: p.date, type: 'PENALTY', description: 'Late payment penalty', debit: alloc.penalty, refId: collection.id });
    }
    await this.books.ledger(tx, {
      tenantId: ctx.tenantId,
      loanId: loan.id,
      customerId: loan.customerId,
      date: p.date,
      type: 'INSTALMENT',
      description: `Payment ${receiptNo} (${p.mode})`,
      credit: p.amount,
      refId: collection.id,
    });

    const after = await tx.instalment.findMany({ where: { loanId: loan.id } });
    const penaltyPaid = loan.penaltyPaid + alloc.penalty;
    const remaining = after.reduce((s, i) => s + i.principalDue + i.interestDue - i.principalPaid - i.interestPaid, 0);
    const penaltyLeft = Math.max(0, penaltyCharged(after.map(toState), penaltyRule(loan), p.date) - penaltyPaid - loan.penaltyWaived);
    const closes = remaining === 0 && penaltyLeft === 0;
    await tx.loan.update({
      where: { id: loan.id },
      data: {
        penaltyPaid,
        ...(closes ? { status: p.kind === 'FORECLOSURE' ? 'FORECLOSED' : 'CLOSED', closedOn: p.date } : {}),
      },
    });

    if (loan.fundId) {
      await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: loan.fundId, amount: p.amount, type: 'COLLECTION', date: p.date, refId: collection.id, userId: ctx.userId });
    }
    await this.books.daybook(tx, {
      tenantId: ctx.tenantId,
      branchId: loan.branchId,
      date: p.date,
      direction: 'IN',
      amount: p.amount,
      mode: p.mode,
      particulars: `${customer.name} ${loan.number} ${receiptNo}`,
      systemCategory: 'COLLECTION',
      refType: 'Collection',
      refId: collection.id,
      userId: ctx.userId,
    });
    return { collection, loan, closes, balance: remaining };
  }

  async record(ctx: Ctx, input: CollectionInput) {
    const existing = await this.prisma.collection.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
    if (existing) return { collection: existing, duplicate: true };
    const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
    if (collectedAt.getTime() > Date.now() + 5 * 60_000) throw bad('Collection time is in the future');
    const date = istDate(collectedAt);
    if (input.agentId && input.agentId !== ctx.userId) {
      if (!ctx.permissions.has('handover.verify') && !ctx.permissions.has('collection.reverse')) throw forbidden('Only office staff can enter collections for another agent');
      const agent = await this.prisma.user.findFirst({ where: { id: input.agentId, tenantId: ctx.tenantId } });
      if (!agent) throw notFound('Agent');
    }
    const res = await this.prisma.tx((tx) =>
      this.applyPayment(tx, ctx, input.loanId, { ...input, date, collectedAt }),
    );
    await this.audit.log(ctx, 'COLLECT', 'Collection', res.collection.id, undefined, { loanId: input.loanId, amount: input.amount, mode: input.mode, agentId: res.collection.agentId });
    void this.sendReceipt(ctx, res.collection.id).catch(() => undefined);
    return { collection: res.collection, duplicate: false, loanClosed: res.closes, balance: res.balance };
  }

  async sendReceipt(ctx: Ctx, collectionId: string) {
    const c = await this.prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    const loan = await this.prisma.loan.findUniqueOrThrow({ where: { id: c.loanId }, include: { customer: true, instalments: true } });
    const pos = positionOf(loan);
    const vars = { business: ctx.tenantName, amount: formatINR(c.amount), loan: loan.number, date: c.date, balance: formatINR(pos.totalOutstanding), receipt: c.receiptNo };
    return this.notify.sms(ctx.tenantId, loan.customer.phone, loan.customer.language, 'sms.collection', vars, ctx.settings.smsTemplates?.collection);
  }

  async recordVisit(ctx: Ctx, input: z.infer<typeof visitSchema>) {
    const existing = await this.prisma.visitLog.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
    if (existing) return existing;
    const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
    if (!c) throw notFound('Customer');
    assertBranch(ctx, c.branchId);
    const visitedAt = input.visitedAt ? new Date(input.visitedAt) : new Date();
    return this.prisma.visitLog.create({
      data: { ...input, tenantId: ctx.tenantId, agentId: ctx.userId, visitedAt, date: istDate(visitedAt) },
    });
  }

  /** Offline sync: each item is applied on its own; one failure does not stop the rest. Retries are ignored. */
  async sync(ctx: Ctx, input: z.infer<typeof syncSchema>) {
    type Result = { clientRef: string; type: string; status: 'OK' | 'DUPLICATE' | 'ERROR'; id?: string; receiptNo?: string; error?: string };
    const results: Result[] = [];
    // Applied oldest first so instalments fill in the order money was taken; reported in the order sent.
    const sorted = [...input.collections].sort((a, b) => (a.collectedAt ?? '9').localeCompare(b.collectedAt ?? '9'));
    for (const c of sorted) {
      try {
        const r = await this.record(ctx, c);
        results.push({ clientRef: c.clientRef, type: 'collection', status: r.duplicate ? 'DUPLICATE' : 'OK', id: r.collection.id, receiptNo: r.collection.receiptNo });
      } catch (e) {
        results.push({ clientRef: c.clientRef, type: 'collection', status: 'ERROR', error: errorMessage(e) });
      }
    }
    const order = new Map(input.collections.map((c, i) => [c.clientRef, i]));
    results.sort((a, b) => (order.get(a.clientRef) ?? 0) - (order.get(b.clientRef) ?? 0));
    for (const v of input.visits) {
      try {
        const r = await this.recordVisit(ctx, v);
        results.push({ clientRef: v.clientRef, type: 'visit', status: 'OK', id: r.id });
      } catch (e) {
        results.push({ clientRef: v.clientRef, type: 'visit', status: 'ERROR', error: errorMessage(e) });
      }
    }
    return { results };
  }

  async reverse(ctx: Ctx, id: string, reason: string) {
    const c = await this.prisma.collection.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { allocations: true } });
    if (!c) throw notFound('Collection');
    assertBranch(ctx, c.branchId);
    if (c.reversedAt) throw bad('Already reversed');
    const handedOver = await this.prisma.handover.findUnique({ where: { agentId_date: { agentId: c.agentId, date: c.date } } });
    if (handedOver && ctx.role !== 'TENANT_ADMIN' && ctx.role !== 'BRANCH_MANAGER') throw forbidden('The cash for this day is already handed over');
    const today = todayIST();
    await this.prisma.tx(async (tx) => {
      const loan = await tx.loan.findUniqueOrThrow({ where: { id: c.loanId }, include: { customer: true } });
      if (!['ACTIVE', 'CLOSED', 'FORECLOSED'].includes(loan.status)) throw bad('This loan can no longer be changed');
      for (const a of c.allocations) {
        await tx.instalment.update({ where: { id: a.instalmentId }, data: { principalPaid: { decrement: a.principal }, interestPaid: { decrement: a.interest }, paidOn: null } });
      }
      await tx.loan.update({ where: { id: loan.id }, data: { penaltyPaid: { decrement: c.penalty }, status: 'ACTIVE', closedOn: null } });
      await tx.collection.update({ where: { id }, data: { reversedAt: new Date(), reversedById: ctx.userId, reverseReason: reason } });
      await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: loan.id, customerId: loan.customerId, date: today, type: 'REVERSAL', description: `Reversal of ${c.receiptNo}: ${reason}`, debit: c.amount, refId: c.id });
      if (c.penalty > 0) {
        await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: loan.id, customerId: loan.customerId, date: today, type: 'PENALTY', description: `Penalty on ${c.receiptNo} reversed`, credit: c.penalty, refId: c.id });
      }
      if (loan.fundId) {
        await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: loan.fundId, amount: -c.amount, type: 'REVERSAL', date: today, refId: c.id, userId: ctx.userId });
      }
      await this.books.daybook(tx, {
        tenantId: ctx.tenantId,
        branchId: c.branchId,
        date: today,
        direction: 'OUT',
        amount: c.amount,
        mode: c.mode,
        particulars: `Reversal ${c.receiptNo} ${loan.customer.name}: ${reason}`,
        systemCategory: 'REVERSAL',
        refType: 'Collection',
        refId: c.id,
        userId: ctx.userId,
      });
    });
    await this.audit.log(ctx, 'REVERSE', 'Collection', id, c, { reason });
    return { ok: true };
  }

  async list(ctx: Ctx, q: { from?: string; to?: string; branchId?: string; agentId?: string; routeId?: string; loanId?: string; flagged?: string; page?: number }) {
    const take = 100;
    const page = Math.max(1, q.page ?? 1);
    const where: Prisma.CollectionWhereInput = {
      ...branchScope(ctx, q.branchId),
      ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
      ...(q.agentId ? { agentId: q.agentId } : {}),
      ...(q.routeId ? { routeId: q.routeId } : {}),
      ...(q.loanId ? { loanId: q.loanId } : {}),
      ...(q.flagged === 'true' ? { flagged: true } : {}),
      // Agents only see their own collections.
      ...(ctx.role === 'COLLECTION_AGENT' ? { agentId: ctx.userId } : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.collection.findMany({ where, orderBy: { collectedAt: 'desc' }, take, skip: (page - 1) * take }),
      this.prisma.collection.count({ where }),
      this.prisma.collection.groupBy({ by: ['mode'], where: { ...where, reversedAt: null }, _sum: { amount: true } }),
    ]);
    const [customers, loans, users] = await Promise.all([
      this.prisma.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true, code: true } }),
      this.prisma.loan.findMany({ where: { id: { in: rows.map((r) => r.loanId) } }, select: { id: true, number: true } }),
      this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.agentId) } }, select: { id: true, name: true } }),
    ]);
    return {
      total,
      page,
      pageSize: take,
      totals: Object.fromEntries(sums.map((s) => [s.mode, s._sum.amount ?? 0])),
      rows: rows.map((r) => ({
        ...r,
        customerName: customers.find((c) => c.id === r.customerId)?.name,
        loanNumber: loans.find((l) => l.id === r.loanId)?.number,
        agentName: users.find((u) => u.id === r.agentId)?.name,
      })),
    };
  }

  /**
   * Everything the phone needs for a route day: customers in order with their active loans, what is due,
   * arrears, last payments and today's status for the map pin.
   */
  async routeDay(ctx: Ctx, routeId: string, date = todayIST()) {
    const route = await this.prisma.route.findFirst({ where: { id: routeId, tenantId: ctx.tenantId }, include: { location: true } });
    if (!route) throw notFound('Route');
    assertBranch(ctx, route.branchId);
    const customers = await this.prisma.customer.findMany({
      where: { tenantId: ctx.tenantId, routeId, status: { not: 'CLOSED' } },
      orderBy: [{ routeSeq: 'asc' }, { name: 'asc' }],
      include: { loans: { where: { status: 'ACTIVE' }, include: { instalments: { orderBy: { seq: 'asc' } } } } },
    });
    const loanIds = customers.flatMap((c) => c.loans.map((l) => l.id));
    const [recent, todays, visits] = await Promise.all([
      this.prisma.collection.findMany({ where: { loanId: { in: loanIds }, reversedAt: null }, orderBy: { collectedAt: 'desc' }, take: 2000 }),
      this.prisma.collection.findMany({ where: { loanId: { in: loanIds }, date, reversedAt: null } }),
      this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, customerId: { in: customers.map((c) => c.id) }, date } }),
    ]);
    return {
      route: { id: route.id, name: route.name, location: route.location.name },
      date,
      customers: customers.map((c) => {
        const loans = c.loans.map(({ instalments, ...l }) => {
          const pos = positionOf({ ...l, instalments }, date);
          return {
            id: l.id,
            number: l.number,
            legacyNo: l.legacyNo,
            principal: l.principal,
            frequency: l.frequency,
            instalmentAmount: instalments[0] ? instalments[0].principalDue + instalments[0].interestDue : 0,
            dueNow: pos.overdue + pos.dueToday + pos.penaltyOutstanding,
            dueToday: pos.dueToday,
            arrears: pos.overdue,
            penalty: pos.penaltyOutstanding,
            outstanding: pos.totalOutstanding,
            daysPastDue: pos.daysPastDue,
            // For the office quick-entry screen: the loan card the old desk software showed.
            disbursedOn: l.disbursedOn,
            maturityDate: instalments.at(-1)?.dueDate ?? null,
            totalPayable: instalments.reduce((s, i) => s + i.principalDue + i.interestDue, 0),
            totalPaid: instalments.reduce((s, i) => s + i.principalPaid + i.interestPaid, 0),
            instalmentsPaid: instalments.filter((i) => i.principalPaid + i.interestPaid >= i.principalDue + i.interestDue).length,
            instalmentsTotal: instalments.length,
            lastPayments: recent.filter((r) => r.loanId === l.id).slice(0, 5).map((r) => ({ date: r.date, amount: r.amount, mode: r.mode, receiptNo: r.receiptNo })),
          };
        });
        const dueNow = loans.reduce((s, l) => s + l.dueNow, 0);
        const paidToday = todays.filter((t) => t.customerId === c.id).reduce((s, t) => s + t.amount, 0);
        const visit = visits.find((v) => v.customerId === c.id);
        // dueNow is after today's payments, so zero means today's dues are cleared.
        const pin = paidToday > 0 ? (dueNow === 0 ? 'PAID' : 'PARTIAL') : visit ? 'MISSED' : dueNow === 0 ? 'NOTHING_DUE' : 'PENDING';
        return {
          id: c.id,
          code: c.code,
          name: c.name,
          phone: c.phone,
          address: c.address,
          landmark: c.landmark,
          lat: c.lat,
          lng: c.lng,
          routeSeq: c.routeSeq,
          status: c.status,
          dueNow,
          paidToday,
          pin,
          lastVisit: visit ? { outcome: visit.outcome, promiseDate: visit.promiseDate } : null,
          loans,
        };
      }),
    };
  }

  /** The agent's day: totals, cash in hand, sync status for the day-end screen. */
  async myDay(ctx: Ctx, date = todayIST()) {
    const [cols, visits, floats, handover] = await Promise.all([
      this.prisma.collection.findMany({ where: { tenantId: ctx.tenantId, agentId: ctx.userId, date, reversedAt: null } }),
      this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, agentId: ctx.userId, date } }),
      this.prisma.agentFloat.aggregate({ where: { tenantId: ctx.tenantId, agentId: ctx.userId, date }, _sum: { amount: true } }),
      this.prisma.handover.findUnique({ where: { agentId_date: { agentId: ctx.userId, date } } }),
    ]);
    const cash = cols.filter((c) => c.mode === 'CASH').reduce((s, c) => s + c.amount, 0);
    const upi = cols.filter((c) => c.mode !== 'CASH').reduce((s, c) => s + c.amount, 0);
    const customersPaid = new Set(cols.map((c) => c.customerId));
    const visited = new Set([...customersPaid, ...visits.map((v) => v.customerId)]);
    return {
      date,
      collections: cols.length,
      total: cash + upi,
      cash,
      upi,
      float: floats._sum.amount ?? 0,
      cashInHand: cash + (floats._sum.amount ?? 0),
      customersVisited: visited.size,
      customersPaid: customersPaid.size,
      missed: visits.filter((v) => v.outcome !== 'PAID' && v.outcome !== 'PARTIAL').length,
      handover,
    };
  }
}

function errorMessage(e: unknown) {
  const r = (e as { response?: { message?: string } }).response;
  return r?.message ?? (e as Error).message ?? 'Error';
}

const listQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
  branchId: z.string().optional(),
  agentId: z.string().optional(),
  routeId: z.string().optional(),
  loanId: z.string().optional(),
  flagged: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
});

@Controller()
export class CollectionsController {
  constructor(private readonly svc: CollectionsService) {}

  @Post('collections') @Perm('collection.record') record(@CurrentCtx() ctx: Ctx, @Body(V(collectionSchema)) b: CollectionInput) {
    return this.svc.record(ctx, b);
  }
  @Post('collections/sync') @Perm('collection.record') sync(@CurrentCtx() ctx: Ctx, @Body(V(syncSchema)) b: z.infer<typeof syncSchema>) {
    return this.svc.sync(ctx, b);
  }
  @Post('visits') @Perm('collection.record') visit(@CurrentCtx() ctx: Ctx, @Body(V(visitSchema)) b: z.infer<typeof visitSchema>) {
    return this.svc.recordVisit(ctx, b);
  }
  @Post('collections/:id/reverse') @Perm('collection.reverse') reverse(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(reverseCollectionSchema)) b: z.infer<typeof reverseCollectionSchema>) {
    return this.svc.reverse(ctx, id, b.reason);
  }
  @Post('collections/:id/resend-receipt') @Perm('collection.record', 'collection.reverse') resend(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.sendReceipt(ctx, id);
  }
  @Get('collections') @Perm('collection.record', 'report.view') list(@CurrentCtx() ctx: Ctx, @Query(V(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, q);
  }
  @Get('routes/:id/day') @Perm('collection.record', 'report.view') routeDay(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Query('date') date?: string) {
    return this.svc.routeDay(ctx, id, date);
  }
  @Get('me/day') @Perm('collection.record') myDay(@CurrentCtx() ctx: Ctx, @Query('date') date?: string) {
    return this.svc.myDay(ctx, date);
  }
}

export const newClientRef = () => randomUUID();
