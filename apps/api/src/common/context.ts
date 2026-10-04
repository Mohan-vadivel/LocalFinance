import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission, RoleCode, TenantSettings } from '@localfinance/shared';

export interface Ctx {
  userId: string;
  tenantId: string; // empty string for Super Admin outside support access
  role: RoleCode;
  permissions: Set<Permission>;
  /** null = all branches in the tenant */
  branchIds: string[] | null;
  approvalLimit: number;
  settings: TenantSettings;
  tenantName: string;
  tenantStatus: string;
  readOnly: boolean;
  ip?: string;
  device?: string;
}

export const CurrentCtx = createParamDecorator((_: unknown, ec: ExecutionContext): Ctx => ec.switchToHttp().getRequest().ctx);

export const PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export const PERMS_KEY = 'perms';
/** Requires any one of the listed permissions. */
export const Perm = (...perms: Permission[]) => SetMetadata(PERMS_KEY, perms);

export const SUPER_KEY = 'superOnly';
export const SuperAdminOnly = () => SetMetadata(SUPER_KEY, true);

/** Allows any logged-in user, including a Super Admin with no business open. */
export const AnyUser = () => SetMetadata('anyUser', true);
