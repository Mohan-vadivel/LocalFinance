import { Body, Controller, Delete, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import {
  branchSchema,
  locationSchema,
  routeAssignSchema,
  routeOrderSchema,
  routeSchema,
  suggestRouteOrder,
  todayIST,
  weekday,
} from '@localfinance/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, notFound } from '../common/errors';
import { dayFiguresOf } from '../common/books.service';
import { PrismaService } from '../common/prisma.service';
import { routeAreas, withAreas } from '../common/areas';
import { assertBranch, assertOwned, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Routes made before a route could have several areas cover their main area. Gives each of them its area row. Idempotent. */
  async onModuleInit() {
    const routes = await this.prisma.route.findMany({ where: { areas: { none: {} } }, select: { id: true, tenantId: true, locationId: true } });
    if (routes.length) {
      await this.prisma.routeLocation.createMany({ data: routes.map((r) => ({ tenantId: r.tenantId, routeId: r.id, locationId: r.locationId })), skipDuplicates: true });
    }
  }

  // ---------- Branches ----------
  async branches(ctx: Ctx) {
    const where = ctx.branchIds ? { tenantId: ctx.tenantId, id: { in: ctx.branchIds } } : { tenantId: ctx.tenantId };
    const rows = await this.prisma.branch.findMany({ where, orderBy: { name: 'asc' }, include: { _count: { select: { locations: true } } } });
    const funds = await this.prisma.fund.groupBy({ by: ['branchId'], where: { tenantId: ctx.tenantId, active: true }, _sum: { balance: true } });
    return rows.map((b) => ({ ...b, availableFund: funds.find((f) => f.branchId === b.id)?._sum.balance ?? 0 }));
  }

  async createBranch(ctx: Ctx, input: z.infer<typeof branchSchema>) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const count = await this.prisma.branch.count({ where: { tenantId: ctx.tenantId } });
    if (count >= t.maxBranches) throw bad(`Your plan allows ${t.maxBranches} branches`);
    if (await this.prisma.branch.findFirst({ where: { tenantId: ctx.tenantId, code: input.code } })) throw conflict('Branch code already used');
    await assertOwned(this.prisma.user, ctx, input.managerId, 'Manager');
    const b = await this.prisma.branch.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Branch', b.id, undefined, input);
    return b;
  }

  async updateBranch(ctx: Ctx, id: string, input: z.infer<typeof branchSchema>) {
    const b = await this.prisma.branch.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!b) throw notFound('Branch');
    assertBranch(ctx, id);
    await assertOwned(this.prisma.user, ctx, input.managerId, 'Manager');
    const u = await this.prisma.branch.update({ where: { id }, data: input });
    await this.audit.log(ctx, 'UPDATE', 'Branch', id, b, input);
    return u;
  }

  // ---------- Locations ----------
  async locations(ctx: Ctx, branchId?: string) {
    return this.prisma.location.findMany({
      where: branchScope(ctx, branchId),
      orderBy: { name: 'asc' },
      include: { branch: { select: { name: true } }, _count: { select: { routes: true } } },
    });
  }

  async createLocation(ctx: Ctx, input: z.infer<typeof locationSchema>) {
    await this.ownBranch(ctx, input.branchId);
    const l = await this.prisma.location.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Location', l.id, undefined, input);
    return l;
  }

  async updateLocation(ctx: Ctx, id: string, input: z.infer<typeof locationSchema>) {
    const l = await this.prisma.location.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!l) throw notFound('Location');
    assertBranch(ctx, l.branchId);
    await this.ownBranch(ctx, input.branchId);
    const u = await this.prisma.$transaction(async (tx) => {
      const loc = await tx.location.update({ where: { id }, data: input });
      if (input.branchId !== l.branchId) {
        // Moving a location moves its routes and customers to the new branch; history goes with them.
        const mainRoutes = (await tx.route.findMany({ where: { locationId: id }, select: { id: true } })).map((r) => r.id);
        await tx.route.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
        await tx.customer.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
        // Routes of the old branch lose this area; routes that moved with it lose their areas of the old branch.
        await tx.routeLocation.deleteMany({ where: { locationId: id, route: { branchId: { not: input.branchId } } } });
        await tx.routeLocation.deleteMany({ where: { routeId: { in: mainRoutes }, location: { branchId: { not: input.branchId } } } });
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
  async tree(ctx: Ctx, branchId?: string) {
    const scope = branchScope(ctx, branchId);
    const [branches, areas, routes, areaCounts, routeCounts] = await Promise.all([
      this.prisma.branch.findMany({ where: branchWhere(ctx, branchId), orderBy: { name: 'asc' }, select: { id: true, name: true, code: true, address: true, lat: true, lng: true, active: true } }),
      this.prisma.location.findMany({ where: scope, orderBy: { name: 'asc' }, select: { id: true, name: true, notes: true, lat: true, lng: true, active: true, branchId: true } }),
      this.prisma.route.findMany({ where: scope, orderBy: { name: 'asc' }, select: { id: true, name: true, active: true, collectionDays: true, areas: { select: { locationId: true } } } }),
      this.prisma.customer.groupBy({ by: ['locationId'], where: { ...scope, status: 'ACTIVE' }, _count: true }),
      this.prisma.customer.groupBy({ by: ['routeId'], where: { ...scope, status: 'ACTIVE', routeId: { not: null } }, _count: true }),
    ]);
    const customersOfArea = (id: string) => areaCounts.find((c) => c.locationId === id)?._count ?? 0;
    const customersOfRoute = (id: string) => routeCounts.find((c) => c.routeId === id)?._count ?? 0;
    const coveredBy = (areaId: string) => routes.filter((r) => r.areas.some((x) => x.locationId === areaId));
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
  async areasSummary(ctx: Ctx, branchId?: string) {
    const today = todayIST();
    const scope = branchScope(ctx, branchId);
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
    const collectedBy = new Map<string, number>();
    for (const c of collected) {
      const areaId = areaOfCustomer.get(c.customerId);
      if (areaId) collectedBy.set(areaId, (collectedBy.get(areaId) ?? 0) + (c._sum.amount ?? 0));
    }
    const rows = areas.map((a) => {
      const own = loans.filter((l) => l.customer.locationId === a.id).map((l) => dayFiguresOf(l, today));
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
    const sum = (k: 'routeCount' | 'customerCount' | 'activeLoans' | 'collectedToday' | 'dueToday' | 'overdue') => rows.reduce((s, r) => s + r[k], 0);
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
  async routes(ctx: Ctx, q: { branchId?: string; locationId?: string }) {
    const rows = await this.prisma.route.findMany({
      // A route matches an area when the area is its main one or one of its other areas.
      where: {
        ...branchScope(ctx, q.branchId),
        ...(q.locationId ? { OR: [{ locationId: q.locationId }, { areas: { some: { locationId: q.locationId } } }] } : {}),
      },
      orderBy: { name: 'asc' },
      include: { location: { select: { name: true, branchId: true } }, assignments: true, ...withAreas },
    });
    const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, _count: true });
    const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    const today = todayIST();
    return rows.map(({ areas, ...r }) => ({
      ...r,
      locations: routeAreas({ locationId: r.locationId, areas }),
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
  private async routeAreaRows(ctx: Ctx, ids: string[], alreadyOn: string[] = []) {
    const rows = await this.prisma.location.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId } });
    if (rows.length !== ids.length) throw notFound('Location');
    const areas = ids.map((id) => rows.find((l) => l.id === id)!);
    for (const a of areas) assertBranch(ctx, a.branchId);
    // An inactive area takes no new routes; a route keeps the ones it already has.
    if (areas.some((a) => !a.active && !alreadyOn.includes(a.id))) throw bad('This area is inactive. Choose an active area.', 'structure.areaInactive');
    if (areas.some((a) => a.branchId !== areas[0].branchId)) throw bad('All areas of a route must be in the same branch');
    return areas;
  }

  async createRoute(ctx: Ctx, input: z.infer<typeof routeSchema>) {
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

  async updateRoute(ctx: Ctx, id: string, input: z.infer<typeof routeSchema>) {
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

  async route(ctx: Ctx, id: string) {
    const r = await this.prisma.route.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { location: true, ...withAreas } });
    if (!r) throw notFound('Route');
    assertBranch(ctx, r.branchId);
    return { ...r, locations: routeAreas(r) };
  }

  /** Customers on a route in visiting order, with pin data. */
  async routeCustomers(ctx: Ctx, id: string) {
    await this.route(ctx, id);
    return this.prisma.customer.findMany({
      where: { tenantId: ctx.tenantId, routeId: id, status: { not: 'CLOSED' } },
      orderBy: [{ routeSeq: 'asc' }, { name: 'asc' }],
      select: { id: true, code: true, name: true, phone: true, address: true, landmark: true, lat: true, lng: true, routeSeq: true, status: true, language: true },
    });
  }

  async setOrder(ctx: Ctx, id: string, customerIds: string[]) {
    await this.route(ctx, id);
    const onRoute = await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, routeId: id }, select: { id: true } });
    const set = new Set(onRoute.map((c) => c.id));
    if (customerIds.some((c) => !set.has(c))) throw bad('Every customer in the order must be on this route');
    await this.prisma.$transaction(customerIds.map((cid, i) => this.prisma.customer.update({ where: { id: cid }, data: { routeSeq: i + 1 } })));
    await this.audit.log(ctx, 'REORDER', 'Route', id, undefined, { customerIds });
    return { ok: true };
  }

  async suggestOrder(ctx: Ctx, id: string, start?: { lat: number; lng: number }) {
    const route = await this.route(ctx, id);
    const customers = await this.routeCustomers(ctx, id);
    const branch = await this.prisma.branch.findUnique({ where: { id: route.branchId } });
    const from = start ?? (branch?.lat != null && branch?.lng != null ? { lat: branch.lat, lng: branch.lng } : route.location.lat != null && route.location.lng != null ? { lat: route.location.lat, lng: route.location.lng } : null);
    return { customerIds: suggestRouteOrder(from, customers) };
  }

  async assign(ctx: Ctx, id: string, input: z.infer<typeof routeAssignSchema>) {
    const route = await this.route(ctx, id);
    const user = await this.prisma.user.findFirst({ where: { id: input.userId, tenantId: ctx.tenantId, active: true }, include: { branches: true, role: true } });
    if (!user) throw notFound('Staff member');
    if (!user.branches.some((b) => b.branchId === route.branchId) && !['TENANT_ADMIN'].includes(user.role.baseRole)) {
      throw bad('This staff member does not work in the route\'s branch');
    }
    if (input.toDate && input.toDate < input.fromDate) throw bad('To date is before from date');
    const a = await this.prisma.routeAssignment.create({ data: { ...input, routeId: id, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'ASSIGN', 'Route', id, undefined, input);
    return a;
  }

  async unassign(ctx: Ctx, assignmentId: string) {
    const a = await this.prisma.routeAssignment.findFirst({ where: { id: assignmentId, tenantId: ctx.tenantId }, include: { route: true } });
    if (!a) throw notFound('Assignment');
    assertBranch(ctx, a.route.branchId);
    await this.prisma.routeAssignment.delete({ where: { id: assignmentId } });
    await this.audit.log(ctx, 'UNASSIGN', 'Route', a.routeId, a);
    return { ok: true };
  }

  /** Routes the user is assigned to on a date and that collect on that weekday. */
  async myRoutes(ctx: Ctx, date = todayIST()) {
    const assignments = await this.prisma.routeAssignment.findMany({
      where: { tenantId: ctx.tenantId, userId: ctx.userId, fromDate: { lte: date }, OR: [{ toDate: null }, { toDate: { gte: date } }] },
      include: { route: { include: { location: true, ...withAreas } } },
    });
    const wd = weekday(date);
    const routes = assignments.map((a) => a.route).filter((r, i, arr) => r.active && arr.findIndex((x) => x.id === r.id) === i);
    const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { routeId: { in: routes.map((r) => r.id) }, status: 'ACTIVE' }, _count: true });
    return routes.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location.name,
      locations: routeAreas(r),
      branchId: r.branchId,
      locationId: r.locationId,
      collectsToday: r.collectionDays.includes(wd),
      customerCount: counts.find((c) => c.routeId === r.id)?._count ?? 0,
    }));
  }

  private async ownBranch(ctx: Ctx, branchId: string) {
    const b = await this.prisma.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenantId } });
    if (!b) throw notFound('Branch');
    assertBranch(ctx, branchId);
    return b;
  }
}

