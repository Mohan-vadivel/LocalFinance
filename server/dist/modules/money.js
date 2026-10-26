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
exports.HandoverController = exports.HandoverService = exports.DaybookController = exports.DaybookService = exports.InvestorsController = exports.InvestorsService = exports.FundsController = exports.FundsService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const books_service_1 = require("../common/books.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
const reports_1 = require("./reports");
const bankSide = (mode) => (mode === 'CASH' ? 'cash' : 'bank');
// =====================================================================
// Funds
// =====================================================================
let FundsService = class FundsService {
    prisma;
    books;
    audit;
    constructor(prisma, books, audit) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
    }
    async list(ctx, branchId) {
        const funds = await this.prisma.fund.findMany({ where: (0, scope_1.branchScope)(ctx, branchId), orderBy: [{ branchId: 'asc' }, { name: 'asc' }] });
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
    async create(ctx, input) {
        (0, scope_1.assertBranch)(ctx, input.branchId);
        if (!(await this.prisma.branch.findFirst({ where: { id: input.branchId, tenantId: ctx.tenantId } })))
            throw (0, errors_1.notFound)('Branch');
        if (await this.prisma.fund.findFirst({ where: { tenantId: ctx.tenantId, branchId: input.branchId, name: input.name } }))
            throw (0, errors_1.conflict)('A fund with this name exists in the branch');
        await (0, scope_1.assertOwned)(this.prisma.investor, ctx, input.investorId, 'Investor');
        const f = await this.prisma.fund.create({ data: { ...input, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'CREATE', 'Fund', f.id, undefined, input);
        return f;
    }
    async fund(ctx, id) {
        const f = await this.prisma.fund.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!f)
            throw (0, errors_1.notFound)('Fund');
        (0, scope_1.assertBranch)(ctx, f.branchId);
        return f;
    }
    async txns(ctx, id) {
        await this.fund(ctx, id);
        return this.prisma.fundTxn.findMany({ where: { fundId: id }, orderBy: { createdAt: 'desc' }, take: 500 });
    }
    /** Owner capital or a bank loan coming in. Investor money comes in through an investment instead. */
    async deposit(ctx, id, input) {
        const f = await this.fund(ctx, id);
        if (f.sourceType === 'INVESTOR')
            throw (0, errors_1.bad)('Add investor money through Investors so returns are tracked');
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
    async transfer(ctx, input) {
        const from = await this.fund(ctx, input.fromFundId);
        if (!input.toFundId === !input.toUserId)
            throw (0, errors_1.bad)('Choose either a fund or an agent to transfer to');
        await this.prisma.tx(async (tx) => {
            await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: from.id, amount: -input.amount, type: input.toUserId ? 'FLOAT_OUT' : 'TRANSFER_OUT', date: input.date, note: input.note ?? undefined, userId: ctx.userId });
            if (input.toFundId) {
                const to = await tx.fund.findFirst({ where: { id: input.toFundId, tenantId: ctx.tenantId } });
                if (!to)
                    throw (0, errors_1.notFound)('Fund');
                if (to.id === from.id)
                    throw (0, errors_1.bad)('Choose a different fund');
                await this.books.moveFund(tx, { tenantId: ctx.tenantId, fundId: to.id, amount: input.amount, type: 'TRANSFER_IN', date: input.date, note: input.note ?? undefined, userId: ctx.userId });
                if (to.branchId !== from.branchId) {
                    const base = { tenantId: ctx.tenantId, date: input.date, amount: input.amount, mode: input.mode, refType: 'FundTransfer', userId: ctx.userId };
                    await this.books.daybook(tx, { ...base, branchId: from.branchId, direction: 'OUT', particulars: `Transfer to ${to.name}`, systemCategory: 'FUND_TRANSFER_OUT' });
                    await this.books.daybook(tx, { ...base, branchId: to.branchId, direction: 'IN', particulars: `Transfer from ${from.name}`, systemCategory: 'FUND_TRANSFER_IN' });
                }
            }
            else {
                const agent = await tx.user.findFirst({ where: { id: input.toUserId, tenantId: ctx.tenantId, active: true } });
                if (!agent)
                    throw (0, errors_1.notFound)('Agent');
                // The float leaves the fund but stays the branch's cash: it comes back at handover.
                await tx.agentFloat.create({ data: { tenantId: ctx.tenantId, branchId: from.branchId, agentId: agent.id, fundId: from.id, date: input.date, amount: input.amount, createdById: ctx.userId } });
            }
        });
        await this.audit.log(ctx, 'TRANSFER', 'Fund', from.id, undefined, input);
        return { ok: true };
    }
};
exports.FundsService = FundsService;
exports.FundsService = FundsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService])
], FundsService);
let FundsController = class FundsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(ctx, branchId) {
        return this.svc.list(ctx, branchId);
    }
    create(ctx, b) {
        return this.svc.create(ctx, b);
    }
    txns(ctx, id) {
        return this.svc.txns(ctx, id);
    }
    deposit(ctx, id, b) {
        return this.svc.deposit(ctx, id, b);
    }
    transfer(ctx, b) {
        return this.svc.transfer(ctx, b);
    }
};
exports.FundsController = FundsController;
__decorate([
    (0, common_1.Get)(),
    (0, context_1.Perm)('fund.manage', 'loan.disburse', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FundsController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, context_1.Perm)('fund.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.fundSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], FundsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id/transactions'),
    (0, context_1.Perm)('fund.manage', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], FundsController.prototype, "txns", null);
__decorate([
    (0, common_1.Post)(':id/deposit'),
    (0, context_1.Perm)('fund.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.fundDepositSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], FundsController.prototype, "deposit", null);
__decorate([
    (0, common_1.Post)('transfer'),
    (0, context_1.Perm)('fund.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.fundTransferSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], FundsController.prototype, "transfer", null);
exports.FundsController = FundsController = __decorate([
    (0, common_1.Controller)('funds'),
    __metadata("design:paramtypes", [FundsService])
], FundsController);
// =====================================================================
// Investors
// =====================================================================
let InvestorsService = class InvestorsService {
    prisma;
    books;
    audit;
    pl;
    constructor(prisma, books, audit, pl) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
        this.pl = pl;
    }
    async list(ctx) {
        const investors = await this.prisma.investor.findMany({ where: { tenantId: ctx.tenantId }, include: { investments: { include: { txns: true } } }, orderBy: { name: 'asc' } });
        return investors.map(({ investments, ...i }) => ({ ...i, ...this.totals(investments.flatMap((x) => x.txns)), investments: investments.length }));
    }
    totals(txns) {
        const sum = (t) => txns.filter((x) => x.type === t).reduce((s, x) => s + x.amount, 0);
        const invested = sum('INVESTMENT');
        const withdrawn = sum('WITHDRAWAL');
        const returnsEarned = sum('RETURN_DUE');
        const paidOut = sum('PAYOUT');
        return { invested, withdrawn, principalBalance: invested - withdrawn, returnsEarned, paidOut, balanceDue: returnsEarned - paidOut };
    }
    async get(ctx, id) {
        const i = await this.prisma.investor.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { investments: { include: { txns: { orderBy: { createdAt: 'asc' } } }, orderBy: { date: 'asc' } } } });
        if (!i)
            throw (0, errors_1.notFound)('Investor');
        const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
        return {
            ...i,
            ...this.totals(i.investments.flatMap((x) => x.txns)),
            investments: i.investments.map((inv) => ({ ...inv, branchName: branches.find((b) => b.id === inv.branchId)?.name, ...this.totals(inv.txns) })),
        };
    }
    async save(ctx, input, id) {
        if (id) {
            const before = await this.prisma.investor.findFirst({ where: { id, tenantId: ctx.tenantId } });
            if (!before)
                throw (0, errors_1.notFound)('Investor');
            const u = await this.prisma.investor.update({ where: { id }, data: input });
            await this.audit.log(ctx, 'UPDATE', 'Investor', id, before, input);
            return u;
        }
        const c = await this.prisma.investor.create({ data: { ...input, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'CREATE', 'Investor', c.id, undefined, input);
        return c;
    }
    async invest(ctx, input) {
        const investor = await this.prisma.investor.findFirst({ where: { id: input.investorId, tenantId: ctx.tenantId } });
        if (!investor)
            throw (0, errors_1.notFound)('Investor');
        const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId } });
        if (!fund || fund.branchId !== input.branchId)
            throw (0, errors_1.bad)('Choose a fund of the selected branch');
        if (input.maturityDate && input.maturityDate <= input.date)
            throw (0, errors_1.bad)('Maturity date must be after the investment date');
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
    async runReturns(ctx, input) {
        if (input.periodEnd < input.periodStart)
            throw (0, errors_1.bad)('Period end is before period start');
        const investments = await this.prisma.investment.findMany({
            where: { tenantId: ctx.tenantId, status: 'ACTIVE', date: { lte: input.periodEnd } },
            include: { txns: true, investor: true },
        });
        const created = [];
        const profitCache = new Map();
        for (const inv of investments) {
            if (inv.txns.some((t) => t.type === 'RETURN_DUE' && t.periodStart === input.periodStart && t.periodEnd === input.periodEnd))
                continue;
            const principal = inv.txns.filter((t) => t.type === 'INVESTMENT').reduce((s, t) => s + t.amount, 0) - inv.txns.filter((t) => t.type === 'WITHDRAWAL').reduce((s, t) => s + t.amount, 0);
            if (principal <= 0)
                continue;
            const start = inv.date > input.periodStart ? inv.date : input.periodStart;
            const end = inv.maturityDate && inv.maturityDate < input.periodEnd ? inv.maturityDate : input.periodEnd;
            const days = (0, shared_1.diffDays)(end, start) + 1;
            if (days <= 0)
                continue;
            let amount = 0;
            if (inv.returnType === 'FIXED_MONTHLY') {
                // Pro-rated by days using a 30-day month.
                amount = Math.round((principal * inv.returnRate * days) / 100 / 30);
            }
            else {
                if (!profitCache.has(inv.branchId)) {
                    const pl = await this.pl.compute(ctx, { from: input.periodStart, to: input.periodEnd, branchId: inv.branchId }, { excludeInvestorReturns: true });
                    profitCache.set(inv.branchId, pl.netProfit);
                }
                const profit = profitCache.get(inv.branchId);
                const branchInvestor = investments
                    .filter((x) => x.branchId === inv.branchId && x.returnType === 'PROFIT_SHARE')
                    .reduce((s, x) => s + x.txns.filter((t) => t.type === 'INVESTMENT').reduce((a, t) => a + t.amount, 0) - x.txns.filter((t) => t.type === 'WITHDRAWAL').reduce((a, t) => a + t.amount, 0), 0);
                amount = profit > 0 && branchInvestor > 0 ? Math.round(((profit * inv.returnRate) / 100) * (principal / branchInvestor)) : 0;
            }
            if (amount <= 0)
                continue;
            await this.prisma.investorTxn.create({
                data: { tenantId: ctx.tenantId, investmentId: inv.id, investorId: inv.investorId, type: 'RETURN_DUE', amount, date: input.periodEnd, periodStart: input.periodStart, periodEnd: input.periodEnd, createdById: ctx.userId },
            });
            created.push({ investmentId: inv.id, investor: inv.investor.name, amount });
        }
        await this.audit.log(ctx, 'RUN_RETURNS', 'Investment', null, undefined, { ...input, created });
        return { created, total: created.reduce((s, c) => s + c.amount, 0) };
    }
    /** A payout of returns or a withdrawal of principal; Tenant Admin approval is required (`investor.manage` + role). */
    async payout(ctx, input) {
        if (ctx.role !== 'TENANT_ADMIN')
            throw (0, errors_1.forbidden)('Investor payouts are approved by the Tenant Admin');
        const inv = await this.prisma.investment.findFirst({ where: { id: input.investmentId, tenantId: ctx.tenantId }, include: { txns: true, investor: true } });
        if (!inv)
            throw (0, errors_1.notFound)('Investment');
        const t = this.totals(inv.txns);
        if (input.kind === 'PAYOUT' && input.amount > t.balanceDue)
            throw (0, errors_1.bad)('Payout is more than the returns due');
        if (input.kind === 'WITHDRAWAL' && input.amount > t.principalBalance)
            throw (0, errors_1.bad)('Withdrawal is more than the invested balance');
        const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId } });
        if (!fund)
            throw (0, errors_1.notFound)('Fund');
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
            if (input.kind === 'WITHDRAWAL' && input.amount === t.principalBalance)
                await tx.investment.update({ where: { id: inv.id }, data: { status: 'CLOSED' } });
        });
        await this.audit.log(ctx, input.kind, 'Investment', inv.id, undefined, input);
        return this.get(ctx, inv.investorId);
    }
    /** Returns due, period by period, for investments whose next payout date has come. */
    async duePayouts(ctx) {
        const today = (0, shared_1.todayIST)();
        const invs = await this.prisma.investment.findMany({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, include: { txns: true, investor: true } });
        return invs
            .map((inv) => {
            const t = this.totals(inv.txns);
            const lastPayout = inv.txns.filter((x) => x.type === 'PAYOUT').map((x) => x.date).sort().pop() ?? inv.date;
            const next = (0, shared_1.addMonthsClamped)(lastPayout, inv.payoutFrequencyMonths, Number(lastPayout.slice(8)));
            return { investmentId: inv.id, investor: inv.investor.name, balanceDue: t.balanceDue, nextPayout: next, due: next <= today && t.balanceDue > 0 };
        })
            .filter((x) => x.balanceDue > 0);
    }
};
exports.InvestorsService = InvestorsService;
exports.InvestorsService = InvestorsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService,
        reports_1.ProfitLossService])
], InvestorsService);
let InvestorsController = class InvestorsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(ctx) {
        return this.svc.list(ctx);
    }
    due(ctx) {
        return this.svc.duePayouts(ctx);
    }
    get(ctx, id) {
        return this.svc.get(ctx, id);
    }
    create(ctx, b) {
        return this.svc.save(ctx, b);
    }
    update(ctx, id, b) {
        return this.svc.save(ctx, b, id);
    }
    invest(ctx, b) {
        return this.svc.invest(ctx, b);
    }
    run(ctx, b) {
        return this.svc.runReturns(ctx, b);
    }
    payout(ctx, b) {
        return this.svc.payout(ctx, b);
    }
};
exports.InvestorsController = InvestorsController;
__decorate([
    (0, common_1.Get)(),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('payouts-due'),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "due", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, context_1.Perm)('investor.manage', 'pl.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "get", null);
__decorate([
    (0, common_1.Post)(),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.investorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.investorSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('investments'),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.investmentSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "invest", null);
__decorate([
    (0, common_1.Post)('returns/run'),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.investorReturnRunSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "run", null);
__decorate([
    (0, common_1.Post)('payouts'),
    (0, context_1.Perm)('investor.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.investorPayoutSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], InvestorsController.prototype, "payout", null);
exports.InvestorsController = InvestorsController = __decorate([
    (0, common_1.Controller)('investors'),
    __metadata("design:paramtypes", [InvestorsService])
], InvestorsController);
// =====================================================================
// Day book and day close
// =====================================================================
let DaybookService = class DaybookService {
    prisma;
    books;
    audit;
    constructor(prisma, books, audit) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
    }
    categories(ctx) {
        return this.prisma.expenseCategory.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
    }
    async createCategory(ctx, input) {
        if (await this.prisma.expenseCategory.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } }))
            throw (0, errors_1.conflict)('Category exists');
        return this.prisma.expenseCategory.create({ data: { ...input, tenantId: ctx.tenantId } });
    }
    /** Balances carried into a date: from the last close before it, plus entries after that close. */
    async opening(tenantId, branchId, date) {
        const lastClose = await this.prisma.dayClose.findFirst({ where: { tenantId, branchId, date: { lt: date } }, orderBy: { date: 'desc' } });
        const since = lastClose?.date;
        const entries = await this.prisma.daybookEntry.findMany({ where: { tenantId, branchId, date: { lt: date, ...(since ? { gt: since } : {}) } } });
        const bal = { cash: lastClose?.closingCash ?? 0, bank: lastClose?.closingBank ?? 0 };
        for (const e of entries)
            bal[bankSide(e.mode)] += e.direction === 'IN' ? e.amount : -e.amount;
        return bal;
    }
    /** One branch's day (or a range) with opening and closing cash and bank. branchId omitted = all branches combined. */
    async view(ctx, q) {
        const to = q.to ?? q.from;
        const scope = (0, scope_1.branchScope)(ctx, q.branchId);
        const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId, ...(scope.branchId ? { id: scope.branchId } : {}) } });
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
        const reqIds = entries.filter((e) => e.refType === 'DaybookRequest' && e.refId).map((e) => e.refId);
        const approvals = reqIds.length ? await this.prisma.daybookRequest.findMany({ where: { tenantId: ctx.tenantId, id: { in: reqIds } }, select: { id: true, decidedById: true } }) : [];
        const closing = { ...opening };
        let receipts = 0;
        let payments = 0;
        for (const e of entries) {
            closing[bankSide(e.mode)] += e.direction === 'IN' ? e.amount : -e.amount;
            if (e.direction === 'IN')
                receipts += e.amount;
            else
                payments += e.amount;
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
    async addEntry(ctx, input) {
        (0, scope_1.assertBranch)(ctx, input.branchId);
        await (0, scope_1.assertOwned)(this.prisma.branch, ctx, input.branchId, 'Branch');
        const cat = await this.prisma.expenseCategory.findFirst({ where: { id: input.categoryId, tenantId: ctx.tenantId } });
        if (!cat)
            throw (0, errors_1.notFound)('Category');
        if (input.date > (0, shared_1.todayIST)())
            throw (0, errors_1.bad)('Entries cannot be in the future');
        if (!ctx.permissions.has('daybook.approve')) {
            if (await this.prisma.dayClose.findUnique({ where: { branchId_date: { branchId: input.branchId, date: input.date } } }))
                throw (0, errors_1.bad)('That day is already closed', 'errors.dayClosed');
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
        const e = await this.prisma.tx((tx) => this.books.daybook(tx, {
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
        }));
        await this.audit.log(ctx, 'CREATE', 'DaybookEntry', e?.id, undefined, input);
        return e;
    }
    /**
     * Day book entries waiting for, or past, a branch manager's decision. Approvers and day book viewers see their
     * branches; everyone else sees only what they entered or were made responsible for.
     */
    async requests(ctx, q) {
        const all = ctx.permissions.has('daybook.approve') || ctx.permissions.has('daybook.view');
        const rows = await this.prisma.daybookRequest.findMany({
            where: {
                ...(0, scope_1.branchScope)(ctx, q.branchId),
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
        const name = (id) => (id ? users.find((u) => u.id === id)?.name : undefined);
        return rows.map((r) => ({
            ...r,
            branchName: branches.find((b) => b.id === r.branchId)?.name,
            categoryName: categories.find((c) => c.id === r.categoryId)?.name,
            requestedByName: name(r.requestedById),
            decidedByName: name(r.decidedById),
            responsibleName: name(r.responsibleId),
        }));
    }
    async pendingRequest(ctx, id) {
        const r = await this.prisma.daybookRequest.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!r)
            throw (0, errors_1.notFound)('Day book entry');
        (0, scope_1.assertBranch)(ctx, r.branchId);
        if (r.status !== 'PENDING')
            throw (0, errors_1.bad)('This entry has already been decided');
        if (r.requestedById === ctx.userId)
            throw (0, errors_1.forbidden)('You cannot approve or reject your own entry');
        return r;
    }
    /** Posts the entry to the day book on the day it was entered for, in the name of the person who entered it. */
    async approve(ctx, id) {
        const r = await this.pendingRequest(ctx, id);
        const e = await this.prisma.tx(async (tx) => {
            // Claims the request first, so two managers approving at once cannot post it twice.
            const claimed = await tx.daybookRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', decidedById: ctx.userId, decidedAt: new Date() } });
            if (!claimed.count)
                throw (0, errors_1.bad)('This entry has already been decided');
            const entry = await this.books.daybook(tx, {
                tenantId: r.tenantId,
                branchId: r.branchId,
                date: r.date,
                direction: r.direction,
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
    async reject(ctx, id, input) {
        const r = await this.pendingRequest(ctx, id);
        const responsibleId = input.responsibleId ?? r.requestedById;
        await (0, scope_1.assertOwned)(this.prisma.user, ctx, responsibleId, 'Staff');
        const claimed = await this.prisma.daybookRequest.updateMany({
            where: { id, status: 'PENDING' },
            data: { status: 'REJECTED', decidedById: ctx.userId, decidedAt: new Date(), reason: input.reason, responsibleId },
        });
        if (!claimed.count)
            throw (0, errors_1.bad)('This entry has already been decided');
        await this.audit.log(ctx, 'REJECT', 'DaybookRequest', id, r, { ...input, responsibleId });
        return this.prisma.daybookRequest.findUnique({ where: { id } });
    }
    /** Locks a day. Blocked until every agent who collected cash that day has handed over. */
    async close(ctx, input) {
        (0, scope_1.assertBranch)(ctx, input.branchId);
        await (0, scope_1.assertOwned)(this.prisma.branch, ctx, input.branchId, 'Branch');
        if (input.date > (0, shared_1.todayIST)())
            throw (0, errors_1.bad)('Cannot close a future day');
        if (await this.prisma.dayClose.findUnique({ where: { branchId_date: input } }))
            throw (0, errors_1.bad)('That day is already closed', 'errors.dayClosed');
        const agents = await this.prisma.collection.groupBy({ by: ['agentId'], where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date, reversedAt: null, mode: 'CASH' } });
        const floats = await this.prisma.agentFloat.groupBy({ by: ['agentId'], where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date } });
        const agentIds = [...new Set([...agents.map((a) => a.agentId), ...floats.map((f) => f.agentId)])];
        const handovers = await this.prisma.handover.findMany({ where: { tenantId: ctx.tenantId, agentId: { in: agentIds }, date: input.date } });
        const pending = agentIds.filter((a) => !handovers.some((h) => h.agentId === a));
        if (pending.length) {
            const names = await this.prisma.user.findMany({ where: { id: { in: pending } }, select: { name: true } });
            throw (0, errors_1.bad)(`Waiting for cash handover from ${names.map((n) => n.name).join(', ')}`);
        }
        const waiting = await this.prisma.daybookRequest.count({ where: { tenantId: ctx.tenantId, branchId: input.branchId, date: input.date, status: 'PENDING' } });
        if (waiting)
            throw (0, errors_1.bad)(`Waiting for the branch manager to approve or reject ${waiting} day book ${waiting === 1 ? 'entry' : 'entries'}`, 'errors.daybookApprovalsPending');
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
    async reopen(ctx, input) {
        if (ctx.role !== 'TENANT_ADMIN')
            throw (0, errors_1.forbidden)('Only the Tenant Admin can reopen a closed day');
        await (0, scope_1.assertOwned)(this.prisma.branch, ctx, input.branchId, 'Branch');
        const closes = await this.prisma.dayClose.findMany({ where: { tenantId: ctx.tenantId, branchId: input.branchId, date: { gte: input.date } } });
        if (!closes.length)
            throw (0, errors_1.bad)('That day is not closed');
        await this.prisma.dayClose.deleteMany({ where: { id: { in: closes.map((c) => c.id) } } });
        await this.audit.log(ctx, 'REOPEN_DAY', 'DayClose', null, closes, input);
        return { reopened: closes.map((c) => c.date) };
    }
};
exports.DaybookService = DaybookService;
exports.DaybookService = DaybookService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService])
], DaybookService);
const daybookQuery = zod_1.z.object({ branchId: zod_1.z.string().optional(), from: zod_1.z.string(), to: zod_1.z.string().optional() });
const requestsQuery = zod_1.z.object({ branchId: zod_1.z.string().optional(), status: zod_1.z.enum(shared_1.DAYBOOK_REQUEST_STATUSES).optional(), from: zod_1.z.string().optional(), to: zod_1.z.string().optional() });
let DaybookController = class DaybookController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    view(ctx, q) {
        return this.svc.view(ctx, q);
    }
    categories(ctx) {
        return this.svc.categories(ctx);
    }
    createCategory(ctx, b) {
        return this.svc.createCategory(ctx, b);
    }
    add(ctx, b) {
        return this.svc.addEntry(ctx, b);
    }
    requests(ctx, q) {
        return this.svc.requests(ctx, q);
    }
    approve(ctx, id) {
        return this.svc.approve(ctx, id);
    }
    reject(ctx, id, b) {
        return this.svc.reject(ctx, id, b);
    }
    close(ctx, b) {
        return this.svc.close(ctx, b);
    }
    reopen(ctx, b) {
        return this.svc.reopen(ctx, b);
    }
};
exports.DaybookController = DaybookController;
__decorate([
    (0, common_1.Get)(),
    (0, context_1.Perm)('daybook.view', 'daybook.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(daybookQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "view", null);
__decorate([
    (0, common_1.Get)('categories'),
    (0, context_1.Perm)('daybook.view', 'daybook.manage', 'daybook.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "categories", null);
__decorate([
    (0, common_1.Post)('categories'),
    (0, context_1.Perm)('daybook.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.expenseCategorySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "createCategory", null);
__decorate([
    (0, common_1.Post)('entries'),
    (0, context_1.Perm)('daybook.manage', 'daybook.request', 'daybook.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.daybookEntrySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "add", null);
__decorate([
    (0, common_1.Get)('requests'),
    (0, context_1.Perm)('daybook.view', 'daybook.manage', 'daybook.request', 'daybook.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(requestsQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "requests", null);
__decorate([
    (0, common_1.Post)('requests/:id/approve'),
    (0, context_1.Perm)('daybook.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "approve", null);
__decorate([
    (0, common_1.Post)('requests/:id/reject'),
    (0, context_1.Perm)('daybook.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.daybookRejectSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "reject", null);
__decorate([
    (0, common_1.Post)('close'),
    (0, context_1.Perm)('daybook.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.dayCloseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "close", null);
__decorate([
    (0, common_1.Post)('reopen'),
    (0, context_1.Perm)('daybook.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.dayCloseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], DaybookController.prototype, "reopen", null);
exports.DaybookController = DaybookController = __decorate([
    (0, common_1.Controller)('daybook'),
    __metadata("design:paramtypes", [DaybookService])
], DaybookController);
// =====================================================================
// Cash handover
// =====================================================================
let HandoverService = class HandoverService {
    prisma;
    books;
    audit;
    constructor(prisma, books, audit) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
    }
    /** Expected cash per agent for a branch day: floats given plus cash collected. */
    async pending(ctx, branchId, date) {
        (0, scope_1.assertBranch)(ctx, branchId);
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
    async verify(ctx, input) {
        if (input.agentId === ctx.userId)
            throw (0, errors_1.forbidden)('Someone else must confirm your handover');
        const rows = await this.pending(ctx, input.branchId, input.date);
        const row = rows.find((r) => r.agentId === input.agentId);
        if (!row)
            throw (0, errors_1.bad)('This agent has nothing to hand over for that day');
        if (row.handover)
            throw (0, errors_1.bad)('Already handed over');
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
    async list(ctx, q) {
        const rows = await this.prisma.handover.findMany({
            where: {
                ...(0, scope_1.branchScope)(ctx, q.branchId),
                ...(q.from || q.to ? { date: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
                ...(q.differencesOnly ? { difference: { not: 0 } } : {}),
            },
            orderBy: { date: 'desc' },
        });
        const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
        return rows.map((r) => ({ ...r, agentName: users.find((u) => u.id === r.agentId)?.name, verifiedByName: users.find((u) => u.id === r.verifiedById)?.name }));
    }
};
exports.HandoverService = HandoverService;
exports.HandoverService = HandoverService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService])
], HandoverService);
let HandoverController = class HandoverController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    pending(ctx, branchId, date) {
        if (!branchId)
            throw (0, errors_1.bad)('Choose a branch');
        return this.svc.pending(ctx, branchId, date ?? (0, shared_1.todayIST)());
    }
    list(ctx, from, to, branchId, d) {
        return this.svc.list(ctx, { from, to, branchId, differencesOnly: d === 'true' });
    }
    verify(ctx, b) {
        return this.svc.verify(ctx, b);
    }
};
exports.HandoverController = HandoverController;
__decorate([
    (0, common_1.Get)('pending'),
    (0, context_1.Perm)('handover.verify'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], HandoverController.prototype, "pending", null);
__decorate([
    (0, common_1.Get)(),
    (0, context_1.Perm)('handover.verify', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('from')),
    __param(2, (0, common_1.Query)('to')),
    __param(3, (0, common_1.Query)('branchId')),
    __param(4, (0, common_1.Query)('differencesOnly')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String, String, String]),
    __metadata("design:returntype", void 0)
], HandoverController.prototype, "list", null);
__decorate([
    (0, common_1.Post)(),
    (0, context_1.Perm)('handover.verify'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.handoverSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], HandoverController.prototype, "verify", null);
exports.HandoverController = HandoverController = __decorate([
    (0, common_1.Controller)('handovers'),
    __metadata("design:paramtypes", [HandoverService])
], HandoverController);
//# sourceMappingURL=money.js.map