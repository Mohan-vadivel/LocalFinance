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
exports.SalaryController = exports.SalaryService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const books_service_1 = require("../common/books.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
/** Salary lines go to the day book under this expense category, so profit and loss counts them. */
const SALARY_CATEGORY = 'Salary';
/**
 * Staff salaries: a monthly amount per person, advances paid ahead of it, and each month's payment net of the
 * advances taken back. Every rupee paid out is a day book line. Never open to collection agents.
 */
let SalaryService = class SalaryService {
    prisma;
    books;
    audit;
    constructor(prisma, books, audit) {
        this.prisma = prisma;
        this.books = books;
        this.audit = audit;
    }
    check(ctx) {
        // A custom role could be given the right by mistake; agents never handle salaries.
        if (ctx.role === 'COLLECTION_AGENT')
            throw (0, errors_1.forbidden)();
    }
    /** Staff of this business the caller may see: everyone for all-branch roles, else staff of their branches. */
    staffWhere(ctx) {
        return { tenantId: ctx.tenantId, ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) };
    }
    async staff(ctx, userId) {
        const u = await this.prisma.user.findFirst({ where: { id: userId, ...this.staffWhere(ctx) }, select: { id: true, name: true } });
        if (!u)
            throw (0, errors_1.notFound)('Staff');
        return u;
    }
    async category(tx, tenantId) {
        const c = await tx.expenseCategory.findFirst({ where: { tenantId, name: SALARY_CATEGORY } });
        return c ?? tx.expenseCategory.create({ data: { tenantId, name: SALARY_CATEGORY, kind: 'EXPENSE' } });
    }
    /** Advances given less advances taken back, per person. */
    async outstanding(db, ctx, userIds) {
        const scope = (0, scope_1.branchScope)(ctx);
        const [adv, ded] = await Promise.all([
            db.salaryAdvance.groupBy({ by: ['userId'], where: { ...scope, userId: { in: userIds } }, _sum: { amount: true } }),
            db.salaryPayment.groupBy({ by: ['userId'], where: { ...scope, userId: { in: userIds } }, _sum: { advanceDeducted: true } }),
        ]);
        return new Map(userIds.map((id) => [id, (adv.find((a) => a.userId === id)?._sum.amount ?? 0) - (ded.find((d) => d.userId === id)?._sum.advanceDeducted ?? 0)]));
    }
    /** One month: each staff member's salary, whether it is paid, and advances outstanding. */
    async month(ctx, q) {
        this.check(ctx);
        const month = q.month ?? (0, shared_1.todayIST)().slice(0, 7);
        if (q.branchId)
            (0, scope_1.assertBranch)(ctx, q.branchId);
        const users = await this.prisma.user.findMany({
            where: { ...this.staffWhere(ctx), ...(q.branchId ? { AND: [{ branches: { some: { branchId: q.branchId } } }] } : {}) },
            select: { id: true, name: true, phone: true, active: true, role: { select: { name: true, baseRole: true } }, branches: { select: { branchId: true, branch: { select: { name: true } } } } },
            orderBy: { name: 'asc' },
        });
        const ids = users.map((u) => u.id);
        const [rates, payments, given, outstanding] = await Promise.all([
            this.prisma.staffSalary.findMany({ where: { tenantId: ctx.tenantId, userId: { in: ids } } }),
            this.prisma.salaryPayment.findMany({ where: { ...(0, scope_1.branchScope)(ctx), month, userId: { in: ids } } }),
            this.prisma.salaryAdvance.groupBy({ by: ['userId'], where: { ...(0, scope_1.branchScope)(ctx), userId: { in: ids }, date: { startsWith: month } }, _sum: { amount: true } }),
            this.outstanding(this.prisma, ctx, ids),
        ]);
        const rows = users
            .map((u) => {
            const salary = rates.find((r) => r.userId === u.id)?.amount ?? 0;
            const payment = payments.find((p) => p.userId === u.id) ?? null;
            const advance = outstanding.get(u.id) ?? 0;
            return {
                userId: u.id,
                name: u.name,
                phone: u.phone,
                active: u.active,
                roleName: u.role.name,
                baseRole: u.role.baseRole,
                branchIds: u.branches.map((b) => b.branchId),
                branches: u.branches.map((b) => b.branch.name).join(', '),
                salary,
                advancesThisMonth: given.find((g) => g.userId === u.id)?._sum.amount ?? 0,
                advanceOutstanding: advance,
                // What paying now would hand over, taking back all outstanding advances up to the salary.
                netDue: payment ? 0 : Math.max(0, salary - Math.min(advance, salary)),
                status: payment ? 'PAID' : salary > 0 ? 'UNPAID' : 'NO_SALARY',
                payment,
            };
        })
            .filter((r) => r.active || r.payment || r.advanceOutstanding > 0);
        return {
            month,
            rows,
            totals: {
                salary: rows.reduce((s, r) => s + r.salary, 0),
                paid: rows.reduce((s, r) => s + (r.payment?.net ?? 0), 0),
                unpaid: rows.filter((r) => r.status === 'UNPAID').reduce((s, r) => s + r.netDue, 0),
                advanceOutstanding: rows.reduce((s, r) => s + r.advanceOutstanding, 0),
            },
        };
    }
    /** A person's advances and salary payments, newest first. */
    async history(ctx, userId) {
        this.check(ctx);
        const u = await this.staff(ctx, userId);
        const [advances, payments, outstanding] = await Promise.all([
            this.prisma.salaryAdvance.findMany({ where: { ...(0, scope_1.branchScope)(ctx), userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
            this.prisma.salaryPayment.findMany({ where: { ...(0, scope_1.branchScope)(ctx), userId }, orderBy: { month: 'desc' } }),
            this.outstanding(this.prisma, ctx, [userId]),
        ]);
        return { userId, name: u.name, advanceOutstanding: outstanding.get(userId) ?? 0, advances, payments };
    }
    async setRate(ctx, userId, input) {
        this.check(ctx);
        await this.staff(ctx, userId);
        const before = await this.prisma.staffSalary.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId } } });
        const r = await this.prisma.staffSalary.upsert({
            where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
            create: { tenantId: ctx.tenantId, userId, amount: input.amount },
            update: { amount: input.amount },
        });
        await this.audit.log(ctx, 'SET_SALARY', 'StaffSalary', r.id, before ? { amount: before.amount } : undefined, { userId, amount: input.amount });
        return r;
    }
    async branchAndDate(ctx, branchId, date) {
        (0, scope_1.assertBranch)(ctx, branchId);
        await (0, scope_1.assertOwned)(this.prisma.branch, ctx, branchId, 'Branch');
        if (date > (0, shared_1.todayIST)())
            throw (0, errors_1.bad)('Entries cannot be in the future');
    }
    /** Money given ahead of salary, paid out through the day book at once. */
    async advance(ctx, input) {
        this.check(ctx);
        const u = await this.staff(ctx, input.userId);
        await this.branchAndDate(ctx, input.branchId, input.date);
        const a = await this.prisma.tx(async (tx) => {
            const cat = await this.category(tx, ctx.tenantId);
            const row = await tx.salaryAdvance.create({
                data: { tenantId: ctx.tenantId, branchId: input.branchId, userId: u.id, date: input.date, amount: input.amount, mode: input.mode, note: input.note ?? null, createdById: ctx.userId },
            });
            const e = await this.books.daybook(tx, {
                tenantId: ctx.tenantId,
                branchId: input.branchId,
                date: input.date,
                direction: 'OUT',
                amount: input.amount,
                mode: input.mode,
                particulars: `Salary advance to ${u.name}${input.note ? `: ${input.note}` : ''}`,
                categoryId: cat.id,
                source: 'MANUAL',
                refType: 'SalaryAdvance',
                refId: row.id,
                userId: ctx.userId,
            });
            return tx.salaryAdvance.update({ where: { id: row.id }, data: { daybookEntryId: e?.id ?? null } });
        });
        await this.audit.log(ctx, 'SALARY_ADVANCE', 'SalaryAdvance', a.id, undefined, input);
        return a;
    }
    /**
     * Pays one month's salary. Outstanding advances are taken back from it (all of them, up to the salary, unless a
     * smaller amount is given) and only the rest is paid out through the day book. A month is paid once.
     */
    async pay(ctx, input) {
        this.check(ctx);
        const u = await this.staff(ctx, input.userId);
        await this.branchAndDate(ctx, input.branchId, input.date);
        if (input.month > (0, shared_1.todayIST)().slice(0, 7))
            throw (0, errors_1.bad)('This month has not started yet');
        const rate = await this.prisma.staffSalary.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: u.id } } });
        if (!rate?.amount)
            throw (0, errors_1.bad)('Set a monthly salary for this person first');
        const gross = rate.amount;
        try {
            const p = await this.prisma.tx(async (tx) => {
                if (await tx.salaryPayment.findFirst({ where: { tenantId: ctx.tenantId, userId: u.id, month: input.month } }))
                    throw (0, errors_1.conflict)('This month is already paid');
                const outstanding = (await this.outstanding(tx, ctx, [u.id])).get(u.id) ?? 0;
                const deduct = input.advanceDeduct ?? Math.min(outstanding, gross);
                if (deduct > outstanding)
                    throw (0, errors_1.bad)('That is more than the advances outstanding');
                if (deduct > gross)
                    throw (0, errors_1.bad)('That is more than the salary');
                const cat = await this.category(tx, ctx.tenantId);
                const row = await tx.salaryPayment.create({
                    data: {
                        tenantId: ctx.tenantId,
                        branchId: input.branchId,
                        userId: u.id,
                        month: input.month,
                        date: input.date,
                        gross,
                        advanceDeducted: deduct,
                        net: gross - deduct,
                        mode: input.mode,
                        note: input.note ?? null,
                        createdById: ctx.userId,
                    },
                });
                // Nothing is posted when advances cover the whole salary: that money left the day book as the advance.
                const e = await this.books.daybook(tx, {
                    tenantId: ctx.tenantId,
                    branchId: input.branchId,
                    date: input.date,
                    direction: 'OUT',
                    amount: gross - deduct,
                    mode: input.mode,
                    particulars: `Salary ${input.month} to ${u.name}${deduct ? ` (advance ${(0, shared_1.formatINR)(deduct)} taken back)` : ''}`,
                    categoryId: cat.id,
                    source: 'MANUAL',
                    refType: 'SalaryPayment',
                    refId: row.id,
                    userId: ctx.userId,
                });
                return tx.salaryPayment.update({ where: { id: row.id }, data: { daybookEntryId: e?.id ?? null } });
            });
            await this.audit.log(ctx, 'PAY_SALARY', 'SalaryPayment', p.id, undefined, { ...input, gross, advanceDeducted: p.advanceDeducted, net: p.net });
            return p;
        }
        catch (e) {
            // Two people paying the same month at once: the unique key stops the second.
            if (e instanceof client_1.Prisma.PrismaClientKnownRequestError && e.code === 'P2002')
                throw (0, errors_1.conflict)('This month is already paid');
            throw e;
        }
    }
};
exports.SalaryService = SalaryService;
exports.SalaryService = SalaryService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        books_service_1.BooksService,
        audit_service_1.AuditService])
], SalaryService);
const monthQuery = zod_1.z.object({ month: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), branchId: zod_1.z.string().optional() });
let SalaryController = class SalaryController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    month(ctx, q) {
        return this.svc.month(ctx, q);
    }
    history(ctx, userId) {
        return this.svc.history(ctx, userId);
    }
    setRate(ctx, userId, b) {
        return this.svc.setRate(ctx, userId, b);
    }
    advance(ctx, b) {
        return this.svc.advance(ctx, b);
    }
    pay(ctx, b) {
        return this.svc.pay(ctx, b);
    }
};
exports.SalaryController = SalaryController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(monthQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], SalaryController.prototype, "month", null);
__decorate([
    (0, common_1.Get)('staff/:userId'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], SalaryController.prototype, "history", null);
__decorate([
    (0, common_1.Put)('staff/:userId'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('userId')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.salaryRateSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], SalaryController.prototype, "setRate", null);
__decorate([
    (0, common_1.Post)('advances'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.salaryAdvanceSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], SalaryController.prototype, "advance", null);
__decorate([
    (0, common_1.Post)('payments'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.salaryPaySchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], SalaryController.prototype, "pay", null);
exports.SalaryController = SalaryController = __decorate([
    (0, common_1.Controller)('salaries'),
    (0, context_1.Perm)('salary.manage'),
    __metadata("design:paramtypes", [SalaryService])
], SalaryController);
//# sourceMappingURL=salary.js.map