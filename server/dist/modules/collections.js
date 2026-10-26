"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.newClientRef = exports.CollectionsController = exports.CollectionsService = void 0;
const common_1 = require("@nestjs/common");
const crypto_1 = require("crypto");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const areas_1 = require("../common/areas");
const books_service_1 = require("../common/books.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const notify_service_1 = require("../common/notify.service");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
const istDate = (d) => (0, shared_1.todayIST)(d);
let CollectionsService = class CollectionsService {
    prisma;
    books;
    audit;
    notify;
    constructor(prisma, books, audit, notify) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
        this.notify = notify;
    }
    /**
     * Applies money to a loan inside a transaction: allocation, instalments, penalty, ledger, fund, day book.
     * `waiveInterest` (foreclosure) forgives that much future interest first.
     */
    async applyPayment(tx, ctx, loanId, p) {
        const loan = await tx.loan.findFirst({ where: { id: loanId, tenantId: ctx.tenantId }, include: { instalments: { orderBy: { seq: 'asc' } }, customer: true } });
        if (!loan)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, loan.branchId);
        if (loan.status !== 'ACTIVE')
            throw (0, errors_1.bad)('Only active loans can take payments');
        let instalments = loan.instalments;
        if (p.waiveInterest) {
            // Forgive unpaid interest from the last instalment backwards.
            let left = p.waiveInterest;
            for (const ins of [...instalments].reverse()) {
                if (left <= 0)
                    break;
                const unpaid = ins.interestDue - ins.interestPaid;
                const cut = Math.min(unpaid, left);
                if (cut > 0) {
                    await tx.instalment.update({ where: { id: ins.id }, data: { interestDue: { decrement: cut } } });
                    left -= cut;
                }
            }
            if (left > 0)
                throw (0, errors_1.bad)('Interest waiver is more than the unpaid interest');
            await tx.loan.update({ where: { id: loan.id }, data: { interestWaived: { increment: p.waiveInterest } } });
            await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: loan.id, customerId: loan.customerId, date: p.date, type: 'WAIVER', description: 'Interest waived on early closure', credit: p.waiveInterest });
            instalments = await tx.instalment.findMany({ where: { loanId: loan.id }, orderBy: { seq: 'asc' } });
        }
        const states = instalments.map(books_service_1.toState);
        const charged = (0, shared_1.penaltyCharged)(states, (0, books_service_1.penaltyRule)(loan), p.date);
        const penaltyOutstanding = Math.max(0, charged - loan.penaltyPaid - loan.penaltyWaived);
        const alloc = (0, errors_1.rule)(() => (0, shared_1.allocatePayment)(p.amount, states, penaltyOutstanding, ctx.settings.paymentOrder), 'collection.tooMuch');
        for (const a of alloc.perInstalment) {
            await tx.instalment.update({
                where: { id: a.id },
                data: { principalPaid: { increment: a.principal }, interestPaid: { increment: a.interest }, ...(a.fullyPaid ? { paidOn: p.date } : {}) },
            });
        }
        const customer = loan.customer;
        let distanceM = null;
        if (p.lat != null && p.lng != null && customer.lat != null && customer.lng != null) {
            distanceM = Math.round((0, shared_1.distanceMetres)({ lat: p.lat, lng: p.lng }, { lat: customer.lat, lng: customer.lng }));
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
        const penaltyLeft = Math.max(0, (0, shared_1.penaltyCharged)(after.map(books_service_1.toState), (0, books_service_1.penaltyRule)(loan), p.date) - penaltyPaid - loan.penaltyWaived);
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
    async record(ctx, input) {
        const existing = await this.prisma.collection.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
        if (existing)
            return { collection: existing, duplicate: true };
        const collectedAt = input.collectedAt ? new Date(input.collectedAt) : new Date();
        if (collectedAt.getTime() > Date.now() + 5 * 60_000)
            throw (0, errors_1.bad)('Collection time is in the future');
        const date = istDate(collectedAt);
        if (input.agentId && input.agentId !== ctx.userId) {
            if (!ctx.permissions.has('handover.verify') && !ctx.permissions.has('collection.reverse'))
                throw (0, errors_1.forbidden)('Only office staff can enter collections for another agent');
            const agent = await this.prisma.user.findFirst({ where: { id: input.agentId, tenantId: ctx.tenantId } });
            if (!agent)
                throw (0, errors_1.notFound)('Agent');
        }
        const res = await this.prisma.tx((tx) => this.applyPayment(tx, ctx, input.loanId, { ...input, date, collectedAt }));
        await this.audit.log(ctx, 'COLLECT', 'Collection', res.collection.id, undefined, { loanId: input.loanId, amount: input.amount, mode: input.mode, agentId: res.collection.agentId });
        void this.sendReceipt(ctx, res.collection.id).catch(() => undefined);
        return { collection: res.collection, duplicate: false, loanClosed: res.closes, balance: res.balance };
    }
    async sendReceipt(ctx, collectionId) {
        const c = await this.prisma.collection.findFirst({ where: { id: collectionId, tenantId: ctx.tenantId } });
        if (!c)
            throw (0, errors_1.notFound)('Collection');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        const loan = await this.prisma.loan.findFirst({ where: { id: c.loanId, tenantId: ctx.tenantId }, include: { customer: true, instalments: true } });
        if (!loan)
            throw (0, errors_1.notFound)('Loan');
        const pos = (0, books_service_1.positionOf)(loan);
        // The business chooses whether the receipt also tells the customer the arrears (when there are any) and the balance.
        const lang = loan.customer.language;
        const arrears = ctx.settings.smsShowArrears && pos.overdue > 0 ? (0, shared_1.formatINR)(pos.overdue) : '';
        const balance = ctx.settings.smsShowBalance ? (0, shared_1.formatINR)(pos.totalOutstanding) : '';
        const details = [arrears && (0, shared_1.translate)(lang, 'sms.arrearsPart', { amount: arrears }), balance && (0, shared_1.translate)(lang, 'sms.balancePart', { amount: balance })]
            .filter(Boolean)
            .map((p) => ` ${p}`)
            .join('');
        const vars = { business: ctx.tenantName, amount: (0, shared_1.formatINR)(c.amount), loan: loan.number, date: c.date, arrears, balance, details, receipt: c.receiptNo };
        return this.notify.sms(ctx.tenantId, loan.customer.phone, lang, 'sms.collection', vars, ctx.settings.smsTemplates?.collection);
    }
    async recordVisit(ctx, input) {
        const existing = await this.prisma.visitLog.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
        if (existing)
            return existing;
        const c = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
        if (!c)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        if (input.loanId && !(await this.prisma.loan.findFirst({ where: { id: input.loanId, tenantId: ctx.tenantId, customerId: c.id }, select: { id: true } })))
            throw (0, errors_1.notFound)('Loan');
        const visitedAt = input.visitedAt ? new Date(input.visitedAt) : new Date();
        return this.prisma.visitLog.create({
            data: { ...input, tenantId: ctx.tenantId, agentId: ctx.userId, visitedAt, date: istDate(visitedAt) },
        });
    }
    /** Offline sync: each item is applied on its own; one failure does not stop the rest. Retries are ignored. */
    async sync(ctx, input) {
        const results = [];
        // Applied oldest first so instalments fill in the order money was taken; reported in the order sent.
        const sorted = [...input.collections].sort((a, b) => (a.collectedAt ?? '9').localeCompare(b.collectedAt ?? '9'));
        for (const c of sorted) {
            try {
                const r = await this.record(ctx, c);
                results.push({ clientRef: c.clientRef, type: 'collection', status: r.duplicate ? 'DUPLICATE' : 'OK', id: r.collection.id, receiptNo: r.collection.receiptNo });
            }
            catch (e) {
                results.push({ clientRef: c.clientRef, type: 'collection', status: 'ERROR', error: errorMessage(e) });
            }
        }
        const order = new Map(input.collections.map((c, i) => [c.clientRef, i]));
        results.sort((a, b) => (order.get(a.clientRef) ?? 0) - (order.get(b.clientRef) ?? 0));
        for (const v of input.visits) {
            try {
                const r = await this.recordVisit(ctx, v);
                results.push({ clientRef: v.clientRef, type: 'visit', status: 'OK', id: r.id });
            }
            catch (e) {
                results.push({ clientRef: v.clientRef, type: 'visit', status: 'ERROR', error: errorMessage(e) });
            }
        }
        return { results };
    }
    async reverse(ctx, id, reason) {
        const c = await this.prisma.collection.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { allocations: true } });
        if (!c)
            throw (0, errors_1.notFound)('Collection');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        if (c.reversedAt)
            throw (0, errors_1.bad)('Already reversed');
        const handedOver = await this.prisma.handover.findUnique({ where: { agentId_date: { agentId: c.agentId, date: c.date } } });
        if (handedOver && ctx.role !== 'TENANT_ADMIN' && ctx.role !== 'BRANCH_MANAGER')
            throw (0, errors_1.forbidden)('The cash for this day is already handed over');
        const today = (0, shared_1.todayIST)();
        await this.prisma.tx(async (tx) => {
            const loan = await tx.loan.findUniqueOrThrow({ where: { id: c.loanId }, include: { customer: true } });
            if (!['ACTIVE', 'CLOSED', 'FORECLOSED'].includes(loan.status))
                throw (0, errors_1.bad)('This loan can no longer be changed');
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
    async list(ctx, q) {
        const take = 100;
        const page = Math.max(1, q.page ?? 1);
        const where = {
            ...(0, scope_1.branchScope)(ctx, q.branchId),
            ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
            ...(q.agentId ? { agentId: q.agentId } : {}),
            ...(q.routeId ? { routeId: q.routeId } : {}),
            ...(q.loanId ? { loanId: q.loanId } : {}),
            ...(q.customerId ? { customerId: q.customerId } : {}),
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
    async routeDay(ctx, routeId, date = (0, shared_1.todayIST)()) {
        const route = await this.prisma.route.findFirst({ where: { id: routeId, tenantId: ctx.tenantId }, include: { location: true, ...areas_1.withAreas } });
        if (!route)
            throw (0, errors_1.notFound)('Route');
        (0, scope_1.assertBranch)(ctx, route.branchId);
        const customers = await this.prisma.customer.findMany({
            where: { tenantId: ctx.tenantId, routeId, status: { not: 'CLOSED' } },
            orderBy: [{ routeSeq: 'asc' }, { name: 'asc' }],
            include: { loans: { where: { status: 'ACTIVE' }, include: { instalments: { orderBy: { seq: 'asc' } } } } },
        });
        const loanIds = customers.flatMap((c) => c.loans.map((l) => l.id));
        // Each customer's area (location), for grouping the printed line sheet.
        const areas = await this.prisma.location.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(customers.map((c) => c.locationId))] } }, select: { id: true, name: true } });
        const [recent, todays, visits, promises] = await Promise.all([
            this.prisma.collection.findMany({ where: { loanId: { in: loanIds }, reversedAt: null }, orderBy: { collectedAt: 'desc' }, take: 2000 }),
            this.prisma.collection.findMany({ where: { loanId: { in: loanIds }, date, reversedAt: null } }),
            this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, customerId: { in: customers.map((c) => c.id) }, date } }),
            this.prisma.visitLog.findMany({
                where: { tenantId: ctx.tenantId, customerId: { in: customers.map((c) => c.id) }, outcome: 'PROMISED', promiseDate: { gte: (0, shared_1.addDays)(date, -14), lte: date } },
                orderBy: { visitedAt: 'desc' },
                distinct: ['customerId'],
                select: { customerId: true, promiseDate: true },
            }),
        ]);
        // Who took each recent payment, for reprinting a receipt on the phone (names from this business only).
        const agentNames = new Map((await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(recent.map((r) => r.agentId))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
        // For the smart visit order on the phone: the hour (IST) a customer usually pays at, from their last ten payments,
        // and a promise to pay that is due and not yet kept.
        const usualHour = (customerId) => {
            const hours = recent
                .filter((r) => r.customerId === customerId)
                .slice(0, 10)
                .map((r) => Math.floor(((r.collectedAt.getUTCHours() * 60 + r.collectedAt.getUTCMinutes() + 330) % 1440) / 60))
                .sort((a, b) => a - b);
            return hours.length >= 3 ? hours[Math.floor(hours.length / 2)] : null;
        };
        const openPromise = (customerId) => {
            const p = promises.find((v) => v.customerId === customerId);
            if (!p?.promiseDate)
                return null;
            return recent.some((r) => r.customerId === customerId && r.date >= p.promiseDate) ? null : p.promiseDate;
        };
        return {
            route: { id: route.id, name: route.name, location: route.location.name, locations: (0, areas_1.routeAreas)(route) },
            date,
            customers: customers.map((c) => {
                const loans = c.loans.map(({ instalments, ...l }) => {
                    const pos = (0, books_service_1.positionOf)({ ...l, instalments }, date);
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
                        lastPayments: recent.filter((r) => r.loanId === l.id).slice(0, 5).map((r) => ({ date: r.date, at: r.collectedAt, amount: r.amount, mode: r.mode, receiptNo: r.receiptNo, agent: agentNames.get(r.agentId) ?? null })),
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
                    language: c.language,
                    address: c.address,
                    landmark: c.landmark,
                    lat: c.lat,
                    lng: c.lng,
                    routeSeq: c.routeSeq,
                    area: areas.find((a) => a.id === c.locationId)?.name ?? null,
                    status: c.status,
                    dueNow,
                    paidToday,
                    pin,
                    lastVisit: visit ? { outcome: visit.outcome, promiseDate: visit.promiseDate } : null,
                    usualHour: usualHour(c.id),
                    promiseDate: openPromise(c.id),
                    loans,
                };
            }),
        };
    }
    /** The agent's day: totals, cash in hand, sync status for the day-end screen. */
    async myDay(ctx, date = (0, shared_1.todayIST)()) {
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
};
exports.CollectionsService = CollectionsService;
exports.CollectionsService = CollectionsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService,
        notify_service_1.NotifyService])
], CollectionsService);
function errorMessage(e) {
    const r = e.response;
    return r?.message ?? e.message ?? 'Error';
}
const listQuery = zod_1.z.object({
    from: zod_1.z.string().optional(),
    to: zod_1.z.string().optional(),
    branchId: zod_1.z.string().optional(),
    agentId: zod_1.z.string().optional(),
    routeId: zod_1.z.string().optional(),
    loanId: zod_1.z.string().optional(),
    customerId: zod_1.z.string().optional(),
    flagged: zod_1.z.string().optional(),
    page: zod_1.z.coerce.number().int().positive().optional(),
});
let CollectionsController = class CollectionsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    record(ctx, b) {
        return this.svc.record(ctx, b);
    }
    sync(ctx, b) {
        return this.svc.sync(ctx, b);
    }
    visit(ctx, b) {
        return this.svc.recordVisit(ctx, b);
    }
    reverse(ctx, id, b) {
        return this.svc.reverse(ctx, id, b.reason);
    }
    resend(ctx, id) {
        return this.svc.sendReceipt(ctx, id);
    }
    list(ctx, q) {
        return this.svc.list(ctx, q);
    }
    routeDay(ctx, id, date) {
        return this.svc.routeDay(ctx, id, date);
    }
    myDay(ctx, date) {
        return this.svc.myDay(ctx, date);
    }
};
exports.CollectionsController = CollectionsController;
__decorate([
    (0, common_1.Post)('collections'),
    (0, context_1.Perm)('collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.collectionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "record", null);
__decorate([
    (0, common_1.Post)('collections/sync'),
    (0, context_1.Perm)('collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.syncSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "sync", null);
__decorate([
    (0, common_1.Post)('visits'),
    (0, context_1.Perm)('collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.visitSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "visit", null);
__decorate([
    (0, common_1.Post)('collections/:id/reverse'),
    (0, context_1.Perm)('collection.reverse'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.reverseCollectionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "reverse", null);
__decorate([
    (0, common_1.Post)('collections/:id/resend-receipt'),
    (0, context_1.Perm)('collection.record', 'collection.reverse'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "resend", null);
__decorate([
    (0, common_1.Get)('collections'),
    (0, context_1.Perm)('collection.record', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(listQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('routes/:id/day'),
    (0, context_1.Perm)('collection.record', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "routeDay", null);
__decorate([
    (0, common_1.Get)('me/day'),
    (0, context_1.Perm)('collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CollectionsController.prototype, "myDay", null);
exports.CollectionsController = CollectionsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [CollectionsService])
], CollectionsController);
const newClientRef = () => (0, crypto_1.randomUUID)();
exports.newClientRef = newClientRef;
//# sourceMappingURL=collections.js.map