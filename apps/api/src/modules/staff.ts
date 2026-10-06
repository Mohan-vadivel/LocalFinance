import { Body, Controller, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { ROLE_PERMS_VERSION, roleSchema, staffSchema } from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, forbidden, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { V } from '../common/zod.pipe';

const PUBLIC_USER = {
  id: true,
  name: true,
  phone: true,
  email: true,
  approvalLimit: true,
  language: true,
  photoUrl: true,
  idProof: true,
  active: true,
  deviceId: true,
  lastLat: true,
  lastLng: true,
  lastSeenAt: true,
  createdAt: true,
  role: { select: { id: true, name: true, baseRole: true } },
  branches: { select: { branchId: true, branch: { select: { name: true } } } },
} as const;

@Injectable()
export class StaffService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(ctx: Ctx, q: { branchId?: string; role?: string }) {
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: ctx.tenantId,
        ...(q.role ? { role: { baseRole: q.role } } : {}),
        AND: [
          ...(q.branchId ? [{ branches: { some: { branchId: q.branchId } } }] : []),
          ...(ctx.branchIds ? [{ branches: { some: { branchId: { in: ctx.branchIds } } } }] : []),
        ],
      },
      select: PUBLIC_USER,
      orderBy: { name: 'asc' },
    });
    return users;
  }

  private async checkRoleAndBranches(ctx: Ctx, roleId: string, branchIds: string[]) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: ctx.tenantId } });
    if (!role) throw notFound('Role');
    // Only a Tenant Admin can create other admins, accountants or auditors.
    if (ctx.role !== 'TENANT_ADMIN' && ['TENANT_ADMIN', 'ACCOUNTANT', 'AUDITOR'].includes(role.baseRole)) {
      throw forbidden('Only the Tenant Admin can give this role');
    }
    const branches = await this.prisma.branch.count({ where: { tenantId: ctx.tenantId, id: { in: branchIds } } });
    if (branches !== branchIds.length) throw bad('Unknown branch');
    if (ctx.branchIds && branchIds.some((b) => !ctx.branchIds!.includes(b))) throw forbidden('You can only add staff to your own branches');
    return role;
  }

  async create(ctx: Ctx, input: z.infer<typeof staffSchema>) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if ((await this.prisma.user.count({ where: { tenantId: ctx.tenantId, active: true } })) >= t.maxStaff) {
      throw bad(`Your plan allows ${t.maxStaff} staff`);
    }
    await this.checkRoleAndBranches(ctx, input.roleId, input.branchIds);
    if (await this.prisma.user.findFirst({ where: { tenantId: ctx.tenantId, phone: input.phone } })) throw conflict('A staff member with this phone already exists');
    const password = input.password ?? randomBytes(4).toString('hex');
    const u = await this.prisma.user.create({
      data: {
        tenantId: ctx.tenantId,
        name: input.name,
        phone: input.phone,
        email: input.email?.toLowerCase() ?? null,
        passwordHash: await bcrypt.hash(password, 10),
        roleId: input.roleId,
        approvalLimit: input.approvalLimit,
        language: input.language,
        photoUrl: input.photoUrl ?? null,
        idProof: input.idProof ?? null,
        branches: { create: input.branchIds.map((branchId) => ({ branchId })) },
      },
      select: PUBLIC_USER,
    });
    await this.audit.log(ctx, 'CREATE', 'User', u.id, undefined, { ...input, password: undefined });
    return { ...u, temporaryPassword: input.password ? undefined : password };
  }

  async update(ctx: Ctx, id: string, input: z.infer<typeof staffSchema>) {
    const before = await this.get(ctx, id);
    await this.checkRoleAndBranches(ctx, input.roleId, input.branchIds);
    const dup = await this.prisma.user.findFirst({ where: { tenantId: ctx.tenantId, phone: input.phone, id: { not: id } } });
    if (dup) throw conflict('A staff member with this phone already exists');
    const u = await this.prisma.$transaction(async (tx) => {
      await tx.userBranch.deleteMany({ where: { userId: id } });
      return tx.user.update({
        where: { id },
        data: {
          name: input.name,
          phone: input.phone,
          email: input.email?.toLowerCase() ?? null,
          roleId: input.roleId,
          approvalLimit: input.approvalLimit,
          language: input.language,
          photoUrl: input.photoUrl ?? null,
          idProof: input.idProof ?? null,
          active: input.active ?? true,
          ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 10) } : {}),
          // Role or status changes end existing sessions.
          ...(before.role.id !== input.roleId || input.active === false ? { tokenVersion: { increment: 1 } } : {}),
          branches: { create: input.branchIds.map((branchId) => ({ branchId })) },
        },
        select: PUBLIC_USER,
      });
    });
    await this.audit.log(ctx, 'UPDATE', 'User', id, before, { ...input, password: undefined });
    return u;
  }

  async get(ctx: Ctx, id: string) {
    const u = await this.prisma.user.findFirst({ where: { id, tenantId: ctx.tenantId }, select: PUBLIC_USER });
    if (!u) throw notFound('Staff member');
    if (ctx.branchIds && !u.branches.some((b) => ctx.branchIds!.includes(b.branchId))) throw forbidden();
    return u;
  }

  async resetPassword(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    const password = randomBytes(4).toString('hex');
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    await this.audit.log(ctx, 'RESET_PASSWORD', 'User', id);
    return { temporaryPassword: password };
  }

  async resetDevice(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    await this.prisma.user.update({ where: { id }, data: { deviceId: null, tokenVersion: { increment: 1 } } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    await this.audit.log(ctx, 'RESET_DEVICE', 'User', id);
    return { ok: true };
  }

  async forceLogout(ctx: Ctx, id: string) {
    await this.get(ctx, id);
    await this.prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
    await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
    await this.audit.log(ctx, 'FORCE_LOGOUT', 'User', id);
    return { ok: true };
  }

  // ---------- Roles ----------
  roles(ctx: Ctx) {
    return this.prisma.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
  }

  async createRole(ctx: Ctx, input: z.infer<typeof roleSchema>) {
    if (input.baseRole === 'SUPER_ADMIN') throw forbidden();
    if (await this.prisma.role.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } })) throw conflict('A role with this name exists');
    const r = await this.prisma.role.create({ data: { ...input, tenantId: ctx.tenantId, permissions: input.permissions.filter((p) => p !== 'tenant.manage'), permsVersion: ROLE_PERMS_VERSION } });
    await this.audit.log(ctx, 'CREATE', 'Role', r.id, undefined, input);
    return r;
  }

  async updateRole(ctx: Ctx, id: string, input: z.infer<typeof roleSchema>) {
    const r = await this.prisma.role.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw notFound('Role');
    if (input.baseRole === 'SUPER_ADMIN') throw forbidden();
    if (r.baseRole === 'TENANT_ADMIN' && !input.permissions.includes('staff.manage')) throw bad('The Tenant Admin role must keep staff management');
    const u = await this.prisma.role.update({
      where: { id },
      data: { name: input.name, baseRole: r.system ? r.baseRole : input.baseRole, permissions: input.permissions.filter((p) => p !== 'tenant.manage') },
    });
    await this.audit.log(ctx, 'UPDATE', 'Role', id, r, input);
    return u;
  }
}

