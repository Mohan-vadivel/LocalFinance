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
exports.ReportsController = exports.DashboardService = exports.ReportsService = exports.ProfitLossService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const books_service_1 = require("../common/books.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
const range = (f) => {
    const to = f.to ?? (0, shared_1.todayIST)();
    const from = f.from ?? to.slice(0, 8) + '01';
    if (from > to)
        throw (0, errors_1.bad)('From date is after to date');
    return { from, to };
};
const month = (d) => d.slice(0, 7);
/** Customer filters shared by every report: branch, location, route. */
function customerWhere(ctx, f) {
    return { ...(0, scope_1.branchScope)(ctx, f.branchId), ...(f.locationId ? { locationId: f.locationId } : {}), ...(f.routeId ? { routeId: f.routeId } : {}) };
}
// =====================================================================
// Profit and loss
// =====================================================================
let ProfitLossService = class ProfitLossService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async compute(ctx, f, opts = {}) {
        const { from, to } = range(f);
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const basis = ctx.settings.plBasis;
        const productFilter = f.productId ? { productId: f.productId } : {};
        const [collections, disbursed, writeOffs, manual, categories, returns] = await Promise.all([
            this.prisma.collection.findMany({ where: { ...scope, date: { gte: from, lte: to }, reversedAt: null, ...(f.productId ? { loanId: { in: (await this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, productId: f.productId }, select: { id: true } })).map((l) => l.id) } } : {}) } }),
            this.prisma.loan.findMany({ where: { ...scope, ...productFilter, disbursedOn: { gte: from, lte: to }, migrated: false } }),
            this.prisma.loan.findMany({ where: { ...scope, ...productFilter, status: 'WRITTEN_OFF', closedOn: { gte: from, lte: to } } }),
            this.prisma.daybookEntry.findMany({ where: { ...scope, date: { gte: from, lte: to }, source: 'MANUAL' } }),
            this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId } }),
            opts.excludeInvestorReturns
                ? Promise.resolve([])
                : this.prisma.investorTxn.findMany({
                    where: {
                        tenantId: ctx.tenantId,
                        type: 'RETURN_DUE',
                        periodEnd: { gte: from, lte: to },
                        ...(scope.branchId ? { investment: { branchId: scope.branchId } } : {}),
                    },
                }),
        ]);
        let interestIncome;
        if (basis === 'ACCRUAL') {
            const due = await this.prisma.instalment.aggregate({
                where: { tenantId: ctx.tenantId, dueDate: { gte: from, lte: to }, loan: { ...scope, ...productFilter, status: { in: ['ACTIVE', 'CLOSED', 'FORECLOSED'] } } },
                _sum: { interestDue: true },
            });
            interestIncome = due._sum.interestDue ?? 0;
        }
        else {
            interestIncome = collections.reduce((s, c) => s + c.interest, 0);
        }
        interestIncome += disbursed.reduce((s, l) => s + l.upfrontInterest, 0);
        const feeIncome = disbursed.reduce((s, l) => s + l.fee, 0);
        const penaltyIncome = collections.reduce((s, c) => s + c.penalty, 0);
        const kindOf = (id) => categories.find((c) => c.id === id)?.kind;
        const otherIncome = manual.filter((e) => e.direction === 'IN' && kindOf(e.categoryId) === 'INCOME').reduce((s, e) => s + e.amount, 0);
        const expenseRows = manual.filter((e) => e.direction === 'OUT' && kindOf(e.categoryId) === 'EXPENSE');
        const expenses = expenseRows.reduce((s, e) => s + e.amount, 0);
        const byCategory = categories
            .filter((c) => c.kind === 'EXPENSE')
            .map((c) => ({ category: c.name, amount: expenseRows.filter((e) => e.categoryId === c.id).reduce((s, e) => s + e.amount, 0) }))
            .filter((r) => r.amount > 0)
            .sort((a, b) => b.amount - a.amount);
        const investorReturns = returns.reduce((s, r) => s + r.amount, 0);
        const badDebts = writeOffs.reduce((s, l) => s + l.writtenOffAmount, 0);
        const totalIncome = interestIncome + feeIncome + penaltyIncome + otherIncome;
        return {
            from,
            to,
            basis,
            interestIncome,
            feeIncome,
            penaltyIncome,
            otherIncome,
            totalIncome,
            investorReturns,
            expenses,
            badDebts,
            netProfit: totalIncome - investorReturns - expenses - badDebts,
            expenseBreakdown: byCategory,
        };
    }
    /** P&L for the period, month by month, and the same-length previous period for comparison. */
    async report(ctx, f) {
        const { from, to } = range(f);
        const current = await this.compute(ctx, { ...f, from, to });
        const len = (0, shared_1.diffDays)(to, from);
        const prevTo = (0, shared_1.addDays)(from, -1);
        const previous = await this.compute(ctx, { ...f, from: (0, shared_1.addDays)(prevTo, -len), to: prevTo });
        const months = [];
        let cursor = from;
        while (cursor <= to) {
            const m = month(cursor);
            const nextMonthStart = new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 1)).toISOString().slice(0, 10);
            const end = (0, shared_1.addDays)(nextMonthStart, -1) < to ? (0, shared_1.addDays)(nextMonthStart, -1) : to;
            months.push({ month: m, ...(await this.compute(ctx, { ...f, from: cursor, to: end })) });
            cursor = nextMonthStart;
            if (months.length > 36)
                break;
        }
        return { current, previous, months };
    }
};
exports.ProfitLossService = ProfitLossService;
exports.ProfitLossService = ProfitLossService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProfitLossService);
// =====================================================================
// Operational reports
// =====================================================================
let ReportsService = class ReportsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async activeLoans(ctx, f, statuses = ['ACTIVE']) {
        return this.prisma.loan.findMany({
            where: { ...(0, scope_1.branchScope)(ctx, f.branchId), status: { in: statuses }, ...(f.productId ? { productId: f.productId } : {}), customer: customerWhere(ctx, f) },
            include: { instalments: true, customer: { select: { id: true, name: true, code: true, phone: true, locationId: true, routeId: true } } },
        });
    }
    async names(ctx) {
        const [branches, locations, routes, users, products] = await Promise.all([
            this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.location.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.route.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
        ]);
        const n = (list) => (id) => list.find((x) => x.id === id)?.name ?? '';
        return { branch: n(branches), location: n(locations), route: n(routes), user: n(users), product: n(products) };
    }
    collectionWhere(ctx, f, from, to) {
        return {
            ...(0, scope_1.branchScope)(ctx, f.branchId),
            date: { gte: from, lte: to },
            reversedAt: null,
            ...(f.agentId ? { agentId: f.agentId } : {}),
            ...(f.routeId ? { routeId: f.routeId } : {}),
        };
    }
    /** Per route and day: due, collected (cash and UPI), customers missed. */
    async dailyCollection(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const loans = await this.activeLoans(ctx, f, ['ACTIVE', 'CLOSED', 'FORECLOSED']);
        const cols = await this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to) });
        const rows = new Map();
        const key = (d, r) => `${d}|${r}`;
        const get = (d, r) => {
            if (!rows.has(key(d, r)))
                rows.set(key(d, r), { date: d, routeId: r, due: 0, collected: 0, cash: 0, upi: 0, customersDue: new Set(), customersPaid: new Set() });
            return rows.get(key(d, r));
        };
        for (const l of loans) {
            for (const i of l.instalments) {
                if (i.dueDate < from || i.dueDate > to)
                    continue;
                const r = get(i.dueDate, l.customer.routeId);
                r.due += i.principalDue + i.interestDue;
                r.customersDue.add(l.customerId);
            }
        }
        for (const c of cols) {
            const r = get(c.date, c.routeId);
            r.collected += c.amount;
            if (c.mode === 'CASH')
                r.cash += c.amount;
            else
                r.upi += c.amount;
            r.customersPaid.add(c.customerId);
        }
        return [...rows.values()]
            .sort((a, b) => b.date.localeCompare(a.date) || n.route(a.routeId).localeCompare(n.route(b.routeId)))
            .map((r) => ({
            date: r.date,
            route: n.route(r.routeId) || '-',
            due: r.due,
            collected: r.collected,
            cash: r.cash,
            upi: r.upi,
            customersDue: r.customersDue.size,
            missed: [...r.customersDue].filter((c) => !r.customersPaid.has(c)).length,
            rate: r.due ? Math.round((r.collected / r.due) * 1000) / 10 : null,
        }));
    }
    /**
     * Collection totals for a day, week (Mon-Sun) or month, split by payment mode, with day-wise, route-wise and
     * agent-wise rows. Staff without report access only ever see their own collections.
     */
    async collectionSummary(ctx, q) {
        const { from, to } = (0, shared_1.periodRange)(q.period, q.date ?? (0, shared_1.todayIST)());
        const mine = !ctx.permissions.has('report.view');
        const f = { branchId: q.branchId, routeId: q.routeId, agentId: mine ? ctx.userId : q.agentId };
        const prev = (0, shared_1.periodRange)(q.period, (0, shared_1.addDays)(from, -1));
        const [n, cols, previous] = await Promise.all([
            this.names(ctx),
            this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to), select: { date: true, amount: true, mode: true, agentId: true, routeId: true, customerId: true } }),
            this.prisma.collection.aggregate({ where: this.collectionWhere(ctx, f, prev.from, prev.to), _sum: { amount: true } }),
        ]);
        const zero = () => ({ total: 0, cash: 0, upi: 0, bank: 0, count: 0 });
        const add = (t, c) => {
            t.total += c.amount;
            t.count += 1;
            if (c.mode === 'CASH')
                t.cash += c.amount;
            else if (c.mode === 'UPI')
                t.upi += c.amount;
            else
                t.bank += c.amount;
        };
        const totals = zero();
        const days = new Map();
        const routes = new Map();
        const agents = new Map();
        // Every day of the period up to today, so a day with nothing collected still shows.
        const last = to < (0, shared_1.todayIST)() ? to : (0, shared_1.todayIST)();
        for (let d = from; d <= last; d = (0, shared_1.addDays)(d, 1))
            days.set(d, zero());
        const bucket = (m, k) => m.get(k) ?? m.set(k, zero()).get(k);
        for (const c of cols) {
            add(totals, c);
            add(bucket(days, c.date), c);
            add(bucket(routes, c.routeId ?? ''), c);
            add(bucket(agents, c.agentId), c);
        }
        const byTotal = (a, b) => b.total - a.total;
        return {
            period: q.period,
            from,
            to,
            mine,
            totals: { ...totals, customers: new Set(cols.map((c) => c.customerId)).size },
            previousTotal: previous._sum.amount ?? 0,
            byDay: [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, t]) => ({ date, ...t })),
            byRoute: [...routes.entries()].map(([routeId, t]) => ({ routeId: routeId || null, route: n.route(routeId) || '-', ...t })).sort(byTotal),
            byAgent: mine ? [] : [...agents.entries()].map(([agentId, t]) => ({ agentId, agent: n.user(agentId), ...t })).sort(byTotal),
        };
    }
    /** Cash and bank carried into `date` for the given branches: last day close before it plus later entries. */
    async bookOpening(tenantId, branchIds, date) {
        const bal = { cash: 0, bank: 0 };
        for (const branchId of branchIds) {
            const lastClose = await this.prisma.dayClose.findFirst({ where: { tenantId, branchId, date: { lt: date } }, orderBy: { date: 'desc' } });
            const entries = await this.prisma.daybookEntry.findMany({ where: { tenantId, branchId, date: { lt: date, ...(lastClose ? { gt: lastClose.date } : {}) } }, select: { amount: true, mode: true, direction: true } });
            bal.cash += lastClose?.closingCash ?? 0;
            bal.bank += lastClose?.closingBank ?? 0;
            for (const e of entries)
                bal[e.mode === 'CASH' ? 'cash' : 'bank'] += e.direction === 'IN' ? e.amount : -e.amount;
        }
        return bal;
    }
    async branchIds(ctx, branchId) {
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId, ...(scope.branchId ? { id: scope.branchId } : {}) }, select: { id: true } });
        return branches.map((b) => b.id);
    }
    /** Loans balance (what customers owe, from the customer ledger) at the end of each day. */
    async ledgerByDay(loanIds, to) {
        const rows = loanIds.length
            ? await this.prisma.ledgerEntry.groupBy({ by: ['date'], where: { loanId: { in: loanIds }, date: { lte: to } }, _sum: { debit: true, credit: true } })
            : [];
        return rows.map((r) => ({ date: r.date, delta: (r._sum.debit ?? 0) - (r._sum.credit ?? 0) })).sort((a, b) => a.date.localeCompare(b.date));
    }
    /**
     * Daily statement, like the desk software's: per day the loans given (amount, interest and document charges taken),
     * collections, excess or short at handover, expenses, other income and other debits/credits from the day book,
     * and the closing loan balance and cash balance.
     */
    async dailyStatement(ctx, f) {
        const { from, to: asked } = range(f);
        const to = asked > (0, shared_1.todayIST)() ? (0, shared_1.todayIST)() : asked;
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const ids = await this.branchIds(ctx, f.branchId);
        const [loans, allLoans, cols, handovers, book, categories, opening] = await Promise.all([
            this.prisma.loan.findMany({ where: { ...scope, disbursedOn: { gte: from, lte: to }, migrated: false }, select: { disbursedOn: true, principal: true, upfrontInterest: true, fee: true } }),
            this.prisma.loan.findMany({ where: { ...scope, disbursedOn: { not: null } }, select: { id: true } }),
            this.prisma.collection.findMany({ where: { ...scope, date: { gte: from, lte: to }, reversedAt: null }, select: { date: true, amount: true, mode: true } }),
            this.prisma.handover.findMany({ where: { ...scope, date: { gte: from, lte: to } }, select: { date: true, difference: true } }),
            this.prisma.daybookEntry.findMany({ where: { ...scope, date: { gte: from, lte: to } }, select: { date: true, amount: true, mode: true, direction: true, categoryId: true, source: true } }),
            this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, kind: true } }),
            this.bookOpening(ctx.tenantId, ids, from),
        ]);
        const kind = new Map(categories.map((c) => [c.id, c.kind]));
        const ledger = await this.ledgerByDay(allLoans.map((l) => l.id), to);
        let loanBal = ledger.filter((l) => l.date < from).reduce((s, l) => s + l.delta, 0);
        const cash = { ...opening };
        const rows = [];
        for (let d = from; d <= to; d = (0, shared_1.addDays)(d, 1)) {
            const given = loans.filter((l) => l.disbursedOn === d);
            const coll = cols.filter((c) => c.date === d);
            const entries = book.filter((e) => e.date === d);
            const manual = (dir, kinds) => entries.filter((e) => e.direction === dir && e.source === 'MANUAL' && (kinds ? kinds.includes(kind.get(e.categoryId ?? '') ?? '') : !['EXPENSE', 'INCOME'].includes(kind.get(e.categoryId ?? '') ?? ''))).reduce((s, e) => s + e.amount, 0);
            for (const e of entries)
                cash[e.mode === 'CASH' ? 'cash' : 'bank'] += e.direction === 'IN' ? e.amount : -e.amount;
            loanBal += ledger.find((l) => l.date === d)?.delta ?? 0;
            rows.push({
                date: d,
                loans: given.length,
                loanAmount: given.reduce((s, l) => s + l.principal, 0),
                interestTaken: given.reduce((s, l) => s + l.upfrontInterest, 0),
                docCharges: given.reduce((s, l) => s + l.fee, 0),
                collected: coll.reduce((s, c) => s + c.amount, 0),
                cash: coll.filter((c) => c.mode === 'CASH').reduce((s, c) => s + c.amount, 0),
                upi: coll.filter((c) => c.mode !== 'CASH').reduce((s, c) => s + c.amount, 0),
                addLess: handovers.filter((h) => h.date === d).reduce((s, h) => s + h.difference, 0),
                expenses: manual('OUT', ['EXPENSE']),
                otherIncome: manual('IN', ['INCOME']),
                otherDebit: manual('OUT', null),
                otherCredit: manual('IN', null),
                loanBalance: loanBal,
                cashBalance: cash.cash,
                bankBalance: cash.bank,
            });
        }
        return rows.reverse();
    }
    /** Loans with dues not paid, with the customer's phone, last payment and the agent's last remark. */
    async pendingList(ctx, f) {
        const n = await this.names(ctx);
        const loans = await this.activeLoans(ctx, f);
        const ids = loans.map((l) => l.id);
        const [lastPaid, visits] = await Promise.all([
            this.prisma.collection.findMany({ where: { loanId: { in: ids }, reversedAt: null }, orderBy: { collectedAt: 'desc' }, distinct: ['loanId'], select: { loanId: true, date: true, amount: true } }),
            this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, customerId: { in: loans.map((l) => l.customerId) } }, orderBy: { visitedAt: 'desc' }, distinct: ['customerId'], select: { customerId: true, outcome: true, note: true, promiseDate: true, date: true } }),
        ]);
        const today = (0, shared_1.todayIST)();
        return loans
            .map((l) => {
            const pos = (0, books_service_1.positionOf)(l, today);
            const inst = l.instalments[0] ? l.instalments[0].principalDue + l.instalments[0].interestDue : 0;
            const missed = l.instalments.filter((i) => i.dueDate < today && i.principalPaid + i.interestPaid < i.principalDue + i.interestDue).length;
            const paid = lastPaid.find((c) => c.loanId === l.id);
            const v = visits.find((x) => x.customerId === l.customerId);
            const remark = v ? [v.promiseDate ? `→ ${v.promiseDate.split('-').reverse().join('-')}` : '', v.note ?? ''].filter(Boolean).join(' ') : '';
            return {
                loan: l.number,
                customer: l.customer.name,
                phone: l.customer.phone,
                route: n.route(l.customer.routeId) || '-',
                routeSeq: 0,
                principal: l.principal,
                instalment: inst,
                missedInstalments: missed,
                pending: pos.overdue + pos.penaltyOutstanding,
                totalOutstanding: pos.totalOutstanding,
                daysPastDue: pos.daysPastDue,
                lastPaidOn: paid?.date ?? null,
                lastPaidAmount: paid?.amount ?? null,
                lastOutcome: v?.outcome ?? null,
                remark,
            };
        })
            .filter((r) => r.pending > 0)
            .sort((a, b) => a.route.localeCompare(b.route) || b.daysPastDue - a.daysPastDue)
            .map(({ routeSeq: _s, ...r }) => r);
    }
    /**
     * Month (or any period) abstract per line/route, like the owner's monthly sheet: accounts at the start, new,
     * closed and at the end; money given, interest and document charges, collected, and balance at the end.
     * Plus the receipts and payments of the day book for the period with opening and closing cash.
     */
    async lineAbstract(ctx, f) {
        const { from, to: asked } = range(f);
        const to = asked > (0, shared_1.todayIST)() ? (0, shared_1.todayIST)() : asked;
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const ids = await this.branchIds(ctx, f.branchId);
        const n = await this.names(ctx);
        const [loans, cols, book, categories, opening] = await Promise.all([
            this.prisma.loan.findMany({
                where: { ...scope, disbursedOn: { not: null, lte: to }, OR: [{ closedOn: null }, { closedOn: { gte: from } }], ...(f.routeId ? { customer: { routeId: f.routeId } } : {}) },
                select: { id: true, principal: true, upfrontInterest: true, fee: true, disbursedOn: true, closedOn: true, status: true, migrated: true, customer: { select: { routeId: true } } },
            }),
            this.prisma.collection.findMany({ where: { ...scope, date: { gte: from, lte: to }, reversedAt: null, ...(f.routeId ? { routeId: f.routeId } : {}) }, select: { routeId: true, amount: true, mode: true, interest: true, penalty: true, loanId: true } }),
            this.prisma.daybookEntry.findMany({ where: { ...scope, date: { gte: from, lte: to } }, select: { amount: true, mode: true, direction: true, categoryId: true, systemCategory: true } }),
            this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.bookOpening(ctx.tenantId, ids, from),
        ]);
        const balances = loans.length
            ? await this.prisma.ledgerEntry.groupBy({ by: ['loanId'], where: { loanId: { in: loans.map((l) => l.id) }, date: { lte: to } }, _sum: { debit: true, credit: true } })
            : [];
        const balance = new Map(balances.map((b) => [b.loanId, (b._sum.debit ?? 0) - (b._sum.credit ?? 0)]));
        const routeOf = new Map(loans.map((l) => [l.id, l.customer.routeId ?? '']));
        const lines = new Map();
        const line = (r) => lines.get(r) ?? lines.set(r, { routeId: r, openingAccounts: 0, newAccounts: 0, closedAccounts: 0, closingAccounts: 0, loanAmount: 0, interestTaken: 0, docCharges: 0, collected: 0, cash: 0, upi: 0, interestCollected: 0, penalty: 0, balance: 0 }).get(r);
        for (const l of loans) {
            const x = line(l.customer.routeId ?? '');
            const d = l.disbursedOn;
            const closedIn = l.closedOn != null && l.closedOn >= from && l.closedOn <= to;
            // Loans brought over from the old software were not given out through this book.
            if (d < from || l.migrated)
                x.openingAccounts += 1;
            else {
                x.newAccounts += 1;
                x.loanAmount += l.principal;
                x.interestTaken += l.upfrontInterest;
                x.docCharges += l.fee;
            }
            if (closedIn)
                x.closedAccounts += 1;
            else
                x.closingAccounts += 1;
            x.balance += closedIn ? 0 : balance.get(l.id) ?? 0;
        }
        for (const c of cols) {
            const x = line(c.routeId ?? routeOf.get(c.loanId) ?? '');
            x.collected += c.amount;
            if (c.mode === 'CASH')
                x.cash += c.amount;
            else
                x.upi += c.amount;
            x.interestCollected += c.interest;
            x.penalty += c.penalty;
        }
        const catName = new Map(categories.map((c) => [c.id, c.name]));
        const group = (dir) => {
            const m = new Map();
            for (const e of book.filter((b) => b.direction === dir)) {
                const k = e.categoryId ? `cat:${catName.get(e.categoryId) ?? '-'}` : `sys:${e.systemCategory ?? 'OTHER'}`;
                m.set(k, (m.get(k) ?? 0) + e.amount);
            }
            return [...m.entries()].map(([k, amount]) => ({ key: k.slice(4), system: k.startsWith('sys:'), amount })).sort((a, b) => b.amount - a.amount);
        };
        const closing = { ...opening };
        for (const e of book)
            closing[e.mode === 'CASH' ? 'cash' : 'bank'] += e.direction === 'IN' ? e.amount : -e.amount;
        return {
            from,
            to,
            lines: [...lines.values()].map((x) => ({ route: n.route(x.routeId) || '-', ...x })).sort((a, b) => a.route.localeCompare(b.route)),
            book: { opening, closing, receipts: group('IN'), payments: group('OUT') },
        };
    }
    async disbursements(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const loans = await this.prisma.loan.findMany({
            where: { ...(0, scope_1.branchScope)(ctx, f.branchId), disbursedOn: { gte: from, lte: to }, migrated: false, ...(f.productId ? { productId: f.productId } : {}), customer: customerWhere(ctx, f) },
            include: { customer: { select: { name: true, code: true } } },
            orderBy: { disbursedOn: 'desc' },
        });
        return loans.map((l) => ({
            date: l.disbursedOn,
            loan: l.number,
            customer: `${l.customer.name} (${l.customer.code})`,
            branch: n.branch(l.branchId),
            product: n.product(l.productId),
            principal: l.principal,
            fee: l.fee,
            upfrontInterest: l.upfrontInterest,
            netDisbursed: l.netDisbursed,
            mode: l.disburseMode,
        }));
    }
    /** Scheme (loan product) wise: loans running, given and closed in the period, collected, outstanding and overdue. */
    async schemeWise(ctx, f) {
        const { from, to } = range(f);
        const asOf = to < (0, shared_1.todayIST)() ? to : (0, shared_1.todayIST)();
        const scope = { ...(0, scope_1.branchScope)(ctx, f.branchId), customer: customerWhere(ctx, f) };
        const [products, running, given, closed, cols] = await Promise.all([
            this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } }),
            this.activeLoans(ctx, f),
            this.prisma.loan.findMany({ where: { ...scope, disbursedOn: { gte: from, lte: to }, migrated: false }, select: { productId: true, principal: true } }),
            this.prisma.loan.findMany({ where: { ...scope, closedOn: { gte: from, lte: to } }, select: { productId: true } }),
            this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to), select: { amount: true, loanId: true } }),
        ]);
        const productOf = new Map((await this.prisma.loan.findMany({ where: { id: { in: [...new Set(cols.map((c) => c.loanId))] } }, select: { id: true, productId: true } })).map((l) => [l.id, l.productId]));
        return products
            .filter((p) => !f.productId || p.id === f.productId)
            .map((p) => {
            const mine = running.filter((l) => l.productId === p.id).map((l) => (0, books_service_1.positionOf)(l, asOf));
            const g = given.filter((l) => l.productId === p.id);
            return {
                product: p.name,
                activeLoans: mine.length,
                newLoans: g.length,
                loanAmount: g.reduce((sum, l) => sum + l.principal, 0),
                closedLoans: closed.filter((l) => l.productId === p.id).length,
                collected: cols.filter((c) => productOf.get(c.loanId) === p.id).reduce((sum, c) => sum + c.amount, 0),
                totalOutstanding: mine.reduce((sum, x) => sum + x.totalOutstanding, 0),
                overdue: mine.reduce((sum, x) => sum + x.overdue, 0),
                overdueLoans: mine.filter((x) => x.overdue > 0).length,
            };
        })
            .filter((r) => r.activeLoans || r.newLoans || r.closedLoans || r.collected);
    }
    async outstanding(ctx, f) {
        const asOf = f.to ?? (0, shared_1.todayIST)();
        const n = await this.names(ctx);
        const loans = await this.activeLoans(ctx, f);
        return loans
            .map((l) => {
            const p = (0, books_service_1.positionOf)(l, asOf);
            return {
                loan: l.number,
                customer: `${l.customer.name} (${l.customer.code})`,
                phone: l.customer.phone,
                branch: n.branch(l.branchId),
                location: n.location(l.customer.locationId),
                route: n.route(l.customer.routeId),
                product: n.product(l.productId),
                disbursedOn: l.disbursedOn,
                principal: l.principal,
                principalOutstanding: p.principalOutstanding,
                interestOutstanding: p.interestOutstanding,
                penalty: p.penaltyOutstanding,
                totalOutstanding: p.totalOutstanding,
                overdue: p.overdue,
                daysPastDue: p.daysPastDue,
            };
        })
            .sort((a, b) => b.daysPastDue - a.daysPastDue);
    }
    async ageing(ctx, f) {
        const rows = await this.outstanding(ctx, f);
        const buckets = shared_1.AGEING_BUCKETS.map((b) => ({ bucket: b.key, loans: 0, overdue: 0, outstanding: 0 }));
        for (const r of rows) {
            const k = (0, shared_1.ageingBucket)(r.daysPastDue);
            if (!k)
                continue;
            const b = buckets.find((x) => x.bucket === k);
            b.loans++;
            b.overdue += r.overdue;
            b.outstanding += r.totalOutstanding;
        }
        return { buckets, loans: rows.filter((r) => r.daysPastDue > 0) };
    }
    async demandVsCollection(ctx, f) {
        const daily = await this.dailyCollection(ctx, f);
        const byDate = new Map();
        for (const r of daily) {
            const d = byDate.get(r.date) ?? { date: r.date, demand: 0, collected: 0 };
            d.demand += r.due;
            d.collected += r.collected;
            byDate.set(r.date, d);
        }
        return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).map((d) => ({ ...d, rate: d.demand ? Math.round((d.collected / d.demand) * 1000) / 10 : null }));
    }
    async agentPerformance(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const [cols, visits, handovers] = await Promise.all([
            this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to) }),
            this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, date: { gte: from, lte: to }, ...(f.agentId ? { agentId: f.agentId } : {}) } }),
            this.prisma.handover.findMany({ where: { ...(0, scope_1.branchScope)(ctx, f.branchId), date: { gte: from, lte: to } } }),
        ]);
        const agents = [...new Set([...cols.map((c) => c.agentId), ...visits.map((v) => v.agentId)])];
        return agents.map((a) => {
            const mine = cols.filter((c) => c.agentId === a);
            const myVisits = visits.filter((v) => v.agentId === a);
            return {
                agent: n.user(a),
                collections: mine.length,
                amount: mine.reduce((s, c) => s + c.amount, 0),
                cash: mine.filter((c) => c.mode === 'CASH').reduce((s, c) => s + c.amount, 0),
                upi: mine.filter((c) => c.mode !== 'CASH').reduce((s, c) => s + c.amount, 0),
                customersVisited: new Set([...mine.map((c) => c.customerId), ...myVisits.map((v) => v.customerId)]).size,
                noPaymentVisits: myVisits.filter((v) => !['PAID', 'PARTIAL'].includes(v.outcome)).length,
                flagged: mine.filter((c) => c.flagged).length,
                cashDifference: handovers.filter((h) => h.agentId === a).reduce((s, h) => s + h.difference, 0),
            };
        }).sort((x, y) => y.amount - x.amount);
    }
    async cashDifferences(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const rows = await this.prisma.handover.findMany({ where: { ...(0, scope_1.branchScope)(ctx, f.branchId), date: { gte: from, lte: to }, difference: { not: 0 }, ...(f.agentId ? { agentId: f.agentId } : {}) }, orderBy: { date: 'desc' } });
        return rows.map((h) => ({ date: h.date, branch: n.branch(h.branchId), agent: n.user(h.agentId), expected: h.expected, received: h.received, difference: h.difference, note: h.note, verifiedBy: n.user(h.verifiedById) }));
    }
    async fundUtilisation(ctx, f) {
        const n = await this.names(ctx);
        const funds = await this.prisma.fund.findMany({ where: (0, scope_1.branchScope)(ctx, f.branchId) });
        const loans = await this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE', fundId: { in: funds.map((x) => x.id) } }, include: { instalments: true } });
        return funds.map((fund) => {
            const mine = loans.filter((l) => l.fundId === fund.id);
            const principalOut = mine.reduce((s, l) => s + (0, books_service_1.positionOf)(l).principalOutstanding, 0);
            const total = fund.balance + principalOut;
            return {
                fund: fund.name,
                branch: n.branch(fund.branchId),
                source: fund.sourceType,
                available: fund.balance,
                lentOut: principalOut,
                activeLoans: mine.length,
                utilisation: total ? Math.round((principalOut / total) * 1000) / 10 : 0,
            };
        });
    }
    async income(ctx, f) {
        const { from, to } = range(f);
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const [cols, loans] = await Promise.all([
            this.prisma.collection.findMany({ where: { ...scope, date: { gte: from, lte: to }, reversedAt: null } }),
            this.prisma.loan.findMany({ where: { ...scope, disbursedOn: { gte: from, lte: to } } }),
        ]);
        const months = new Map();
        const m = (d) => {
            const k = month(d);
            if (!months.has(k))
                months.set(k, { month: k, interest: 0, fees: 0, penalty: 0, upfront: 0 });
            return months.get(k);
        };
        cols.forEach((c) => {
            m(c.date).interest += c.interest;
            m(c.date).penalty += c.penalty;
        });
        loans.forEach((l) => {
            m(l.disbursedOn).fees += l.fee;
            m(l.disbursedOn).upfront += l.upfrontInterest;
        });
        return [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).map((r) => ({ ...r, total: r.interest + r.fees + r.penalty + r.upfront }));
    }
    async closedLoans(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const loans = await this.prisma.loan.findMany({
            where: { ...(0, scope_1.branchScope)(ctx, f.branchId), status: { in: ['CLOSED', 'FORECLOSED', 'WRITTEN_OFF'] }, closedOn: { gte: from, lte: to }, customer: customerWhere(ctx, f) },
            include: { customer: { select: { name: true, code: true } } },
            orderBy: { closedOn: 'desc' },
        });
        return loans.map((l) => ({ closedOn: l.closedOn, loan: l.number, customer: `${l.customer.name} (${l.customer.code})`, branch: n.branch(l.branchId), status: l.status, principal: l.principal, interestWaived: l.interestWaived, writtenOff: l.writtenOffAmount }));
    }
    /** Per location: customers, active loans, outstanding, collected in the period. */
    async locationWise(ctx, f) {
        const { from, to } = range(f);
        const n = await this.names(ctx);
        const locations = await this.prisma.location.findMany({ where: (0, scope_1.branchScope)(ctx, f.branchId) });
        const [loans, customers, cols] = await Promise.all([
            this.activeLoans(ctx, f),
            this.prisma.customer.groupBy({ by: ['locationId'], where: { ...(0, scope_1.branchScope)(ctx, f.branchId), status: 'ACTIVE' }, _count: true }),
            this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to), select: { amount: true, customerId: true } }),
        ]);
        const custLoc = new Map((await this.prisma.customer.findMany({ where: { id: { in: [...new Set(cols.map((c) => c.customerId))] } }, select: { id: true, locationId: true } })).map((c) => [c.id, c.locationId]));
        return locations.map((loc) => {
            const mine = loans.filter((l) => l.customer.locationId === loc.id);
            const positions = mine.map((l) => (0, books_service_1.positionOf)(l));
            return {
                location: loc.name,
                branch: n.branch(loc.branchId),
                customers: customers.find((c) => c.locationId === loc.id)?._count ?? 0,
                activeLoans: mine.length,
                outstanding: positions.reduce((s, p) => s + p.totalOutstanding, 0),
                overdue: positions.reduce((s, p) => s + p.overdue, 0),
                collected: cols.filter((c) => custLoc.get(c.customerId) === loc.id).reduce((s, c) => s + c.amount, 0),
            };
        });
    }
    async investorStatement(ctx, f) {
        const { from, to } = range(f);
        const txns = await this.prisma.investorTxn.findMany({
            where: { tenantId: ctx.tenantId, date: { gte: from, lte: to }, ...(f.investorId ? { investorId: f.investorId } : {}) },
            orderBy: { date: 'asc' },
        });
        const investors = await this.prisma.investor.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
        return txns.map((t) => ({ date: t.date, investor: investors.find((i) => i.id === t.investorId)?.name, type: t.type, amount: t.amount, period: t.periodStart ? `${t.periodStart} to ${t.periodEnd}` : '', mode: t.mode, note: t.note }));
    }
    /** Each loan's balance (customer ledger, debits less credits) at the end of `date`. */
    async balancesAt(loanIds, date) {
        const rows = loanIds.length
            ? await this.prisma.ledgerEntry.groupBy({ by: ['loanId'], where: { loanId: { in: loanIds }, date: { lte: date } }, _sum: { debit: true, credit: true } })
            : [];
        return new Map(rows.map((r) => [r.loanId, (r._sum.debit ?? 0) - (r._sum.credit ?? 0)]));
    }
    /**
     * Line list: the month sheet for one line (route), like the owner's Excel sheet. One row per loan in route order with
     * the balance at the start, the amount collected on each day of the month, the month total and the balance at the end.
     * Loans closed during the month are included. Without a route, every line of the branch is listed, line by line.
     */
    async lineList(ctx, f) {
        let from;
        let to;
        if (f.month) {
            from = `${f.month}-01`;
            to = (0, shared_1.addDays)((0, shared_1.addMonthsClamped)(from, 1, 1), -1);
        }
        else
            ({ from, to } = range(f));
        if ((0, shared_1.diffDays)(to, from) > 30)
            throw (0, errors_1.bad)('The line list covers at most 31 days');
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const route = f.routeId ? await this.prisma.route.findFirst({ where: { id: f.routeId, ...scope }, select: { id: true, name: true } }) : null;
        if (f.routeId && !route)
            throw (0, errors_1.notFound)('Route');
        const routeIds = f.routeId ? [f.routeId] : undefined;
        // Loans of the line's customers that were running at some point in the period, plus any loan collected on this line.
        const collectedHere = f.routeId
            ? await this.prisma.collection.findMany({ where: { ...scope, routeId: f.routeId, date: { gte: from, lte: to }, reversedAt: null }, distinct: ['loanId'], select: { loanId: true } })
            : [];
        const loans = await this.prisma.loan.findMany({
            where: {
                ...scope,
                disbursedOn: { not: null },
                OR: [
                    {
                        disbursedOn: { not: null, lte: to },
                        AND: [{ OR: [{ closedOn: null }, { closedOn: { gte: from } }] }],
                        customer: { ...(routeIds ? { routeId: { in: routeIds } } : {}), ...(f.locationId ? { locationId: f.locationId } : {}) },
                    },
                    ...(collectedHere.length ? [{ id: { in: collectedHere.map((c) => c.loanId) } }] : []),
                ],
            },
            select: {
                id: true,
                number: true,
                principal: true,
                disbursedOn: true,
                closedOn: true,
                status: true,
                instalments: { where: { seq: 1 }, select: { principalDue: true, interestDue: true } },
                customer: { select: { id: true, name: true, code: true, phone: true, routeId: true, routeSeq: true } },
            },
        });
        const ids = loans.map((l) => l.id);
        const [opening, closing, cols, n] = await Promise.all([
            this.balancesAt(ids, (0, shared_1.addDays)(from, -1)),
            this.balancesAt(ids, to),
            ids.length ? this.prisma.collection.findMany({ where: { loanId: { in: ids }, date: { gte: from, lte: to }, reversedAt: null }, select: { loanId: true, date: true, amount: true } }) : Promise.resolve([]),
            this.names(ctx),
        ]);
        const days = [];
        for (let d = from; d <= to; d = (0, shared_1.addDays)(d, 1))
            days.push(d);
        const dayIndex = new Map(days.map((d, i) => [d, i]));
        const daily = new Map(ids.map((id) => [id, days.map(() => 0)]));
        for (const c of cols)
            daily.get(c.loanId)[dayIndex.get(c.date)] += c.amount;
        const rows = loans
            .map((l) => {
            const d = daily.get(l.id);
            const first = l.instalments[0];
            return {
                loanId: l.id,
                loan: l.number,
                customerId: l.customer.id,
                customer: l.customer.name,
                code: l.customer.code,
                phone: l.customer.phone,
                route: route?.name ?? (n.route(l.customer.routeId) || '-'),
                routeSeq: !route || l.customer.routeId === route.id ? l.customer.routeSeq : null,
                principal: l.principal,
                instalment: first ? first.principalDue + first.interestDue : 0,
                loanDate: l.disbursedOn,
                closedOn: l.closedOn && l.closedOn <= to ? l.closedOn : null,
                status: l.status,
                opening: opening.get(l.id) ?? 0,
                daily: d,
                total: d.reduce((s, x) => s + x, 0),
                closing: closing.get(l.id) ?? 0,
            };
        })
            .sort((a, b) => a.route.localeCompare(b.route) || (a.routeSeq ?? 1e9) - (b.routeSeq ?? 1e9) || a.customer.localeCompare(b.customer) || a.loanDate.localeCompare(b.loanDate) || a.loan.localeCompare(b.loan));
        const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
        return {
            from,
            to,
            route,
            days,
            rows,
            totals: { opening: sum('opening'), daily: days.map((_, i) => rows.reduce((s, r) => s + r.daily[i], 0)), total: sum('total'), closing: sum('closing') },
        };
    }
    /**
     * Growth month by month for the last N months (ending with the month of `to`, default this month): loans given,
     * collected, income (only with P&L access), loan balance at month end, new customers, closed and running accounts.
     */
    async growth(ctx, f) {
        const count = f.months ?? 12;
        const lastMonthStart = (f.to ?? (0, shared_1.todayIST)()).slice(0, 8) + '01';
        const firstMonthStart = (0, shared_1.addMonthsClamped)(lastMonthStart, -(count - 1), 1);
        const end = (0, shared_1.addDays)((0, shared_1.addMonthsClamped)(lastMonthStart, 1, 1), -1);
        const scope = (0, scope_1.branchScope)(ctx, f.branchId);
        const withIncome = ctx.permissions.has('pl.view');
        const loans = await this.prisma.loan.findMany({
            where: { ...scope, disbursedOn: { not: null, lte: end }, ...(f.productId ? { productId: f.productId } : {}), customer: customerWhere(ctx, f) },
            select: { id: true, customerId: true, principal: true, fee: true, upfrontInterest: true, disbursedOn: true, closedOn: true, migrated: true },
        });
        const ids = loans.map((l) => l.id);
        const [cols, ledger] = await Promise.all([
            ids.length ? this.prisma.collection.findMany({ where: { loanId: { in: ids }, date: { gte: firstMonthStart, lte: end }, reversedAt: null }, select: { date: true, amount: true, interest: true, penalty: true } }) : Promise.resolve([]),
            this.ledgerByDay(ids, end),
        ]);
        // A customer's first loan (within this filter) marks them as new in that month.
        const firstLoan = new Map();
        for (const l of loans)
            if (!firstLoan.has(l.customerId) || l.disbursedOn < firstLoan.get(l.customerId))
                firstLoan.set(l.customerId, l.disbursedOn);
        const rows = [];
        for (let i = 0; i < count; i++) {
            const mFrom = (0, shared_1.addMonthsClamped)(firstMonthStart, i, 1);
            const mTo = (0, shared_1.addDays)((0, shared_1.addMonthsClamped)(mFrom, 1, 1), -1);
            const inMonth = (d) => d != null && d >= mFrom && d <= mTo;
            const given = loans.filter((l) => !l.migrated && inMonth(l.disbursedOn));
            const coll = cols.filter((c) => inMonth(c.date));
            rows.push({
                month: month(mFrom),
                loans: given.length,
                loanAmount: given.reduce((s, l) => s + l.principal, 0),
                collected: coll.reduce((s, c) => s + c.amount, 0),
                interest: withIncome ? coll.reduce((s, c) => s + c.interest, 0) + given.reduce((s, l) => s + l.upfrontInterest, 0) : null,
                fees: withIncome ? given.reduce((s, l) => s + l.fee, 0) : null,
                penalty: withIncome ? coll.reduce((s, c) => s + c.penalty, 0) : null,
                outstanding: ledger.filter((e) => e.date <= mTo).reduce((s, e) => s + e.delta, 0),
                newCustomers: [...firstLoan.values()].filter(inMonth).length,
                closedAccounts: loans.filter((l) => inMonth(l.closedOn)).length,
                closingAccounts: loans.filter((l) => l.disbursedOn <= mTo && (l.closedOn == null || l.closedOn > mTo)).length,
            });
        }
        return rows;
    }
    /** Collections grouped by day of the week (Monday first): receipts, amount, cash and UPI, and the average per such day. */
    async weekdayCollection(ctx, f) {
        const { from, to } = range(f);
        const cols = await this.prisma.collection.findMany({ where: this.collectionWhere(ctx, f, from, to), select: { date: true, amount: true, mode: true } });
        const order = [1, 2, 3, 4, 5, 6, 0];
        const rows = order.map((d) => ({ weekday: d, days: 0, receipts: 0, amount: 0, cash: 0, upi: 0, average: 0 }));
        const at = (d) => rows[order.indexOf((0, shared_1.weekday)(d))];
        // Count each weekday in the period, up to today, so the average is per calendar day of that weekday.
        const last = to < (0, shared_1.todayIST)() ? to : (0, shared_1.todayIST)();
        for (let d = from; d <= last; d = (0, shared_1.addDays)(d, 1))
            at(d).days += 1;
        for (const c of cols) {
            const r = at(c.date);
            r.receipts += 1;
            r.amount += c.amount;
            if (c.mode === 'CASH')
                r.cash += c.amount;
            else
                r.upi += c.amount;
        }
        for (const r of rows)
            r.average = r.days ? Math.round(r.amount / r.days) : 0;
        return rows;
    }
};
exports.ReportsService = ReportsService;
exports.ReportsService = ReportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReportsService);
// =====================================================================
// Dashboard
// =====================================================================
let DashboardService = class DashboardService {
    prisma;
    reports;
    constructor(prisma, reports) {
        this.prisma = prisma;
        this.reports = reports;
    }
    async get(ctx, branchId) {
        const today = (0, shared_1.todayIST)();
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const loans = await this.prisma.loan.findMany({ where: { ...scope, status: 'ACTIVE' }, include: { instalments: true } });
        let dueToday = 0;
        let overdueStart = 0;
        let portfolio = 0;
        const ageing = shared_1.AGEING_BUCKETS.map((b) => ({ bucket: b.key, loans: 0, amount: 0 }));
        for (const l of loans) {
            const p = (0, books_service_1.dayFiguresOf)(l, today);
            portfolio += p.outstanding;
            dueToday += p.dueToday;
            overdueStart += p.overdue;
            const k = (0, shared_1.ageingBucket)(p.daysPastDue);
            if (k) {
                const b = ageing.find((x) => x.bucket === k);
                b.loans++;
                b.amount += p.overdue;
            }
        }
        const [collected, newLoans, pending, agents, routes] = await Promise.all([
            this.prisma.collection.groupBy({ by: ['mode'], where: { ...scope, date: today, reversedAt: null }, _sum: { amount: true } }),
            this.prisma.loan.aggregate({ where: { ...scope, disbursedOn: today }, _count: true, _sum: { netDisbursed: true } }),
            this.prisma.loan.count({ where: { ...scope, status: 'REQUESTED', ...(ctx.role === 'TENANT_ADMIN' ? {} : { stage: 'BRANCH' }) } }),
            this.agentsToday(ctx, branchId, today),
            this.routeProgress(ctx, branchId, today),
        ]);
        const collectedToday = collected.reduce((s, c) => s + (c._sum.amount ?? 0), 0);
        return {
            date: today,
            dueToday,
            overdueAtStart: overdueStart,
            collectedToday,
            collectedCash: collected.find((c) => c.mode === 'CASH')?._sum.amount ?? 0,
            collectedUpi: collected.filter((c) => c.mode !== 'CASH').reduce((s, c) => s + (c._sum.amount ?? 0), 0),
            collectionRate: dueToday ? Math.round((collectedToday / dueToday) * 1000) / 10 : null,
            newLoans: newLoans._count,
            disbursedToday: newLoans._sum.netDisbursed ?? 0,
            activeLoans: loans.length,
            portfolio,
            pendingApprovals: pending,
            ageing,
            agents,
            routes,
        };
    }
    async agentsToday(ctx, branchId, date) {
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const [cols, floats, handovers] = await Promise.all([
            this.prisma.collection.groupBy({ by: ['agentId', 'mode'], where: { ...scope, date, reversedAt: null }, _sum: { amount: true }, _count: true }),
            this.prisma.agentFloat.groupBy({ by: ['agentId'], where: { ...scope, date }, _sum: { amount: true } }),
            this.prisma.handover.findMany({ where: { ...scope, date } }),
        ]);
        const ids = [...new Set([...cols.map((c) => c.agentId), ...floats.map((f) => f.agentId)])];
        const users = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, lastLat: true, lastLng: true, lastSeenAt: true } });
        return ids.map((id) => {
            const cash = cols.filter((c) => c.agentId === id && c.mode === 'CASH').reduce((s, c) => s + (c._sum.amount ?? 0), 0);
            const all = cols.filter((c) => c.agentId === id).reduce((s, c) => s + (c._sum.amount ?? 0), 0);
            const float = floats.find((f) => f.agentId === id)?._sum.amount ?? 0;
            const u = users.find((x) => x.id === id);
            return { agentId: id, name: u?.name, collected: all, cashInHand: handovers.some((h) => h.agentId === id) ? 0 : cash + float, handedOver: handovers.some((h) => h.agentId === id), lastLat: u?.lastLat, lastLng: u?.lastLng, lastSeenAt: u?.lastSeenAt };
        });
    }
    async routeProgress(ctx, branchId, date) {
        const routes = await this.prisma.route.findMany({ where: { ...(0, scope_1.branchScope)(ctx, branchId), active: true }, include: { assignments: true } });
        const active = routes.filter((r) => r.assignments.some((a) => a.fromDate <= date && (!a.toDate || a.toDate >= date)));
        const [customers, cols, visits] = await Promise.all([
            this.prisma.customer.groupBy({ by: ['routeId'], where: { routeId: { in: active.map((r) => r.id) }, status: 'ACTIVE' }, _count: true }),
            this.prisma.collection.findMany({ where: { tenantId: ctx.tenantId, date, routeId: { in: active.map((r) => r.id) }, reversedAt: null }, select: { routeId: true, customerId: true } }),
            this.prisma.visitLog.findMany({ where: { tenantId: ctx.tenantId, date }, select: { customerId: true } }),
        ]);
        const visitCustomers = await this.prisma.customer.findMany({ where: { id: { in: visits.map((v) => v.customerId) } }, select: { id: true, routeId: true } });
        const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
        return active.map((r) => {
            const visited = new Set([...cols.filter((c) => c.routeId === r.id).map((c) => c.customerId), ...visitCustomers.filter((v) => v.routeId === r.id).map((v) => v.id)]);
            return {
                routeId: r.id,
                name: r.name,
                agents: r.assignments.filter((a) => a.fromDate <= date && (!a.toDate || a.toDate >= date)).map((a) => users.find((u) => u.id === a.userId)?.name),
                customers: customers.find((c) => c.routeId === r.id)?._count ?? 0,
                visited: visited.size,
            };
        });
    }
    /**
     * What needs this user's attention, for the "Action needed" strip and the Approvals badge.
     * Each count is null when the user lacks the right to act on it. Look-back items cover the last ACTION_DAYS days.
     */
    async actions(ctx, branchId) {
        const today = (0, shared_1.todayIST)();
        const since = (0, shared_1.addDays)(today, -ACTION_DAYS);
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const has = (p) => ctx.permissions.has(p);
        const [pendingApprovals, toDisburse, handovers, dayBooks, flaggedCollections, missedPromises, dayBookApprovals] = await Promise.all([
            // Same queue as GET /loans?queue=approvals: managers act on the branch stage, the Tenant Admin on everything.
            has('loan.approve') ? this.prisma.loan.count({ where: { ...scope, status: 'REQUESTED', ...(ctx.role === 'TENANT_ADMIN' ? {} : { stage: 'BRANCH' }) } }) : null,
            has('loan.disburse') ? this.prisma.loan.count({ where: { ...scope, status: 'APPROVED' } }) : null,
            has('handover.verify') ? this.handoversWaiting(ctx, scope, since, today) : null,
            has('daybook.manage') ? this.dayBooksOpen(scope, since, today) : null,
            has('report.view') ? this.prisma.collection.count({ where: { ...scope, flagged: true, reversedAt: null, date: { gte: since, lte: today } } }) : null,
            // Supervisors see every agent's promises; an agent sees only the ones they took.
            has('report.view') || has('collection.record') ? this.missedPromises(ctx, scope, since, today, !has('report.view')) : null,
            // Day book entries from staff waiting for this manager; their own entries are not theirs to decide.
            has('daybook.approve') ? this.prisma.daybookRequest.count({ where: { ...scope, status: 'PENDING', requestedById: { not: ctx.userId } } }) : null,
        ]);
        return { date: today, since, pendingApprovals, toDisburse, handovers, dayBooks, flaggedCollections, missedPromises, dayBookApprovals };
    }
    /** Agent-days with cash collected or a float given but no handover yet (the same rule that blocks a day close). */
    async handoversWaiting(ctx, scope, since, today) {
        const date = { gte: since, lte: today };
        const [cols, floats, done] = await Promise.all([
            this.prisma.collection.groupBy({ by: ['branchId', 'agentId', 'date'], where: { ...scope, date, reversedAt: null, mode: 'CASH' } }),
            this.prisma.agentFloat.groupBy({ by: ['branchId', 'agentId', 'date'], where: { ...scope, date } }),
            this.prisma.handover.findMany({ where: { tenantId: ctx.tenantId, date }, select: { agentId: true, date: true } }),
        ]);
        const handed = new Set(done.map((h) => `${h.agentId}|${h.date}`));
        const waiting = new Map();
        for (const r of [...cols, ...floats])
            if (!handed.has(`${r.agentId}|${r.date}`))
                waiting.set(`${r.agentId}|${r.date}`, { branchId: r.branchId, date: r.date });
        return { count: waiting.size, ...oldest([...waiting.values()]) };
    }
    /** Past branch-days with day book entries that nobody has closed. */
    async dayBooksOpen(scope, since, today) {
        const date = { gte: since, lt: today };
        const [days, closes] = await Promise.all([
            this.prisma.daybookEntry.groupBy({ by: ['branchId', 'date'], where: { ...scope, date } }),
            this.prisma.dayClose.findMany({ where: { ...scope, date }, select: { branchId: true, date: true } }),
        ]);
        const closed = new Set(closes.map((c) => `${c.branchId}|${c.date}`));
        const open = days.filter((d) => !closed.has(`${d.branchId}|${d.date}`));
        return { count: open.length, ...oldest(open) };
    }
    /** Customers whose latest promise to pay fell due by today with no payment on or after that date. */
    async missedPromises(ctx, scope, since, today, ownOnly) {
        const visits = await this.prisma.visitLog.findMany({
            where: { tenantId: ctx.tenantId, outcome: 'PROMISED', promiseDate: { gte: since, lte: today }, ...(ownOnly ? { agentId: ctx.userId } : {}) },
            orderBy: { visitedAt: 'desc' },
            distinct: ['customerId'],
            select: { customerId: true, promiseDate: true },
        });
        if (!visits.length)
            return 0;
        const ids = visits.map((v) => v.customerId);
        const [customers, paid] = await Promise.all([
            this.prisma.customer.findMany({ where: { ...scope, id: { in: ids } }, select: { id: true } }),
            this.prisma.collection.findMany({ where: { ...scope, customerId: { in: ids }, date: { gte: since }, reversedAt: null }, select: { customerId: true, date: true } }),
        ]);
        const inScope = new Set(customers.map((c) => c.id));
        return visits.filter((v) => inScope.has(v.customerId) && !paid.some((p) => p.customerId === v.customerId && p.date >= v.promiseDate)).length;
    }
    /** Counts behind the first-run "Get started" checklist; a step is done when its count is above zero. */
    async setup(ctx) {
        const today = (0, shared_1.todayIST)();
        const t = { tenantId: ctx.tenantId };
        const [branches, locations, routes, agents, assignedRoutes, products, fundedFunds] = await Promise.all([
            this.prisma.branch.count({ where: { ...t, active: true } }),
            this.prisma.location.count({ where: { ...t, active: true } }),
            this.prisma.route.count({ where: { ...t, active: true } }),
            this.prisma.user.count({ where: { ...t, active: true, role: { baseRole: 'COLLECTION_AGENT' } } }),
            this.prisma.routeAssignment.count({ where: { ...t, route: { active: true }, OR: [{ toDate: null }, { toDate: { gte: today } }] } }),
            this.prisma.loanProduct.count({ where: { ...t, active: true } }),
            this.prisma.fund.count({ where: { ...t, active: true, balance: { gt: 0 } } }),
        ]);
        return { branches, locations, routes, agents, assignedRoutes, products, fundedFunds };
    }
};
exports.DashboardService = DashboardService;
exports.DashboardService = DashboardService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        ReportsService])
], DashboardService);
/** How far back the "Action needed" strip looks for handovers, open day books, flags and promises. */
const ACTION_DAYS = 7;
/** The earliest of some branch-days, so a link can open the page on that day. */
const oldest = (rows) => {
    const first = [...rows].sort((a, b) => a.date.localeCompare(b.date))[0];
    return first ? { date: first.date, branchId: first.branchId } : { date: null, branchId: null };
};
const filter = shared_1.reportFilterSchema.extend({ investorId: zod_1.z.string().optional() });
const lineListQuery = shared_1.reportFilterSchema.extend({ month: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional() });
const growthQuery = shared_1.reportFilterSchema.extend({ months: zod_1.z.coerce.number().int().min(1).max(36).optional() });
const summaryQuery = zod_1.z.object({
    period: zod_1.z.enum(['DAY', 'WEEK', 'MONTH']).default('DAY'),
    date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    branchId: zod_1.z.string().optional(),
    routeId: zod_1.z.string().optional(),
    agentId: zod_1.z.string().optional(),
});
let ReportsController = class ReportsController {
    reports;
    pl;
    dashboard;
    prisma;
    constructor(reports, pl, dashboard, prisma) {
        this.reports = reports;
        this.pl = pl;
        this.dashboard = dashboard;
        this.prisma = prisma;
    }
    dash(ctx, branchId) {
        return this.dashboard.get(ctx, branchId);
    }
    actions(ctx, branchId) {
        return this.dashboard.actions(ctx, branchId);
    }
    setup(ctx) {
        return this.dashboard.setup(ctx);
    }
    daily(ctx, f) {
        return this.reports.dailyCollection(ctx, f);
    }
    collectionSummary(ctx, q) {
        return this.reports.collectionSummary(ctx, q);
    }
    dailyStatement(ctx, f) {
        return this.reports.dailyStatement(ctx, f);
    }
    pendingList(ctx, f) {
        return this.reports.pendingList(ctx, f);
    }
    async lineAbstract(ctx, f) {
        const [abstract, pl] = await Promise.all([this.reports.lineAbstract(ctx, f), ctx.permissions.has('pl.view') ? this.pl.compute(ctx, f) : null]);
        return { ...abstract, profit: pl ? { income: pl.totalIncome, costs: pl.totalIncome - pl.netProfit, net: pl.netProfit } : null };
    }
    lineList(ctx, f) {
        return this.reports.lineList(ctx, f);
    }
    growth(ctx, f) {
        return this.reports.growth(ctx, f);
    }
    weekday(ctx, f) {
        return this.reports.weekdayCollection(ctx, f);
    }
    disb(ctx, f) {
        return this.reports.disbursements(ctx, f);
    }
    schemes(ctx, f) {
        return this.reports.schemeWise(ctx, f);
    }
    out(ctx, f) {
        return this.reports.outstanding(ctx, f);
    }
    ageing(ctx, f) {
        return this.reports.ageing(ctx, f);
    }
    dvc(ctx, f) {
        return this.reports.demandVsCollection(ctx, f);
    }
    agents(ctx, f) {
        return this.reports.agentPerformance(ctx, f);
    }
    cash(ctx, f) {
        return this.reports.cashDifferences(ctx, f);
    }
    funds(ctx, f) {
        return this.reports.fundUtilisation(ctx, f);
    }
    income(ctx, f) {
        return this.reports.income(ctx, f);
    }
    closed(ctx, f) {
        return this.reports.closedLoans(ctx, f);
    }
    loc(ctx, f) {
        return this.reports.locationWise(ctx, f);
    }
    inv(ctx, f) {
        return this.reports.investorStatement(ctx, f);
    }
    profitLoss(ctx, f) {
        return this.pl.report(ctx, f);
    }
    async audit(ctx, entity, entityId, page = '1') {
        const take = 100;
        const where = { tenantId: ctx.tenantId, ...(entity ? { entity } : {}), ...(entityId ? { entityId } : {}) };
        const [rows, total] = await Promise.all([
            this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip: (Math.max(1, Number(page)) - 1) * take }),
            this.prisma.auditLog.count({ where }),
        ]);
        const users = await this.prisma.user.findMany({ where: { id: { in: rows.map((r) => r.userId).filter(Boolean) } }, select: { id: true, name: true } });
        return { total, rows: rows.map((r) => ({ ...r, userName: users.find((u) => u.id === r.userId)?.name })) };
    }
};
exports.ReportsController = ReportsController;
__decorate([
    (0, common_1.Get)('dashboard'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "dash", null);
__decorate([
    (0, common_1.Get)('dashboard/actions'),
    (0, context_1.Perm)('report.view', 'loan.approve', 'loan.disburse', 'handover.verify', 'daybook.manage', 'daybook.approve', 'collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "actions", null);
__decorate([
    (0, common_1.Get)('dashboard/setup'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "setup", null);
__decorate([
    (0, common_1.Get)('reports/daily-collection'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "daily", null);
__decorate([
    (0, common_1.Get)('reports/collection-summary'),
    (0, context_1.Perm)('collection.record', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(summaryQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "collectionSummary", null);
__decorate([
    (0, common_1.Get)('reports/daily-statement'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "dailyStatement", null);
__decorate([
    (0, common_1.Get)('reports/pending-list'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "pendingList", null);
__decorate([
    (0, common_1.Get)('reports/line-abstract'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "lineAbstract", null);
__decorate([
    (0, common_1.Get)('reports/line-list'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(lineListQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "lineList", null);
__decorate([
    (0, common_1.Get)('reports/growth'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(growthQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "growth", null);
__decorate([
    (0, common_1.Get)('reports/weekday'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "weekday", null);
__decorate([
    (0, common_1.Get)('reports/disbursements'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "disb", null);
__decorate([
    (0, common_1.Get)('reports/scheme-wise'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "schemes", null);
__decorate([
    (0, common_1.Get)('reports/outstanding'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "out", null);
__decorate([
    (0, common_1.Get)('reports/ageing'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "ageing", null);
__decorate([
    (0, common_1.Get)('reports/demand-vs-collection'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "dvc", null);
__decorate([
    (0, common_1.Get)('reports/agent-performance'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "agents", null);
__decorate([
    (0, common_1.Get)('reports/cash-differences'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "cash", null);
__decorate([
    (0, common_1.Get)('reports/fund-utilisation'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "funds", null);
__decorate([
    (0, common_1.Get)('reports/income'),
    (0, context_1.Perm)('pl.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "income", null);
__decorate([
    (0, common_1.Get)('reports/closed-loans'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "closed", null);
__decorate([
    (0, common_1.Get)('reports/location-wise'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "loc", null);
__decorate([
    (0, common_1.Get)('reports/investor-statement'),
    (0, context_1.Perm)('investor.manage', 'pl.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "inv", null);
__decorate([
    (0, common_1.Get)('reports/profit-loss'),
    (0, context_1.Perm)('pl.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(filter))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], ReportsController.prototype, "profitLoss", null);
__decorate([
    (0, common_1.Get)('audit'),
    (0, context_1.Perm)('audit.view', 'staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('entity')),
    __param(2, (0, common_1.Query)('entityId')),
    __param(3, (0, common_1.Query)('page')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, Object]),
    __metadata("design:returntype", Promise)
], ReportsController.prototype, "audit", null);
exports.ReportsController = ReportsController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [ReportsService,
        ProfitLossService,
        DashboardService,
        prisma_service_1.PrismaService])
], ReportsController);
//# sourceMappingURL=reports.js.map