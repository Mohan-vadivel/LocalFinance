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
exports.CustomersController = exports.CustomersService = void 0;
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
let CustomersService = class CustomersService {
    prisma;
    audit;
    books;
    constructor(prisma, audit, books) {
        this.prisma = prisma;
        this.audit = audit;
        this.books = books;
    }
    async list(ctx, q) {
        const take = 50;
        const page = Math.max(1, q.page ?? 1);
        const where = {
            ...(0, scope_1.branchScope)(ctx, q.branchId),
            ...(q.locationId ? { locationId: q.locationId } : {}),
            ...(q.routeId ? { routeId: q.routeId } : {}),
            ...(q.status ? { status: q.status } : {}),
            ...(q.q
                ? {
                    OR: [
                        { name: { contains: q.q, mode: 'insensitive' } },
                        { phone: { contains: q.q } },
                        { code: { contains: q.q, mode: 'insensitive' } },
                        { idNumber: { contains: q.q, mode: 'insensitive' } },
                        { loans: { some: { number: { contains: q.q, mode: 'insensitive' } } } },
                        { loans: { some: { legacyNo: { equals: q.q.trim(), mode: 'insensitive' } } } },
                    ],
                }
                : {}),
        };
        const [rows, total] = await Promise.all([
            this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip: (page - 1) * take }),
            this.prisma.customer.count({ where }),
        ]);
        const [locations, routes] = await Promise.all([
            this.prisma.location.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
            this.prisma.route.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
        ]);
        return {
            total,
            page,
            pageSize: take,
            rows: rows.map((c) => ({
                ...c,
                locationName: locations.find((l) => l.id === c.locationId)?.name,
                routeName: routes.find((r) => r.id === c.routeId)?.name,
            })),
        };
    }
    async get(ctx, id) {
        const c = await this.prisma.customer.findFirst({
            where: { id, tenantId: ctx.tenantId },
            include: { loans: { include: { instalments: true }, orderBy: { createdAt: 'desc' } } },
        });
        if (!c)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        const docs = await this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, customerId: id } });
        const { loans, ...rest } = c;
        return {
            ...rest,
            documents: docs,
            loans: loans.map(({ instalments, ...l }) => ({
                ...l,
                position: ['ACTIVE'].includes(l.status) ? (0, books_service_1.positionOf)({ ...l, instalments }) : null,
            })),
        };
    }
    async resolvePlace(ctx, input, currentLocationId) {
        const loc = await this.prisma.location.findFirst({ where: { id: input.locationId, tenantId: ctx.tenantId } });
        if (!loc)
            throw (0, errors_1.notFound)('Location');
        (0, scope_1.assertBranch)(ctx, loc.branchId);
        // An inactive area takes no new customers; a customer who is already in it can be edited.
        if (!loc.active && loc.id !== currentLocationId)
            throw (0, errors_1.bad)('This area is inactive. Choose an active area.', 'structure.areaInactive');
        if (input.routeId) {
            const r = await this.prisma.route.findFirst({ where: { id: input.routeId, tenantId: ctx.tenantId } });
            if (!r)
                throw (0, errors_1.notFound)('Route');
            // The customer's area must be one of the route's areas (its main area or another one).
            const onRoute = r.locationId === loc.id || (await this.prisma.routeLocation.findFirst({ where: { routeId: r.id, locationId: loc.id }, select: { id: true } }));
            if (!onRoute)
                throw (0, errors_1.bad)('The route is not in the chosen location');
        }
        return loc;
    }
    async findDuplicate(ctx, phone, idNumber, exceptId) {
        return this.prisma.customer.findFirst({
            where: {
                tenantId: ctx.tenantId,
                id: exceptId ? { not: exceptId } : undefined,
                OR: [{ phone }, ...(idNumber ? [{ idNumber }] : [])],
            },
            select: { id: true, name: true, code: true, phone: true },
        });
    }
    async create(ctx, input, allowDuplicate = false) {
        if (input.clientRef) {
            const existing = await this.prisma.customer.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
            if (existing)
                return existing;
        }
        const loc = await this.resolvePlace(ctx, input);
        const dup = await this.findDuplicate(ctx, input.phone, input.idNumber);
        if (dup && !allowDuplicate) {
            throw (0, errors_1.conflict)(`A customer with this phone or ID already exists: ${dup.name} (${dup.code})`, 'customerMod.duplicate');
        }
        const c = await this.prisma.tx(async (tx) => {
            const seq = await this.books.nextNumber(tx, ctx.tenantId, 'customerSeq');
            let routeSeq = input.routeSeq ?? null;
            if (input.routeId) {
                const max = await tx.customer.aggregate({ where: { routeId: input.routeId }, _max: { routeSeq: true } });
                const last = max._max.routeSeq ?? 0;
                if (!routeSeq || routeSeq > last)
                    routeSeq = last + 1;
                else
                    await tx.customer.updateMany({ where: { routeId: input.routeId, routeSeq: { gte: routeSeq } }, data: { routeSeq: { increment: 1 } } });
            }
            return tx.customer.create({
                data: {
                    ...input,
                    routeSeq,
                    tenantId: ctx.tenantId,
                    branchId: loc.branchId,
                    code: `C${String(seq).padStart(6, '0')}`,
                    createdById: ctx.userId,
                },
            });
        });
        await this.audit.log(ctx, 'CREATE', 'Customer', c.id, undefined, input);
        return c;
    }
    async update(ctx, id, input) {
        const before = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!before)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, before.branchId);
        const loc = await this.resolvePlace(ctx, input, before.locationId);
        const dup = await this.findDuplicate(ctx, input.phone, input.idNumber, id);
        if (dup)
            throw (0, errors_1.conflict)(`A customer with this phone or ID already exists: ${dup.name} (${dup.code})`, 'customerMod.duplicate');
        const { clientRef: _ignored, ...data } = input;
        const routeChanged = before.routeId !== (input.routeId ?? null);
        const c = await this.prisma.tx(async (tx) => {
            let routeSeq = input.routeSeq ?? before.routeSeq;
            if (routeChanged && input.routeId) {
                const max = await tx.customer.aggregate({ where: { routeId: input.routeId }, _max: { routeSeq: true } });
                routeSeq = (max._max.routeSeq ?? 0) + 1;
            }
            if (!input.routeId)
                routeSeq = null;
            // Active loans move with the customer to the new branch.
            if (loc.branchId !== before.branchId)
                await tx.loan.updateMany({ where: { customerId: id }, data: { branchId: loc.branchId } });
            return tx.customer.update({ where: { id }, data: { ...data, routeSeq, branchId: loc.branchId } });
        });
        const locationMoved = before.lat !== input.lat || before.lng !== input.lng;
        await this.audit.log(ctx, locationMoved ? 'UPDATE_WITH_LOCATION' : 'UPDATE', 'Customer', id, before, input);
        return c;
    }
    async setStatus(ctx, id, input) {
        const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!c)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        if (input.status === 'BLACKLISTED' && !input.reason)
            throw (0, errors_1.bad)('Give a reason for blacklisting');
        if (input.status === 'CLOSED' && (await this.prisma.loan.count({ where: { customerId: id, status: { in: ['ACTIVE', 'REQUESTED', 'APPROVED'] } } }))) {
            throw (0, errors_1.bad)('Close the customer\'s loans first');
        }
        const u = await this.prisma.customer.update({ where: { id }, data: { status: input.status, statusReason: input.reason ?? null } });
        await this.audit.log(ctx, 'STATUS', 'Customer', id, { status: c.status }, input);
        return u;
    }
    /**
     * Full repayment history for a customer and anyone matching their phone or ID number in this business, with an
     * advisory risk grade.
     */
    async history(ctx, id, requested) {
        const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!c)
            throw (0, errors_1.notFound)('Customer');
        const matches = await this.prisma.customer.findMany({
            where: {
                tenantId: ctx.tenantId,
                id: { not: id },
                OR: [{ phone: c.phone }, ...(c.altPhone ? [{ phone: c.altPhone }] : []), ...(c.idNumber ? [{ idNumber: c.idNumber }] : [])],
            },
            select: { id: true, code: true, name: true, phone: true, status: true, statusReason: true },
        });
        const ids = [id, ...matches.map((m) => m.id)];
        const loans = await this.prisma.loan.findMany({
            where: { tenantId: ctx.tenantId, customerId: { in: ids }, status: { in: ['ACTIVE', 'CLOSED', 'FORECLOSED', 'WRITTEN_OFF'] } },
            include: { instalments: true },
            orderBy: { createdAt: 'desc' },
        });
        const today = (0, shared_1.todayIST)();
        let dueCount = 0;
        let onTime = 0;
        let missed = 0;
        let maxDaysLate = 0;
        let currentDaysPastDue = 0;
        // Every instalment already due, newest last, to weigh the most recent ten more.
        const dueRows = [];
        const perLoan = loans.map((l) => {
            let lMax = 0;
            for (const i of l.instalments) {
                if (i.dueDate > today)
                    continue;
                dueCount++;
                const fully = i.principalPaid + i.interestPaid >= i.principalDue + i.interestDue;
                const late = fully && i.paidOn ? Math.max(0, (0, shared_1.diffDays)(i.paidOn, i.dueDate) - l.graceDays) : Math.max(0, (0, shared_1.diffDays)(today, i.dueDate));
                dueRows.push({ dueDate: i.dueDate, onTime: fully && late === 0 });
                if (fully && late === 0)
                    onTime++;
                if (!fully && i.dueDate < today)
                    missed++;
                lMax = Math.max(lMax, late);
            }
            maxDaysLate = Math.max(maxDaysLate, lMax);
            const { instalments, ...rest } = l;
            return {
                id: rest.id,
                number: rest.number,
                customerId: rest.customerId,
                principal: rest.principal,
                status: rest.status,
                frequency: rest.frequency,
                disbursedOn: rest.disbursedOn,
                closedOn: rest.closedOn,
                maxDaysLate: lMax,
                position: rest.status === 'ACTIVE' ? (0, books_service_1.positionOf)({ ...rest, instalments }) : null,
            };
        });
        const writtenOff = loans.filter((l) => l.status === 'WRITTEN_OFF').length;
        const onTimeRatio = dueCount ? onTime / dueCount : 1;
        const blacklisted = c.status === 'BLACKLISTED' || matches.some((m) => m.status === 'BLACKLISTED');
        const recent = dueRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(-10);
        for (const l of perLoan)
            if (l.position)
                currentDaysPastDue = Math.max(currentDaysPastDue, l.position.daysPastDue);
        const repaid = loans.filter((l) => l.status === 'CLOSED' || l.status === 'FORECLOSED');
        const risk = (0, shared_1.riskScore)({
            loans: loans.length,
            closedLoans: repaid.length,
            onTimeRatio,
            recentOnTimeRatio: recent.length ? recent.filter((r) => r.onTime).length / recent.length : onTimeRatio,
            missed,
            maxDaysLate,
            currentDaysPastDue,
            writtenOff,
            blacklisted,
            activeLoans: loans.filter((l) => l.status === 'ACTIVE').length,
            requested: requested ?? null,
            largestRepaid: repaid.length ? Math.max(...repaid.map((l) => l.principal)) : null,
        });
        return {
            customer: { id: c.id, name: c.name, code: c.code, status: c.status, statusReason: c.statusReason },
            matches,
            blacklisted,
            summary: {
                pastLoans: loans.filter((l) => l.status !== 'ACTIVE').length,
                currentLoans: loans.filter((l) => l.status === 'ACTIVE').length,
                instalmentsDue: dueCount,
                onTimeRatio,
                missed,
                maxDaysLate,
                writtenOff,
                grade: risk.grade,
                score: risk.score,
                reasons: risk.reasons,
            },
            loans: perLoan,
        };
    }
    async ledger(ctx, id) {
        const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!c)
            throw (0, errors_1.notFound)('Customer');
        (0, scope_1.assertBranch)(ctx, c.branchId);
        const [entries, loans] = await Promise.all([
            this.prisma.ledgerEntry.findMany({ where: { customerId: id, tenantId: ctx.tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
            this.prisma.loan.findMany({ where: { customerId: id }, select: { id: true, number: true } }),
        ]);
        return entries.map((e) => ({ ...e, loanNumber: loans.find((l) => l.id === e.loanId)?.number }));
    }
};
exports.CustomersService = CustomersService;
exports.CustomersService = CustomersService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService,
        books_service_1.BooksService])
], CustomersService);
const listQuery = zod_1.z.object({
    q: zod_1.z.string().optional(),
    branchId: zod_1.z.string().optional(),
    locationId: zod_1.z.string().optional(),
    routeId: zod_1.z.string().optional(),
    status: zod_1.z.string().optional(),
    page: zod_1.z.coerce.number().int().positive().optional(),
});
let CustomersController = class CustomersController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(ctx, q) {
        return this.svc.list(ctx, q);
    }
    get(ctx, id) {
        return this.svc.get(ctx, id);
    }
    history(ctx, id, amount) {
        // Optional amount being asked for, in paise, so the risk score can compare it with past loans.
        const requested = Number(amount);
        return this.svc.history(ctx, id, Number.isFinite(requested) && requested > 0 ? Math.round(requested) : undefined);
    }
    ledger(ctx, id) {
        return this.svc.ledger(ctx, id);
    }
    create(ctx, b, allow) {
        return this.svc.create(ctx, b, allow === 'true' && ctx.permissions.has('customer.edit'));
    }
    update(ctx, id, b) {
        return this.svc.update(ctx, id, b);
    }
    status(ctx, id, b) {
        return this.svc.setStatus(ctx, id, b);
    }
};
exports.CustomersController = CustomersController;
__decorate([
    (0, common_1.Get)(),
    (0, context_1.Perm)('customer.view', 'collection.record', 'loan.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)((0, zod_pipe_1.V)(listQuery))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "list", null);
__decorate([
    (0, common_1.Get)(':id'),
    (0, context_1.Perm)('customer.view', 'collection.record', 'loan.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/history'),
    (0, context_1.Perm)('customer.view', 'loan.approve', 'loan.request'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Query)('amount')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "history", null);
__decorate([
    (0, common_1.Get)(':id/ledger'),
    (0, context_1.Perm)('customer.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "ledger", null);
__decorate([
    (0, common_1.Post)(),
    (0, context_1.Perm)('customer.create'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.customerSchema))),
    __param(2, (0, common_1.Query)('allowDuplicate')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0, String]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "create", null);
__decorate([
    (0, common_1.Put)(':id'),
    (0, context_1.Perm)('customer.edit'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.customerSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "update", null);
__decorate([
    (0, common_1.Post)(':id/status'),
    (0, context_1.Perm)('customer.edit'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.customerStatusSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], CustomersController.prototype, "status", null);
exports.CustomersController = CustomersController = __decorate([
    (0, common_1.Controller)('customers'),
    __metadata("design:paramtypes", [CustomersService])
], CustomersController);
//# sourceMappingURL=customers.js.map