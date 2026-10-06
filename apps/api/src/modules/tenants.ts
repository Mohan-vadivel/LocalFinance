import { Body, Controller, Get, Injectable, type OnModuleInit, Param, Patch, Post, Put } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  createTenantSchema,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSIONS_ADDED,
  ROLE_PERMS_VERSION,
  ROLES,
  tenantSettingsSchema,
  updateTenantSchema,
  type RoleCode,
} from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Perm, SuperAdminOnly, type Ctx } from '../common/context';
import { conflict, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { V } from '../common/zod.pipe';

const ROLE_NAMES: Record<RoleCode, string> = {
  SUPER_ADMIN: 'Super Admin',
  TENANT_ADMIN: 'Tenant Admin',
  BRANCH_MANAGER: 'Branch Manager',
  LOAN_OFFICER: 'Loan Officer',
  COLLECTION_AGENT: 'Collection Agent',
  ACCOUNTANT: 'Accountant',
  AUDITOR: 'Auditor',
};

export const DEFAULT_EXPENSE_CATEGORIES: { name: string; kind: string }[] = [
  { name: 'Rent', kind: 'EXPENSE' },
  { name: 'Salary', kind: 'EXPENSE' },
  { name: 'Fuel and travel', kind: 'EXPENSE' },
  { name: 'Stationery and printing', kind: 'EXPENSE' },
  { name: 'Electricity and phone', kind: 'EXPENSE' },
  { name: 'Other expense', kind: 'EXPENSE' },
  { name: 'Other income', kind: 'INCOME' },
  { name: 'Owner drawing', kind: 'DRAWING' },
  { name: 'Bank deposit', kind: 'BANK' },
  { name: 'Bank withdrawal', kind: 'BANK' },
];

/** Creates the default roles and day book categories for a new tenant. */
export async function bootstrapTenant(tx: Tx, tenantId: string) {
  for (const code of ROLES.filter((r) => r !== 'SUPER_ADMIN')) {
    await tx.role.create({
      data: { tenantId, name: ROLE_NAMES[code], baseRole: code, permissions: DEFAULT_ROLE_PERMISSIONS[code], permsVersion: ROLE_PERMS_VERSION, system: true },
    });
  }
  await tx.expenseCategory.createMany({ data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, tenantId })) });
}

@Injectable()
export class TenantsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Gives built-in roles of existing businesses the permissions added since they were set up. */
  async onModuleInit() {
    const roles = await this.prisma.role.findMany({ where: { system: true, permsVersion: { lt: ROLE_PERMS_VERSION } } });
    for (const r of roles) {
      const defaults = DEFAULT_ROLE_PERMISSIONS[r.baseRole as RoleCode] ?? [];
      const added = Object.entries(PERMISSIONS_ADDED)
        .filter(([v]) => Number(v) > r.permsVersion)
        .flatMap(([, perms]) => perms.filter((p) => defaults.includes(p)));
      await this.prisma.role.update({ where: { id: r.id }, data: { permissions: [...new Set([...r.permissions, ...added])], permsVersion: ROLE_PERMS_VERSION } });
    }
  }

  async list() {
    const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
    const counts = await Promise.all(
      tenants.map(async (t) => ({
        id: t.id,
        branches: await this.prisma.branch.count({ where: { tenantId: t.id } }),
        staff: await this.prisma.user.count({ where: { tenantId: t.id, active: true } }),
        activeLoans: await this.prisma.loan.count({ where: { tenantId: t.id, status: 'ACTIVE' } }),
        customers: await this.prisma.customer.count({ where: { tenantId: t.id } }),
      })),
    );
    return tenants.map((t) => ({ ...t, usage: counts.find((c) => c.id === t.id) }));
  }

  async create(ctx: Ctx, input: z.infer<typeof createTenantSchema>) {
    const exists = await this.prisma.user.findFirst({ where: { phone: input.ownerPhone, role: { baseRole: 'TENANT_ADMIN' }, tenant: { name: input.name } } });
    if (exists) throw conflict('A business with this name and owner already exists');
    const tenant = await this.prisma.tx(async (tx) => {
      const t = await tx.tenant.create({
        data: {
          name: input.name,
          businessId: input.businessId,
          plan: input.plan,
          maxBranches: input.maxBranches,
          maxStaff: input.maxStaff,
          maxActiveLoans: input.maxActiveLoans,
          settings: tenantSettingsSchema.parse({}),
        },
      });
      await bootstrapTenant(tx, t.id);
      const adminRole = await tx.role.findFirstOrThrow({ where: { tenantId: t.id, baseRole: 'TENANT_ADMIN' } });
      await tx.user.create({
        data: {
          tenantId: t.id,
          name: input.ownerName,
          phone: input.ownerPhone,
          email: input.ownerEmail?.toLowerCase(),
          passwordHash: await bcrypt.hash(input.ownerPassword, 10),
          roleId: adminRole.id,
        },
      });
      return t;
    });
    await this.audit.log(ctx, 'CREATE', 'Tenant', tenant.id, undefined, { name: tenant.name });
    return tenant;
  }

  async update(ctx: Ctx, id: string, input: z.infer<typeof updateTenantSchema>) {
    const t = await this.prisma.tenant.findUnique({ where: { id } });
    if (!t) throw notFound('Business');
    const { settings, ...rest } = input;
    const merged = settings ? tenantSettingsSchema.parse({ ...(t.settings as object), ...settings }) : undefined;
    const updated = await this.prisma.tenant.update({ where: { id }, data: { ...rest, ...(merged ? { settings: merged } : {}) } });
    await this.audit.log(ctx, 'UPDATE', 'Tenant', id, { status: t.status, plan: t.plan }, rest);
    return updated;
  }

  async platformStats() {
    const [tenants, active, users, loans, customers] = await Promise.all([
      this.prisma.tenant.count(),
      this.prisma.tenant.count({ where: { status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { active: true, tenantId: { not: null } } }),
      this.prisma.loan.count({ where: { status: 'ACTIVE' } }),
      this.prisma.customer.count(),
    ]);
    return { tenants, activeTenants: active, staff: users, activeLoans: loans, customers };
  }
}

