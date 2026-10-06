import type { RoleCode } from './enums';

export const PERMISSIONS = [
  'tenant.manage',
  'settings.manage',
  'branch.manage',
  'staff.manage',
  'customer.create',
  'customer.edit',
  'customer.view',
  'loan.request',
  'loan.approve',
  'loan.disburse',
  'loan.manage',
  'fund.manage',
  'investor.manage',
  'route.manage',
  'collection.record',
  'collection.reverse',
  'handover.verify',
  'daybook.manage',
  'daybook.view',
  'daybook.request',
  'daybook.approve',
  'report.view',
  'pl.view',
  'audit.view',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const ALL_TENANT: Permission[] = PERMISSIONS.filter((p) => p !== 'tenant.manage');

/** Default permissions per role; a tenant can edit these per role. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]> = {
  SUPER_ADMIN: ['tenant.manage'],
  TENANT_ADMIN: ALL_TENANT,
  BRANCH_MANAGER: [
    'staff.manage',
    'customer.create',
    'customer.edit',
    'customer.view',
    'loan.request',
    'loan.approve',
    'loan.disburse',
    'loan.manage',
    'route.manage',
    'collection.record',
    'collection.reverse',
    'handover.verify',
    'daybook.manage',
    'daybook.view',
    'daybook.approve',
    'report.view',
  ],
  LOAN_OFFICER: ['customer.create', 'customer.edit', 'customer.view', 'loan.request', 'daybook.request', 'report.view'],
  COLLECTION_AGENT: ['customer.create', 'customer.view', 'loan.request', 'collection.record', 'daybook.request'],
  ACCOUNTANT: [
    'customer.view',
    'loan.disburse',
    'fund.manage',
    'investor.manage',
    'handover.verify',
    'daybook.manage',
    'daybook.view',
    'daybook.request',
    'report.view',
    'pl.view',
  ],
  AUDITOR: ['customer.view', 'daybook.view', 'report.view', 'pl.view', 'audit.view'],
};

/**
 * Permissions added after businesses were already set up, by version. On start-up each built-in role below the
 * current version gets that version's permissions its default list includes, once, so an owner who later removes
 * one does not see it come back.
 */
export const PERMISSIONS_ADDED: Record<number, Permission[]> = {
  1: ['daybook.request', 'daybook.approve'],
};
export const ROLE_PERMS_VERSION = Math.max(...Object.keys(PERMISSIONS_ADDED).map(Number));
