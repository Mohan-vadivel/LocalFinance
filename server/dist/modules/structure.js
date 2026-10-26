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
exports.StructureController = exports.StructureService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const books_service_1 = require("../common/books.service");
const prisma_service_1 = require("../common/prisma.service");
const areas_1 = require("../common/areas");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
let StructureService = class StructureService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    /** Routes made before a route could have several areas cover their main area. Gives each of them its area row. Idempotent. */
    async onModuleInit() {
        const routes = await this.prisma.route.findMany({ where: { areas: { none: {} } }, select: { id: true, tenantId: true, locationId: true } });
        if (routes.length) {
            await this.prisma.routeLocation.createMany({ data: routes.map((r) => ({ tenantId: r.tenantId, routeId: r.id, locationId: r.locationId })), skipDuplicates: true });
        }
    }
    // ---------- Branches ----------
    async branches(ctx) {
        const where = ctx.branchIds ? { tenantId: ctx.tenantId, id: { in: ctx.branchIds } } : { tenantId: ctx.tenantId };
        const rows = await this.prisma.branch.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { locations: true } } } });
        const funds = await this.prisma.fund.groupBy({ by: ['branchId'], where: { tenantId: ctx.tenantId, active: true }, _sum: { balance: true } });
        return rows.map((b) => ({ ...b, availableFund: funds.find((f) => f.branchId === b.id)?._sum.balance ?? 0 }));
    }
    async createBranch(ctx, input) {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        const count = await this.prisma.branch.count({ where: { tenantId: ctx.tenantId } });
        if (count >= t.maxBranches)
            throw (0, errors_1.bad)(`Your plan allows ${t.maxBranches} branches`);
        if (await this.prisma.branch.findFirst({ where: { tenantId: ctx.tenantId, code: input.code } }))
            throw (0, errors_1.conflict)('Branch code already used');
        await (0, scope_1.assertOwned)(this.prisma.user, ctx, input.managerId, 'Manager');
        const b = await this.prisma.branch.create({ data: { ...input, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'CREATE', 'Branch', b.id, undefined, input);
        return b;
    }
    async updateBranch(ctx, id, input) {
        const b = await this.prisma.branch.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!b)
            throw (0, errors_1.notFound)('Branch');
        (0, scope_1.assertBranch)(ctx, id);
        await (0, scope_1.assertOwned)(this.prisma.user, ctx, input.managerId, 'Manager');
        const u = await this.prisma.branch.update({ where: { id }, data: input });
        await this.audit.log(ctx, 'UPDATE', 'Branch', id, b, input);
        return u;
    }
    // ---------- Locations ----------
    async locations(ctx, branchId) {
        return this.prisma.location.findMany({
            where: (0, scope_1.branchScope)(ctx, branchId),
            orderBy: { name: 'asc' },
            include: { branch: { select: { name: true } }, _count: { select: { routes: true } } },
        });
    }
    async createLocation(ctx, input) {
        await this.ownBranch(ctx, input.branchId);
        const l = await this.prisma.location.create({ data: { ...input, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'CREATE', 'Location', l.id, undefined, input);
        return l;
    }
    async updateLocation(ctx, id, input) {
        const l = await this.prisma.location.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!l)
            throw (0, errors_1.notFound)('Location');
        (0, scope_1.assertBranch)(ctx, l.branchId);
        await this.ownBranch(ctx, input.branchId);
        const u = await this.prisma.$transaction(async (tx) => {
            const loc = await tx.location.update({ where: { id }, data: input });
            if (input.branchId !== l.branchId) {
                // Moving a location moves its routes and customers to the new branch; history goes with them.
                const mainRoutes = (await tx.route.findMany({ where: { locationId: id }, select: { id: true } })).map((r) => r.id);
                // Refuse rather than drop: an area on another area's route, or a route that moves with it and covers other areas.
                const linked = await tx.routeLocation.count({
                    where: { OR: [{ locationId: id, routeId: { notIn: mainRoutes } }, { routeId: { in: mainRoutes }, locationId: { not: id } }] },
                });
                if (linked > 0)
                    throw (0, errors_1.bad)('This area is on routes it does not own, or its routes cover other areas. Take it off those routes first, then move it.');
                await tx.route.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
                await tx.customer.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
            }
            return loc;
        });
        await this.audit.log(ctx, 'UPDATE', 'Location', id, l, input);
        return u;
    }
    // ---------- Setup view and area tracking ----------
    /**
     * The setup view: every branch the caller can see, its areas, and the routes in each area, with counts. A route
     * that covers several areas is listed under each of them. Warnings flag an active area with no route and an
     * active route with no customers.
     */
    async tree(ctx, branchId) {
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const [branches, areas, routes, areaCounts, routeCounts] = await Promise.all([
            this.prisma.branch.findMany({ where: branchWhere(ctx, branchId), orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, address: true, lat: true, lng: true, active: true } }),
            this.prisma.location.findMany({ where: scope, orderBy: { name: 'asc' }, select: { id: true, name: true, notes: true, lat: true, lng: true, active: true, branchId: true } }),
            this.prisma.route.findMany({ where: scope, orderBy: { name: 'asc' }, select: { id: true, name: true, active: true, collectionDays: true, areas: { select: { locationId: true } } } }),
            this.prisma.customer.groupBy({ by: ['locationId'], where: { ...scope, status: 'ACTIVE' }, _count: true }),
            this.prisma.customer.groupBy({ by: ['routeId'], where: { ...scope, status: 'ACTIVE', routeId: { not: null } }, _count: true }),
        ]);
        const customersOfArea = (id) => areaCounts.find((c) => c.locationId === id)?._count ?? 0;
        const customersOfRoute = (id) => routeCounts.find((c) => c.routeId === id)?._count ?? 0;
        const coveredBy = (areaId) => routes.filter((r) => r.areas.some((x) => x.locationId === areaId));
        return {
            branches: branches.map((b) => ({
                ...b,
                areas: areas
                    .filter((a) => a.branchId === b.id)
                    .map((a) => {
                    const covering = coveredBy(a.id);
                    return {
                        id: a.id,
                        name: a.name,
                        notes: a.notes,
                        lat: a.lat,
                        lng: a.lng,
                        branchId: a.branchId,
                        active: a.active,
                        routeCount: covering.length,
                        customerCount: customersOfArea(a.id),
                        noRoute: a.active && covering.length === 0,
                        routes: covering.map((r) => ({
                            id: r.id,
                            name: r.name,
                            active: r.active,
                            collectionDays: r.collectionDays,
                            customerCount: customersOfRoute(r.id),
                            noCustomers: r.active && customersOfRoute(r.id) === 0,
                        })),
                    };
                }),
            })),
            warnings: {
                areasWithoutRoute: areas.filter((a) => a.active && coveredBy(a.id).length === 0).length,
                routesWithoutCustomers: routes.filter((r) => r.active && customersOfRoute(r.id) === 0).length,
            },
        };
    }
    /**
     * Area tracking, for the caller's branches. Money uses the dashboard's own rules (dayFiguresOf, and the same
     * collection filter), so the areas add up to the dashboard's figures for the same branches. Inactive areas are
     * listed too, so their history stays visible.
     */
    async areasSummary(ctx, branchId) {
        const today = (0, shared_1.todayIST)();
        const scope = (0, scope_1.branchScope)(ctx, branchId);
        const [areas, coverage, customerCounts, loans, collected] = await Promise.all([
            this.prisma.location.findMany({ where: scope, orderBy: { name: 'asc' }, include: { branch: { select: { name: true } } } }),
            this.prisma.routeLocation.findMany({ where: { tenantId: ctx.tenantId, location: scope }, select: { locationId: true, routeId: true } }),
            this.prisma.customer.groupBy({ by: ['locationId'], where: { ...scope, status: 'ACTIVE' }, _count: true }),
            this.prisma.loan.findMany({ where: { ...scope, status: 'ACTIVE' }, include: { instalments: true, customer: { select: { locationId: true } } } }),
            this.prisma.collection.groupBy({ by: ['customerId'], where: { ...scope, date: today, reversedAt: null }, _sum: { amount: true } }),
        ]);
        // Collections do not store their area, so each customer's area is looked up once.
        const collectors = await this.prisma.customer.findMany({ where: { id: { in: collected.map((c) => c.customerId) } }, select: { id: true, locationId: true } });
        const areaOfCustomer = new Map(collectors.map((c) => [c.id, c.locationId]));
        const collectedBy = new Map();
        for (const c of collected) {
            const areaId = areaOfCustomer.get(c.customerId);
            if (areaId)
                collectedBy.set(areaId, (collectedBy.get(areaId) ?? 0) + (c._sum.amount ?? 0));
        }
        const rows = areas.map((a) => {
            const own = loans.filter((l) => l.customer.locationId === a.id).map((l) => (0, books_service_1.dayFiguresOf)(l, today));
            return {
                id: a.id,
                name: a.name,
                active: a.active,
                branchId: a.branchId,
                branchName: a.branch.name,
                routeCount: new Set(coverage.filter((c) => c.locationId === a.id).map((c) => c.routeId)).size,
                customerCount: customerCounts.find((c) => c.locationId === a.id)?._count ?? 0,
                activeLoans: own.length,
                collectedToday: collectedBy.get(a.id) ?? 0,
                dueToday: own.reduce((s, x) => s + x.dueToday, 0),
                overdue: own.reduce((s, x) => s + x.overdue, 0),
            };
        });
        const sum = (k) => rows.reduce((s, r) => s + r[k], 0);
        return {
            date: today,
            areas: rows,
            totals: {
                routeCount: new Set(coverage.map((c) => c.routeId)).size,
                customerCount: sum('customerCount'),
                activeLoans: sum('activeLoans'),
                collectedToday: sum('collectedToday'),
                dueToday: sum('dueToday'),
                overdue: sum('overdue'),
            },
        };
    }
    // ---------- Routes ----------
    async routes(ctx, q) {
        const rows = await this.prisma.route.findMany({
            // A route matches an area when the area is its main one or one of its other areas.
            where: {
                ...(0, scope_1.branchScope)(ctx, q.branchId),
                ...(q.locationId ? { OR: [{ locationId: q.locationId }, { areas: { some: { locationId: q.locationId } } }] } : {}),
            },
            orderBy: { name: 'asc' },
            include: { location: { select: { name: true, branchId: true } }, assignments: true, ...areas_1.withAreas },
        });
        const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, _count: true });
        const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
        const today = (0, shared_1.todayIST)();
        return rows.map(({ areas, ...r }) => ({
            ...r,
            locations: (0, areas_1.routeAreas)({ locationId: r.locationId, areas }),
            customerCount: counts.find((c) => c.routeId === r.id)?._count ?? 0,
            assignments: r.assignments.map((a) => ({
                ...a,
                userName: users.find((u) => u.id === a.userId)?.name,
                current: a.fromDate <= today && (!a.toDate || a.toDate >= today),
            })),
        }));
    }
    /**
     * The areas a route is made of, checked against the business and the branch. The first one is the main area.
     * Every area must be in the same branch, which becomes the route's branch.
     */
    async routeAreaRows(ctx, ids, alreadyOn = []) {
        const rows = await this.prisma.location.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId } });
        if (rows.length !== ids.length)
            throw (0, errors_1.notFound)('Location');
        const areas = ids.map((id) => rows.find((l) => l.id === id));
        for (const a of areas)
            (0, scope_1.assertBranch)(ctx, a.branchId);
        // An inactive area takes no new routes; a route keeps the ones it already has.
        if (areas.some((a) => !a.active && !alreadyOn.includes(a.id)))
            throw (0, errors_1.bad)('This area is inactive. Choose an active area.', 'structure.areaInactive');
        if (areas.some((a) => a.branchId !== areas[0].branchId))
            throw (0, errors_1.bad)('All areas of a route must be in the same branch');
        return areas;
    }
    async createRoute(ctx, input) {
        const [main] = await this.routeAreaRows(ctx, input.locationIds);
        const r = await this.prisma.$transaction(async (tx) => {
            const route = await tx.route.create({
                data: { name: input.name, collectionDays: input.collectionDays, active: input.active, locationId: main.id, branchId: main.branchId, tenantId: ctx.tenantId },
            });
            await tx.routeLocation.createMany({ data: input.locationIds.map((locationId) => ({ tenantId: ctx.tenantId, routeId: route.id, locationId })) });
            return route;
        });
        await this.audit.log(ctx, 'CREATE', 'Route', r.id, undefined, input);
        return r;
    }
    async updateRoute(ctx, id, input) {
        const r = await this.route(ctx, id);
        const [main] = await this.routeAreaRows(ctx, input.locationIds, r.locations.map((l) => l.id));
        const u = await this.prisma.$transaction(async (tx) => {
            const route = await tx.route.update({
                where: { id },
                data: { name: input.name, collectionDays: input.collectionDays, active: input.active, locationId: main.id, branchId: main.branchId },
            });
            await tx.routeLocation.deleteMany({ where: { routeId: id, locationId: { notIn: input.locationIds } } });
            await tx.routeLocation.createMany({ data: input.locationIds.map((locationId) => ({ tenantId: ctx.tenantId, routeId: id, locationId })), skipDuplicates: true });
            // A customer keeps their own area while it is still on the route; the others move to the main area.
            await tx.customer.updateMany({ where: { routeId: id, locationId: { notIn: input.locationIds } }, data: { locationId: main.id, branchId: main.branchId } });
            return route;
        });
        await this.audit.log(ctx, 'UPDATE', 'Route', id, r, input);
        return u;
    }
    async route(ctx, id) {
        const r = await this.prisma.route.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { location: true, ...areas_1.withAreas } });
        if (!r)
            throw (0, errors_1.notFound)('Route');
        (0, scope_1.assertBranch)(ctx, r.branchId);
        return { ...r, locations: (0, areas_1.routeAreas)(r) };
    }
    /** Customers on a route in visiting order, with pin data. */
    async routeCustomers(ctx, id) {
        await this.route(ctx, id);
        return this.prisma.customer.findMany({
            where: { tenantId: ctx.tenantId, routeId: id, status: { not: 'CLOSED' } },
            orderBy: [{ routeSeq: 'asc' }, { name: 'asc' }],
            select: { id: true, code: true, name: true, phone: true, address: true, landmark: true, lat: true, lng: true, routeSeq: true, status: true, language: true },
        });
    }
    async setOrder(ctx, id, customerIds) {
        await this.route(ctx, id);
        const onRoute = await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, routeId: id }, select: { id: true } });
        const set = new Set(onRoute.map((c) => c.id));
        if (customerIds.some((c) => !set.has(c)))
            throw (0, errors_1.bad)('Every customer in the order must be on this route');
        await this.prisma.$transaction(customerIds.map((cid, i) => this.prisma.customer.update({ where: { id: cid }, data: { routeSeq: i + 1 } })));
        await this.audit.log(ctx, 'REORDER', 'Route', id, undefined, { customerIds });
        return { ok: true };
    }
    async suggestOrder(ctx, id, start) {
        const route = await this.route(ctx, id);
        const customers = await this.routeCustomers(ctx, id);
        const branch = await this.prisma.branch.findUnique({ where: { id: route.branchId } });
        const from = start ?? (branch?.lat != null && branch?.lng != null ? { lat: branch.lat, lng: branch.lng } : route.location.lat != null && route.location.lng != null ? { lat: route.location.lat, lng: route.location.lng } : null);
        return { customerIds: (0, shared_1.suggestRouteOrder)(from, customers) };
    }
    async assign(ctx, id, input) {
        const route = await this.route(ctx, id);
        const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, active: true }, include: { branches: true, role: true } });
        if (!user)
            throw (0, errors_1.notFound)('Staff member');
        if (!user.branches.some((b) => b.branchId === route.branchId) && !['TENANT_ADMIN'].includes(user.role.baseRole)) {
            throw (0, errors_1.bad)('This staff member does not work in the route\'s branch');
        }
        if (input.toDate && input.toDate < input.fromDate)
            throw (0, errors_1.bad)('To date is before from date');
        const a = await this.prisma.routeAssignment.create({ data: { ...input, routeId: id, tenantId: ctx.tenantId } });
        await this.audit.log(ctx, 'ASSIGN', 'Route', id, undefined, input);
        return a;
    }
    async unassign(ctx, assignmentId) {
        const a = await this.prisma.routeAssignment.findFirst({ where: { id: assignmentId, tenantId: ctx.tenantId }, include: { route: true } });
        if (!a)
            throw (0, errors_1.notFound)('Assignment');
        (0, scope_1.assertBranch)(ctx, a.route.branchId);
        await this.prisma.routeAssignment.delete({ where: { id: assignmentId } });
        await this.audit.log(ctx, 'UNASSIGN', 'Route', a.routeId, a);
        return { ok: true };
    }
    /** Routes the user is assigned to on a date and that collect on that weekday. */
    async myRoutes(ctx, date = (0, shared_1.todayIST)()) {
        const assignments = await this.prisma.routeAssignment.findMany({
            where: { tenantId: ctx.tenantId, userId: ctx.userId, fromDate: { lte: date }, OR: [{ toDate: null }, { toDate: { gte: date } }] },
            include: { route: { include: { location: true, ...areas_1.withAreas } } },
        });
        const wd = (0, shared_1.weekday)(date);
        const routes = assignments.map((a) => a.route).filter((r, i, arr) => r.active && arr.findIndex((x) => x.id === r.id) === i);
        const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { routeId: { in: routes.map((r) => r.id) }, status: 'ACTIVE' }, _count: true });
        return routes.map((r) => ({
            id: r.id,
            name: r.name,
            location: r.location.name,
            locations: (0, areas_1.routeAreas)(r),
            branchId: r.branchId,
            locationId: r.locationId,
            collectsToday: r.collectionDays.includes(wd),
            customerCount: counts.find((c) => c.routeId === r.id)?._count ?? 0,
        }));
    }
    async ownBranch(ctx, branchId) {
        const b = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenantId } });
        if (!b)
            throw (0, errors_1.notFound)('Branch');
        (0, scope_1.assertBranch)(ctx, branchId);
        return b;
    }
};
exports.StructureService = StructureService;
exports.StructureService = StructureService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], StructureService);
/** Branches the caller can see, narrowed to one when asked. */
function branchWhere(ctx, branchId) {
    const s = (0, scope_1.branchScope)(ctx, branchId);
    return s.branchId ? { tenantId: s.tenantId, id: s.branchId } : { tenantId: s.tenantId };
}
const startSchema = zod_1.z.object({ lat: zod_1.z.number(), lng: zod_1.z.number() }).partial();
let StructureController = class StructureController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    branches(ctx) {
        return this.svc.branches(ctx);
    }
    createBranch(ctx, b) {
        return this.svc.createBranch(ctx, b);
    }
    updateBranch(ctx, id, b) {
        return this.svc.updateBranch(ctx, id, b);
    }
    locations(ctx, branchId) {
        return this.svc.locations(ctx, branchId);
    }
    createLocation(ctx, b) {
        return this.svc.createLocation(ctx, b);
    }
    updateLocation(ctx, id, b) {
        return this.svc.updateLocation(ctx, id, b);
    }
    tree(ctx, branchId) {
        return this.svc.tree(ctx, branchId);
    }
    areasSummary(ctx, branchId) {
        return this.svc.areasSummary(ctx, branchId);
    }
    routes(ctx, branchId, locationId) {
        return this.svc.routes(ctx, { branchId, locationId });
    }
    mine(ctx, date) {
        return this.svc.myRoutes(ctx, date);
    }
    createRoute(ctx, b) {
        return this.svc.createRoute(ctx, b);
    }
    updateRoute(ctx, id, b) {
        return this.svc.updateRoute(ctx, id, b);
    }
    routeCustomers(ctx, id) {
        return this.svc.routeCustomers(ctx, id);
    }
    setOrder(ctx, id, b) {
        return this.svc.setOrder(ctx, id, b.customerIds);
    }
    suggest(ctx, id, b) {
        return this.svc.suggestOrder(ctx, id, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : undefined);
    }
    assign(ctx, id, b) {
        return this.svc.assign(ctx, id, b);
    }
    unassign(ctx, id) {
        return this.svc.unassign(ctx, id);
    }
};
exports.StructureController = StructureController;
__decorate([
    (0, common_1.Get)('branches'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "branches", null);
__decorate([
    (0, common_1.Post)('branches'),
    (0, context_1.Perm)('branch.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.branchSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "createBranch", null);
__decorate([
    (0, common_1.Put)('branches/:id'),
    (0, context_1.Perm)('branch.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.branchSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "updateBranch", null);
__decorate([
    (0, common_1.Get)('locations'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "locations", null);
__decorate([
    (0, common_1.Post)('locations'),
    (0, context_1.Perm)('branch.manage', 'route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.locationSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "createLocation", null);
__decorate([
    (0, common_1.Put)('locations/:id'),
    (0, context_1.Perm)('branch.manage', 'route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.locationSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "updateLocation", null);
__decorate([
    (0, common_1.Get)('structure/tree'),
    (0, context_1.Perm)('branch.manage', 'route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "tree", null);
__decorate([
    (0, common_1.Get)('structure/areas-summary'),
    (0, context_1.Perm)('report.view'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "areasSummary", null);
__decorate([
    (0, common_1.Get)('routes'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('locationId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "routes", null);
__decorate([
    (0, common_1.Get)('routes/mine'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('date')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "mine", null);
__decorate([
    (0, common_1.Post)('routes'),
    (0, context_1.Perm)('route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.routeSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "createRoute", null);
__decorate([
    (0, common_1.Put)('routes/:id'),
    (0, context_1.Perm)('route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.routeSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "updateRoute", null);
__decorate([
    (0, common_1.Get)('routes/:id/customers'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "routeCustomers", null);
__decorate([
    (0, common_1.Put)('routes/:id/order'),
    (0, context_1.Perm)('route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.routeOrderSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "setOrder", null);
__decorate([
    (0, common_1.Post)('routes/:id/suggest-order'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(startSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "suggest", null);
__decorate([
    (0, common_1.Post)('routes/:id/assignments'),
    (0, context_1.Perm)('route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.routeAssignSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "assign", null);
__decorate([
    (0, common_1.Delete)('route-assignments/:id'),
    (0, context_1.Perm)('route.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StructureController.prototype, "unassign", null);
exports.StructureController = StructureController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [StructureService])
], StructureController);
//# sourceMappingURL=structure.js.map