const supportSchema = z.object({ days: z.number().int().min(0).max(30) });

@Controller('platform/tenants')
@SuperAdminOnly()
export class TenantsController {
  constructor(private readonly svc: TenantsService) {}
  @Get() list() {
    return this.svc.list();
  }
  @Get('stats') stats() {
    return this.svc.platformStats();
  }
  @Post() create(@CurrentCtx() ctx: Ctx, @Body(V(createTenantSchema)) body: z.infer<typeof createTenantSchema>) {
    return this.svc.create(ctx, body);
  }
  @Patch(':id') update(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(updateTenantSchema)) body: z.infer<typeof updateTenantSchema>) {
    return this.svc.update(ctx, id, body);
  }
}

/** The tenant's own settings, branding and support access, managed by the Tenant Admin. */
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  async get(@CurrentCtx() ctx: Ctx) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    return { id: t.id, name: t.name, logoUrl: t.logoUrl, status: t.status, supportAccessUntil: t.supportAccessUntil, settings: ctx.settings };
  }

  @Put()
  @Perm('settings.manage')
  async put(@CurrentCtx() ctx: Ctx, @Body(V(updateTenantSchema.pick({ name: true, logoUrl: true, settings: true }))) body: { name?: string; logoUrl?: string | null; settings?: Partial<z.infer<typeof tenantSettingsSchema>> }) {
    const merged = tenantSettingsSchema.parse({ ...ctx.settings, ...(body.settings ?? {}) });
    const t = await this.prisma.tenant.update({
      where: { id: ctx.tenantId },
      data: { name: body.name, logoUrl: body.logoUrl, settings: merged },
    });
    await this.audit.log(ctx, 'UPDATE', 'Settings', t.id, ctx.settings, merged);
    return { id: t.id, name: t.name, logoUrl: t.logoUrl, settings: merged };
  }

  /** Every record of this business as one JSON file, for the owner to keep. Passwords and login tokens are left out. */
  @Get('backup')
  @Perm('settings.manage')
  async backup(@CurrentCtx() ctx: Ctx) {
    const tenantId = ctx.tenantId;
    const own = { tenantId };
    const db = this.prisma as unknown as Record<string, { findMany: (a: object) => Promise<unknown[]> }>;
    const tables: Record<string, unknown[]> = {};
    for (const m of Prisma.dmmf.datamodel.models) {
      const delegate = m.name[0].toLowerCase() + m.name.slice(1);
      if (m.name === 'Tenant' || m.name === 'RefreshToken') continue;
      const where = m.fields.some((f) => f.name === 'tenantId')
        ? own
        : m.name === 'UserBranch'
          ? { user: own }
          : m.name === 'LoanApproval'
            ? { loan: own }
            : m.name === 'CollectionAllocation'
              ? { collection: own }
              : null;
      if (!where) continue;
      const rows = await db[delegate].findMany({ where });
      tables[m.name] = m.name === 'User' ? rows.map((u) => ({ ...(u as object), passwordHash: undefined })) : rows;
    }
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await this.audit.log(ctx, 'BACKUP', 'Tenant', tenantId);
    return { format: 'localfinance-backup', version: 1, exportedAt: new Date().toISOString(), tenant, tables };
  }

  /** Lets the platform's Super Admin view this business read-only for a number of days (0 revokes). */
  @Post('support-access')
  @Perm('settings.manage')
  async support(@CurrentCtx() ctx: Ctx, @Body(V(supportSchema)) body: z.infer<typeof supportSchema>) {
    const until = body.days ? new Date(Date.now() + body.days * 86_400_000) : null;
    await this.prisma.tenant.update({ where: { id: ctx.tenantId }, data: { supportAccessUntil: until } });
    await this.audit.log(ctx, body.days ? 'GRANT_SUPPORT' : 'REVOKE_SUPPORT', 'Tenant', ctx.tenantId, undefined, { until });
    return { supportAccessUntil: until };
  }
}