@Controller()
export class StaffController {
  constructor(private readonly svc: StaffService) {}

  @Get('staff') @Perm('staff.manage', 'route.manage', 'report.view', 'handover.verify', 'daybook.approve') list(@CurrentCtx() ctx: Ctx, @Query('branchId') branchId?: string, @Query('role') role?: string) {
    return this.svc.list(ctx, { branchId, role });
  }
  @Get('staff/:id') @Perm('staff.manage') get(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.get(ctx, id);
  }
  @Post('staff') @Perm('staff.manage') create(@CurrentCtx() ctx: Ctx, @Body(V(staffSchema)) b: z.infer<typeof staffSchema>) {
    return this.svc.create(ctx, b);
  }
  @Put('staff/:id') @Perm('staff.manage') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(staffSchema)) b: z.infer<typeof staffSchema>) {
    return this.svc.update(ctx, id, b);
  }
  @Post('staff/:id/reset-password') @Perm('staff.manage') reset(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.resetPassword(ctx, id);
  }
  @Post('staff/:id/reset-device') @Perm('staff.manage') resetDevice(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.resetDevice(ctx, id);
  }
  @Post('staff/:id/force-logout') @Perm('staff.manage') forceLogout(@CurrentCtx() ctx: Ctx, @Param('id') id: string) {
    return this.svc.forceLogout(ctx, id);
  }

  @Get('roles') @Perm('staff.manage') roles(@CurrentCtx() ctx: Ctx) {
    return this.svc.roles(ctx);
  }
  @Post('roles') @Perm('staff.manage') createRole(@CurrentCtx() ctx: Ctx, @Body(V(roleSchema)) b: z.infer<typeof roleSchema>) {
    return this.svc.createRole(ctx, b);
  }
  @Put('roles/:id') @Perm('staff.manage') updateRole(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(roleSchema)) b: z.infer<typeof roleSchema>) {
    return this.svc.updateRole(ctx, id, b);
  }
}
