import type { Ctx } from './context';
import { forbidden } from './errors';

/** Prisma where-fragment limiting a branch-owned table to the user's tenant and branches. */
export function branchScope(ctx: Ctx, branchId?: string): { tenantId: string; branchId?: string | { in: string[] } } {
  if (branchId) {
    assertBranch(ctx, branchId);
    return { tenantId: ctx.tenantId, branchId };
  }
  return ctx.branchIds ? { tenantId: ctx.tenantId, branchId: { in: ctx.branchIds } } : { tenantId: ctx.tenantId };
}

export function assertBranch(ctx: Ctx, branchId: string) {
  if (ctx.branchIds && !ctx.branchIds.includes(branchId)) throw forbidden('This record belongs to a branch you cannot access');
}

export function can(ctx: Ctx, perm: Parameters<Ctx['permissions']['has']>[0]) {
  return ctx.permissions.has(perm);
}

/** Roles that see every branch of the tenant. */
export const ALL_BRANCH_ROLES = new Set(['TENANT_ADMIN', 'ACCOUNTANT', 'AUDITOR', 'SUPER_ADMIN']);