/** Branches the caller can see, narrowed to one when asked. */
function branchWhere(ctx: Ctx, branchId?: string): Prisma.BranchWhereInput {
  const s = branchScope(ctx, branchId);
  return s.branchId ? { tenantId: s.tenantId, id: s.branchId } : { tenantId: s.tenantId };
}

const startSchema = z.object({ lat: z.number(), lng: z.number() }).partial();

@Controller()
export class StructureController {
  constructor(private readonly svc: StructureService) {}

  @Get('branches') branches(@CurrentCtx() ctx: Ctx) {
    return this.svc.branches(ctx);
  }
  @Post('branches') @Perm('branch.manage') createBranch(@CurrentCtx() ctx: Ctx, @Body(V(branchSchema)) b: z.infer<typeof branchSchema>) {
    return this.svc.createBranch(ctx, b);
  }
  @Put('branches/:id') @Perm('branch.manage') updateBranch(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(branchSchema)) b: z.infer<typeof branchSchema>) {
    return this.svc.updateBranch(ctx, id, b);
  }

  @Get('locations') locations(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string) {
    return this.svc.locations(ctx, branchId);
  }
  @Post('locations') @Perm('branch.manage', 'route.manage') createLocation(@CurrentCtx() ctx: Ctx, @Body(V(locationSchema)) b: z.infer<typeof locationSchema>) {
    return this.svc.createLocation(ctx, b);
  }
  @Put('locations/:id') @Perm('branch.manage', 'route.manage') updateLocation(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(locationSchema)) b: z.infer<typeof locationSchema>) {
    return this.svc.updateLocation(ctx, id, b);
  }

  @Get('structure/tree') @Perm('branch.manage', 'route.manage') tree(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string) {
    return this.svc.tree(ctx, branchId);
  }
  @Get('structure/areas-summary') @Perm('report.view') areasSummary(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string) {
    return this.svc.areasSummary(ctx, branchId);
  }

  @Get('routes') routes(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string, @Query('locationId') locationId?: string) {
    return this.svc.routes(ctx, { branchId, locationId });
  }
  @Get('routes/mine') mine(@CurrentCtx() ctx: Ctx, @Query('date') date?: string) {
    return this.svc.myRoutes(ctx, date);
  }
  @Post('routes') @Perm('route.manage') createRoute(@CurrentCtx() ctx: Ctx, @Body(V(routeSchema)) b: z.infer<typeof routeSchema>) {
    return this.svc.createRoute(ctx, b);
  }
  @Put('routes/:id') @Perm('route.manage') updateRoute(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(routeSchema)) b: z.infer<typeof routeSchema>) {
    return this.svc.updateRoute(ctx, id, b);
  }
  @Get('routes/:id/customers') routeCustomers(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.routeCustomers(ctx, id);
  }
  @Put('routes/:id/order') @Perm('route.manage') setOrder(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(routeOrderSchema)) b: z.infer<typeof routeOrderSchema>) {
    return this.svc.setOrder(ctx, id, b.customerIds);
  }
  @Post('routes/:id/suggest-order') suggest(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(startSchema)) b: { lat?: number; lng?: number }) {
    return this.svc.suggestOrder(ctx, id, b.lat != null && b.lng != null ? { lat: b.lat, lng: b.lng } : undefined);
  }
  @Post('routes/:id/assignments') @Perm('route.manage') assign(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(routeAssignSchema)) b: z.infer<typeof routeAssignSchema>) {
    return this.svc.assign(ctx, id, b);
  }
  @Delete('route-assignments/:id') @Perm('route.manage') unassign(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.unassign(ctx, id);
  }
}
