import { Body, Controller, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { customerSchema, customerStatusSchema, diffDays, riskGrade, todayIST } from '@localfinance/shared';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { BooksService, positionOf } from '../common/books.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly books: BooksService,
  ) {}

  async list(ctx: Ctx, q: { q?: string; branchId?: string; locationId?: string; routeId?: string; status?: string; page?: number }) {
    const take = 50;
    const page = Math.max(1, q.page ?? 1);
    const where: Prisma.CustomerWhereInput = {
      ...branchScope(ctx, q.branchId),
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

  async get(ctx: Ctx, id: string) {
    const c = await this.prisma.customer.findFirst({
      where: { id, tenantId: ctx.tenantId },
      include: { loans: { include: { instalments: true }, orderBy: { createdAt: 'desc' } } },
    });
    if (!c) throw notFound('Customer');
    assertBranch(ctx, c.branchId);
    const docs = await this.prisma.document.findMany({ where: { tenantId: ctx.tenantId, customerId: id } });
    const { loans, ...rest } = c;
    return {
      ...rest,
      documents: docs,
      loans: loans.map(({ instalments, ...l }) => ({
        ...l,
        position: ['ACTIVE'].includes(l.status) ? positionOf({ ...l, instalments }) : null,
      })),
    };
  }

  private async resolvePlace(ctx: Ctx, input: z.infer<typeof customerSchema>) {
    const loc = await this.prisma.location.findFirst({ where: { id: input.locationId, tenantId: ctx.tenantId } });
    if (!loc) throw notFound('Location');
    assertBranch(ctx, loc.branchId);
    if (input.routeId) {
      const r = await this.prisma.route.findFirst({ where: { id: input.routeId, tenantId: ctx.tenantId } });
      if (!r) throw notFound('Route');
      if (r.locationId !== loc.id) throw bad('The route is not in the chosen location');
    }
    return loc;
  }

  private async findDuplicate(ctx: Ctx, phone: string, idNumber?: string | null, exceptId?: string) {
    return this.prisma.customer.findFirst({
      where: {
        tenantId: ctx.tenantId,
        id: exceptId ? { not: exceptId } : undefined,
        OR: [{ phone }, ...(idNumber ? [{ idNumber }] : [])],
      },
      select: { id: true, name: true, code: true, phone: true },
    });
  }

  async create(ctx: Ctx, input: z.infer<typeof customerSchema>, allowDuplicate = false) {
    if (input.clientRef) {
      const existing = await this.prisma.customer.findUnique({ where: { tenantId_clientRef: { tenantId: ctx.tenantId, clientRef: input.clientRef } } });
      if (existing) return existing;
    }
    const loc = await this.resolvePlace(ctx, input);
    const dup = await this.findDuplicate(ctx, input.phone, input.idNumber);
    if (dup && !allowDuplicate) {
      throw conflict(`A customer with this phone or ID already exists: ${dup.name} (${dup.code})`, 'customerMod.duplicate');
    }
    const c = await this.prisma.tx(async (tx) => {
      const seq = await this.books.nextNumber(tx, ctx.tenantId, 'customerSeq');
      let routeSeq = input.routeSeq ?? null;
      if (input.routeId) {
        const max = await tx.customer.aggregate({ where: { routeId: input.routeId }, _max: { routeSeq: true } });
        const last = max._max.routeSeq ?? 0;
        if (!routeSeq || routeSeq > last) routeSeq = last + 1;
        else await tx.customer.updateMany({ where: { routeId: input.routeId, routeSeq: { gte: routeSeq } }, data: { routeSeq: { increment: 1 } } });
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

  async update(ctx: Ctx, id: string, input: z.infer<typeof customerSchema>) {
    const before = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!before) throw notFound('Customer');
    assertBranch(ctx, before.branchId);
    const loc = await this.resolvePlace(ctx, input);
    const dup = await this.findDuplicate(ctx, input.phone, input.idNumber, id);
    if (dup) throw conflict(`A customer with this phone or ID already exists: ${dup.name} (${dup.code})`, 'customerMod.duplicate');
    const { clientRef: _ignored, ...data } = input;
    const routeChanged = before.routeId !== (input.routeId ?? null);
    const c = await this.prisma.tx(async (tx) => {
      let routeSeq = input.routeSeq ?? before.routeSeq;
      if (routeChanged && input.routeId) {
        const max = await tx.customer.aggregate({ where: { routeId: input.routeId }, _max: { routeSeq: true } });
        routeSeq = (max._max.routeSeq ?? 0) + 1;
      }
      if (!input.routeId) routeSeq = null;
      // Active loans move with the customer to the new branch.
      if (loc.branchId !== before.branchId) await tx.loan.updateMany({ where: { customerId: id }, data: { branchId: loc.branchId } });
      return tx.customer.update({ where: { id }, data: { ...data, routeSeq, branchId: loc.branchId } });
    });
    const locationMoved = before.lat !== input.lat || before.lng !== input.lng;
    await this.audit.log(ctx, locationMoved ? 'UPDATE_WITH_LOCATION' : 'UPDATE', 'Customer', id, before, input);
    return c;
  }

  async setStatus(ctx: Ctx, id: string, input: z.infer<typeof customerStatusSchema>) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw notFound('Customer');
    assertBranch(ctx, c.branchId);
    if (input.status === 'BLACKLISTED' && !input.reason) throw bad('Give a reason for blacklisting');
    if (input.status === 'CLOSED' && (await this.prisma.loan.count({ where: { customerId: id, status: { in: ['ACTIVE', 'REQUESTED', 'APPROVED'] } } }))) {
      throw bad('Close the customer\'s loans first');
    }
    const u = await this.prisma.customer.update({ where: { id }, data: { status: input.status, statusReason: input.reason ?? null } });
    await this.audit.log(ctx, 'STATUS', 'Customer', id, { status: c.status }, input);
    return u;
  }

  /**
   * Full repayment history for a customer and anyone matching their phone or ID number in this business, with an
   * advisory risk grade.
   */
  async history(ctx: Ctx, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw notFound('Customer');
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
    const today = todayIST();
    let dueCount = 0;
    let onTime = 0;
    let missed = 0;
    let maxDaysLate = 0;
    const perLoan = loans.map((l) => {
      let lMax = 0;
      for (const i of l.instalments) {
        if (i.dueDate > today) continue;
        dueCount++;
        const fully = i.principalPaid + i.interestPaid >= i.principalDue + i.interestDue;
        const late = fully && i.paidOn ? Math.max(0, diffDays(i.paidOn, i.dueDate) - l.graceDays) : Math.max(0, diffDays(today, i.dueDate));
        if (fully && late === 0) onTime++;
        if (!fully && i.dueDate < today) missed++;
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
        position: rest.status === 'ACTIVE' ? positionOf({ ...rest, instalments }) : null,
      };
    });
    const writtenOff = loans.filter((l) => l.status === 'WRITTEN_OFF').length;
    const onTimeRatio = dueCount ? onTime / dueCount : 1;
    const blacklisted = c.status === 'BLACKLISTED' || matches.some((m) => m.status === 'BLACKLISTED');
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
        grade: riskGrade({ loans: loans.length, onTimeRatio, maxDaysLate, writtenOff }),
      },
      loans: perLoan,
    };
  }

  async ledger(ctx: Ctx, id: string) {
    const c = await this.prisma.customer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw notFound('Customer');
    assertBranch(ctx, c.branchId);
    const [entries, loans] = await Promise.all([
      this.prisma.ledgerEntry.findMany({ where: { customerId: id, tenantId: ctx.tenantId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
      this.prisma.loan.findMany({ where: { customerId: id }, select: { id: true, number: true } }),
    ]);
    return entries.map((e) => ({ ...e, loanNumber: loans.find((l) => l.id === e.loanId)?.number }));
  }
}

const listQuery = z.object({
  q: z.string().optional(),
  branchId: z.string().optional(),
  locationId: z.string().optional(),
  routeId: z.string().optional(),
  status: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
});

@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Get() @Perm('customer.view', 'collection.record', 'loan.request') list(@CurrentCtx() ctx: Ctx, @Query(V(listQuery)) q: z.infer<typeof listQuery>) {
    return this.svc.list(ctx, q);
  }
  @Get(':id') @Perm('customer.view', 'collection.record', 'loan.request') get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }
  @Get(':id/history') @Perm('customer.view', 'loan.approve', 'loan.request') history(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.history(ctx, id);
  }
  @Get(':id/ledger') @Perm('customer.view') ledger(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.ledger(ctx, id);
  }
  @Post() @Perm('customer.create') create(@CurrentCtx() ctx: Ctx, @Body(V(customerSchema)) b: z.infer<typeof customerSchema>, @Query('allowDuplicate') allow?: string) {
    return this.svc.create(ctx, b, allow === 'true' && ctx.permissions.has('customer.edit'));
  }
  @Put(':id') @Perm('customer.edit') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(customerSchema)) b: z.infer<typeof customerSchema>) {
    return this.svc.update(ctx, id, b);
  }
  @Post(':id/status') @Perm('customer.edit') status(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(customerStatusSchema)) b: z.infer<typeof customerStatusSchema>) {
    return this.svc.setStatus(ctx, id, b);
  }
}
