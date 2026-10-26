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
exports.LoansController = exports.LoansService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const crypto_1 = require("crypto");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const books_service_1 = require("../common/books.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const notify_service_1 = require("../common/notify.service");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
const collections_1 = require("./collections");
const termsOf = (l) => ({
    principal: l.principal,
    frequency: l.frequency,
    tenure: l.tenure,
    interestMethod: l.interestMethod,
    interestRate: l.interestRate,
    feePercent: l.feePercent,
    feeFlat: l.feeFlat,
});
let LoansService = class LoansService {
    prisma;
    books;
    audit;
    notify;
    collections;
    constructor(prisma, books, audit, notify, collections) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
        this.notify = notify;
        this.collections = collections;
    }
    // ---------- Products ----------
    products(ctx, all = false) {
        return this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId, ...(all ? {} : { active: true }) }, orderBy: { name: 'asc' } });
    }
    async saveProduct(ctx, input, id) {
        if (input.minAmount > input.maxAmount)
            throw (0, errors_1.bad)('Minimum amount is more than the maximum');
        (0, errors_1.rule)(() => (0, shared_1.summarize)({ ...input, principal: input.minAmount })); // validates fees against the smallest loan
        if (id) {
            const p = await this.prisma.loanProduct.findFirst({ where: { id, tenantId: ctx.tenantId } });
            if (!p)
                throw (0, errors_1.notFound)('Product');
            const u = await this.prisma.loanProduct.update({ where: { id }, data: input });
            await this.audit.log(ctx, 'UPDATE', 'LoanProduct', id, p, input);
            return u;
        }
        if (await this.prisma.loanProduct.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } }))
            throw (0, errors_1.conflict)('A product with this name exists');
        const p = await this.prisma.loanProduct.create({ data: { ...input, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'CREATE', 'LoanProduct', p.id, undefined, input);
        return p;
    }
    // ---------- Queries ----------
    async list(ctx, q) {
        const take = 50;
        const page = Math.max(1, q.page ?? 1);
        const where = {
            ...(0, scope_1.branchScope)(ctx, q.branchId),
            ...(q.status ? { status: { in: q.status.split(',') } } : {}),
            ...(q.stage ? { stage: q.stage } : {}),
            ...(q.customerId ? { customerId: q.customerId } : {}),
            ...(q.q ? { OR: [{ number: { contains: q.q, mode: 'insensitive' } }, { legacyNo: { equals: q.q.trim(), mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }, { customer: { phone: { contains: q.q } } }] } : {}),
        };
        if (q.queue === 'approvals') {
            // What this user can act on: managers see branch stage, Tenant Admin sees everything waiting.
            where.status = 'REQUESTED';
            if (ctx.role !== 'TENANT_ADMIN')
                where.stage = 'BRANCH';
        }
        if (q.queue === 'mine')
            where.requestedById = ctx.userId;
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
                position: l.status === 'ACTIVE' ? (0, books_service_1.positionOf)({ ...l, instalments }) : null,
            })),
        };
    }
    async get(ctx, id) {
        const l = await this.prisma.loan.findFirst({
            where: { id, tenantId: ctx.tenantId },
            include: { instalments: { orderBy: { seq: 'asc' } }, approvals: { orderBy: { createdAt: 'asc' } }, customer: true },
        });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        const [collections, ledger, users, product, fund] = await Promise.all([
            this.prisma.collection.findMany({ where: { loanId: id }, orderBy: { collectedAt: 'desc' } }),
            this.prisma.ledgerEntry.findMany({ where: { loanId: id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
            this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.loanProduct.findUnique({ where: { id: l.productId } }),
            l.fundId ? this.prisma.fund.findUnique({ where: { id: l.fundId } }) : null,
        ]);
        const name = (uid) => users.find((u) => u.id === uid)?.name;
        return {
            ...l,
            productName: product?.name,
            fundName: fund?.name,
            requestedByName: name(l.requestedById),
            approvedByName: name(l.approvedById),
            approvals: l.approvals.map((a) => ({ ...a, userName: name(a.userId) })),
            position: l.status === 'ACTIVE' ? (0, books_service_1.positionOf)(l) : null,
            summary: (0, shared_1.summarize)(termsOf(l)),
            collections: collections.map((c) => ({ ...c, agentName: name(c.agentId) })),
            ledger,
        };
    }
    /** Shows the schedule and cash to customer before a request is raised. */
    async preview(ctx, input) {
        const product = await this.product(ctx, input.productId);
        const terms = { ...termsOf({ ...product, principal: input.principal }) };
        const start = input.disbursedOn ?? (0, shared_1.todayIST)();
        return (0, errors_1.rule)(() => ({
            summary: (0, shared_1.summarize)(terms),
            schedule: (0, shared_1.generateSchedule)(terms, (0, shared_1.defaultFirstDue)(start, terms.frequency), ctx.settings),
        }));
    }
    async product(ctx, id) {
        const p = await this.prisma.loanProduct.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!p)
            throw (0, errors_1.notFound)('Product');
        return p;
    }
    // ---------- Request and approval ----------
    async request(ctx, input) {
        if (input.clientRef) {
            const existing = await this.prisma.loan.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
            if (existing)
                return existing;
        }
        const customer = await this.prisma.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId } });
        if (!customer)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, customer.branchId);
        if (customer.status !== 'ACTIVE')
            throw (0, errors_1.bad)('This customer is blacklisted or closed');
        const product = await this.product(ctx, input.productId);
        if (!product.active)
            throw (0, errors_1.bad)('This product is no longer offered');
        if (input.principal < product.minAmount || input.principal > product.maxAmount) {
            throw (0, errors_1.bad)(`Amount must be between ${(0, shared_1.formatINR)(product.minAmount)} and ${(0, shared_1.formatINR)(product.maxAmount)}`);
        }
        (0, errors_1.rule)(() => (0, shared_1.summarize)(termsOf({ ...product, principal: input.principal })));
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        if ((await this.prisma.loan.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } })) >= t.maxActiveLoans) {
            throw (0, errors_1.bad)(`Your plan allows ${t.maxActiveLoans} active loans`);
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
    async resubmit(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        if (!['SENT_BACK', 'REQUESTED'].includes(l.status))
            throw (0, errors_1.bad)('Only open requests can be changed');
        const product = await this.product(ctx, input.productId);
        if (input.principal < product.minAmount || input.principal > product.maxAmount)
            throw (0, errors_1.bad)('Amount is outside the product range');
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
    async decide(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        if (l.status !== 'REQUESTED')
            throw (0, errors_1.bad)('This request is not waiting for a decision');
        if (l.requestedById === ctx.userId && ctx.role !== 'TENANT_ADMIN')
            throw (0, errors_1.forbidden)('You cannot approve your own request');
        if (l.stage === 'ADMIN' && ctx.role !== 'TENANT_ADMIN')
            throw (0, errors_1.forbidden)('This request is waiting for the Tenant Admin');
        if (input.decision !== 'APPROVE' && !input.reason)
            throw (0, errors_1.bad)('Give a reason');
        const isAdmin = ctx.role === 'TENANT_ADMIN';
        const step = l.stage;
        let data;
        let decision = input.decision;
        if (input.decision === 'APPROVE') {
            if (isAdmin || l.principal <= ctx.approvalLimit) {
                data = { status: 'APPROVED', approvedById: ctx.userId, approvedAt: new Date() };
            }
            else {
                // Above this manager's limit: their approval is a recommendation and the request goes to the Tenant Admin.
                data = { stage: 'ADMIN' };
                decision = 'RECOMMEND';
            }
        }
        else if (input.decision === 'REJECT') {
            data = { status: 'REJECTED' };
        }
        else {
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
    async disburse(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { customer: true } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        if (l.status !== 'APPROVED')
            throw (0, errors_1.bad)('Only approved loans can be disbursed');
        const fund = await this.prisma.fund.findFirst({ where: { id: input.fundId, tenantId: ctx.tenantId, active: true } });
        if (!fund)
            throw (0, errors_1.notFound)('Fund');
        if (fund.branchId !== l.branchId)
            throw (0, errors_1.bad)('Use a fund of the loan\'s branch');
        const terms = termsOf(l);
        const summary = (0, errors_1.rule)(() => (0, shared_1.summarize)(terms));
        const firstDue = input.firstDueDate ?? (0, shared_1.defaultFirstDue)(input.disbursedOn, terms.frequency);
        if (firstDue <= input.disbursedOn)
            throw (0, errors_1.bad)('First due date must be after the disbursement date');
        const schedule = (0, errors_1.rule)(() => (0, shared_1.generateSchedule)(terms, firstDue, ctx.settings));
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
            if (updated.count !== 1)
                throw (0, errors_1.conflict)('This loan was already disbursed');
            await tx.instalment.createMany({
                data: schedule.map((r) => ({ tenantId: ctx.tenantId, loanId: id, seq: r.seq, dueDate: r.dueDate, principalDue: r.principalDue, interestDue: r.interestDue })),
            });
            const owed = schedule.reduce((s, r) => s + r.totalDue, 0);
            await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: id, customerId: l.customerId, date: input.disbursedOn, type: 'DISBURSEMENT', description: `Loan ${l.number} disbursed (${(0, shared_1.formatINR)(summary.netDisbursed)} paid out)`, debit: owed });
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
            amount: (0, shared_1.formatINR)(l.principal),
            date: input.disbursedOn,
            instalment: (0, shared_1.formatINR)(first.totalDue),
            frequency: l.frequency.toLowerCase(),
        }, ctx.settings.smsTemplates?.disbursement)
            .catch(() => undefined);
        return this.get(ctx, id);
    }
    // ---------- After disbursement ----------
    async foreclose(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        const pos = (0, books_service_1.positionOf)(l, input.date);
        const expected = pos.totalOutstanding - input.interestWaived;
        if (input.interestWaived > pos.interestOutstanding)
            throw (0, errors_1.bad)('Waiver is more than the unpaid interest');
        if (input.amount !== expected)
            throw (0, errors_1.bad)(`Foreclosure amount must be ${(0, shared_1.formatINR)(expected)}`);
        const res = await this.prisma.tx((tx) => this.collections.applyPayment(tx, ctx, id, {
            amount: input.amount,
            mode: input.mode,
            date: input.date,
            collectedAt: new Date(),
            clientRef: `foreclose-${(0, crypto_1.randomUUID)()}`,
            note: input.reason,
            kind: 'FORECLOSURE',
            waiveInterest: input.interestWaived,
        }));
        await this.audit.log(ctx, 'FORECLOSE', 'Loan', id, undefined, input);
        return { ...res, loan: await this.get(ctx, id) };
    }
    async writeOff(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        if (l.status !== 'ACTIVE')
            throw (0, errors_1.bad)('Only active loans can be written off');
        const pos = (0, books_service_1.positionOf)(l, input.date);
        await this.prisma.tx(async (tx) => {
            await tx.loan.update({ where: { id }, data: { status: 'WRITTEN_OFF', writtenOffAmount: pos.principalOutstanding, closedOn: input.date } });
            await this.books.ledger(tx, { tenantId: ctx.tenantId, loanId: id, customerId: l.customerId, date: input.date, type: 'WRITE_OFF', description: `Written off: ${input.reason}`, credit: pos.principalOutstanding + pos.interestOutstanding });
        });
        await this.audit.log(ctx, 'WRITE_OFF', 'Loan', id, pos, input);
        return this.get(ctx, id);
    }
    async waivePenalty(ctx, id, input) {
        const l = await this.prisma.loan.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { instalments: true } });
        if (!l)
            throw (0, errors_1.notFound)('Loan');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        const pos = (0, books_service_1.positionOf)(l);
        if (input.amount > pos.penaltyOutstanding)
            throw (0, errors_1.bad)(`Only ${(0, shared_1.formatINR)(pos.penaltyOutstanding)} penalty is outstanding`);
        const closes = pos.principalOutstanding + pos.interestOutstanding === 0 && input.amount === pos.penaltyOutstanding;
        await this.prisma.loan.update({ where: { id }, data: { penaltyWaived: { increment: input.amount }, ...(closes ? { status: 'CLOSED', closedOn: (0, shared_1.todayIST)() } : {}) } });
        await this.audit.log(ctx, 'WAIVE_PENALTY', 'Loan', id, undefined, input);
        return this.get(ctx, id);
    }
};
exports.LoansService = LoansService;
exports.LoansService = LoansService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService,
        notify_service_1.NotifyService,
        collections_1.CollectionsService])
], LoansService);
const listQuery = zod_1.z.object({
    status: zod_1.z.string().optional(),
    stage: zod_1.z.string().optional(),
    branchId: zod_1.z.string().optional(),
    customerId: zod_1.z.string().optional(),
    q: zod_1.z.string().optional(),
    queue: zod_1.z.enum(['approvals', 'mine']).optional(),
    page: zod_1.z.coerce.number().int().positive().optional(),
});
const previewSchema = zod_1.z.object({ productId: zod_1.z.string(), principal: zod_1.z.number().int().positive(), disbursedOn: zod_1.z.string().optional() });
let LoansController = class LoansController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    products(ctx, all) {
        return this.svc.products(ctx, all === 'true');
    }
    createProduct(ctx, b) {
        return this.svc.saveProduct(ctx, b);
    }
    updateProduct(ctx, id, b) {
        return this.svc.saveProduct(ctx, b, id);
    }
    list(ctx, q) {
        return this.svc.list(ctx, q);
    }
    get(ctx, id) {
        return this.svc.get(ctx, id);
    }
    preview(ctx, b) {
        return this.svc.preview(ctx, b);
    }
    request(ctx, b) {
        return this.svc.request(ctx, b);
    }
    resubmit(ctx, id, b) {
        return this.svc.resubmit(ctx, id, b);
    }
    decide(ctx, id, b) {
        return this.svc.decide(ctx, id, b);
    }
    disburse(ctx, id, b) {
        return this.svc.disburse(ctx, id, b);
    }
    foreclose(ctx, id, b) {
        return this.svc.foreclose(ctx, id, b);
    }
    writeOff(ctx, id, b) {
        return this.svc.writeOff(ctx, id, b);
    }
    waive(ctx, id, b) {
        return this.svc.waivePenalty(ctx, id, b);
    }
};
exports.LoansController = LoansController;
__decorate([
    (0, common_1.Get)('products'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('all')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "products", null);
__decorate([
    (0, common_1.Post)('products'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.productSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "createProduct", null);
__decorate([
    (0, common_1.Put)('products/:id'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.productSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "updateProduct", null);
__decorate([
    (0, common_1.Get)('loans'),
    (0, context_1.Perm)('customer.view', 'loan.request', 'loan.approve', 'report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(listQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('loans/:id'),
    (0, context_1.Perm)('customer.view', 'loan.request', 'loan.approve', 'collection.record'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('loans/preview'),
    (0, context_1.Perm)('loan.request', 'loan.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(previewSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('loans'),
    (0, context_1.Perm)('loan.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.loanRequestSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "request", null);
__decorate([
    (0, common_1.Put)('loans/:id'),
    (0, context_1.Perm)('loan.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.loanRequestSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "resubmit", null);
__decorate([
    (0, common_1.Post)('loans/:id/decision'),
    (0, context_1.Perm)('loan.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.loanDecisionSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "decide", null);
__decorate([
    (0, common_1.Post)('loans/:id/disburse'),
    (0, context_1.Perm)('loan.disburse'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.disburseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "disburse", null);
__decorate([
    (0, common_1.Post)('loans/:id/foreclose'),
    (0, context_1.Perm)('loan.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.forecloseSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "foreclose", null);
__decorate([
    (0, common_1.Post)('loans/:id/write-off'),
    (0, context_1.Perm)('loan.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.writeOffSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "writeOff", null);
__decorate([
    (0, common_1.Post)('loans/:id/waive-penalty'),
    (0, context_1.Perm)('loan.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.waivePenaltySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], LoansController.prototype, "waive", null);
exports.LoansController = LoansController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [LoansService])
], LoansController);
//# sourceMappingURL=loans.js.map