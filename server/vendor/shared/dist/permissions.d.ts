import type { RoleCode } from './enums';
export declare const PERMISSIONS: readonly ["tenant.manage", "settings.manage", "branch.manage", "staff.manage", "customer.create", "customer.edit", "customer.view", "loan.request", "loan.approve", "loan.disburse", "loan.manage", "fund.manage", "investor.manage", "salary.manage", "route.manage", "collection.record", "collection.reverse", "handover.verify", "daybook.manage", "daybook.view", "daybook.request", "daybook.approve", "report.view", "pl.view", "audit.view"];
export type Permission = (typeof PERMISSIONS)[number];
/** Default permissions per role; a tenant can edit these per role. */
export declare const DEFAULT_ROLE_PERMISSIONS: Record<RoleCode, Permission[]>;
/**
 * Permissions added after businesses were already set up, by version. On start-up each built-in role below the
 * current version gets that version's permissions its default list includes, once, so an owner who later removes
 * one does not see it come back.
 */
export declare const PERMISSIONS_ADDED: Record<number, Permission[]>;
export declare const ROLE_PERMS_VERSION: number;
