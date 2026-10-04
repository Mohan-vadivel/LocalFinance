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
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

@Injectable()
export class StructureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
    const b = await this.prisma.branch.create({ data: { ...input, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Branch', b.id, undefined, input);
    return b;
  }

  async updateBranch(ctx: Ctx, id: string, input: z.infer<typeof branchSchema>) {
    const b = await this.prisma.branch.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!b) throw notFound('Branch');
    assertBranch(ctx, id);
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
        await tx.route.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
        await tx.customer.updateMany({ where: { locationId: id }, data: { branchId: input.branchId } });
      }
      return loc;
    });
    await this.audit.log(ctx, 'UPDATE', 'Location', id, l, input);
    return u;
  }

  // ---------- Routes ----------
  async routes(ctx: Ctx, q: { branchId?: string; locationId?: string }) {
    const rows = await this.prisma.route.findMany({
      where: { ...branchScope(ctx, q.branchId), ...(q.locationId ? { locationId: q.locationId } : {}) },
      orderBy: { name: 'asc' },
      include: { location: { select: { name: true, branchId: true } }, assignments: true },
    });
    const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { tenantId: ctx.tenantId, status: 'ACTIVE' }, _count: true });
    const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    const today = todayIST();
    return rows.map((r) => ({
      ...r,
      customerCount: counts.find((c) => c.routeId === r.id)?._count ?? 0,
      assignments: r.assignments.map((a) => ({
        ...a,
        userName: users.find((u) => u.id === a.userId)?.name,
        current: a.fromDate <= today && (!a.toDate || a.toDate >= today),
      })),
    }));
  }

  async createRoute(ctx: Ctx, input: z.infer<typeof routeSchema>) {
    const loc = await this.prisma.location.findFirst({ where: { id: input.locationId, tenantId: ctx.tenantId } });
    if (!loc) throw notFound('Location');
    assertBranch(ctx, loc.branchId);
    const r = await this.prisma.route.create({ data: { ...input, branchId: loc.branchId, tenantId: ctx.tenantId } });
    await this.audit.log(ctx, 'CREATE', 'Route', r.id, undefined, input);
    return r;
  }

  async updateRoute(ctx: Ctx, id: string, input: z.infer<typeof routeSchema>) {
    const r = await this.route(ctx, id);
    const loc = await this.prisma.location.findFirst({ where: { id: input.locationId, tenantId: ctx.tenantId } });
    if (!loc) throw notFound('Location');
    assertBranch(ctx, loc.branchId);
    const u = await this.prisma.$transaction(async (tx) => {
      const route = await tx.route.update({ where: { id }, data: { ...input, branchId: loc.branchId } });
      await tx.customer.updateMany({ where: { routeId: id }, data: { locationId: loc.id, branchId: loc.branchId } });
      return route;
    });
    await this.audit.log(ctx, 'UPDATE', 'Route', id, r, input);
    return u;
  }

  async route(ctx: Ctx, id: string) {
    const r = await this.prisma.route.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { location: true } });
    if (!r) throw notFound('Route');
    assertBranch(ctx, r.branchId);
    return r;
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
      include: { route: { include: { location: true } } },
    });
    const wd = weekday(date);
    const routes = assignments.map((a) => a.route).filter((r, i, arr) => r.active && arr.findIndex((x) => x.id === r.id) === i);
    const counts = await this.prisma.customer.groupBy({ by: ['routeId'], where: { routeId: { in: routes.map((r) => r.id) }, status: 'ACTIVE' }, _count: true });
    return routes.map((r) => ({
      id: r.id,
      name: r.name,
      location: r.location.name,
      branchId: r.branchId,
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
