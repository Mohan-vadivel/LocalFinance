"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLE_PERMS_VERSION = exports.PERMISSIONS_ADDED = exports.DEFAULT_ROLE_PERMISSIONS = exports.PERMISSIONS = void 0;
exports.PERMISSIONS = [
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
    'salary.manage',
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
];
const ALL_TENANT = exports.PERMISSIONS.filter((p) => p !== 'tenant.manage');
/** Default permissions per role; a tenant can edit these per role. */
exports.DEFAULT_ROLE_PERMISSIONS = {
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
        'salary.manage',
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
exports.PERMISSIONS_ADDED = {
    1: ['daybook.request', 'daybook.approve'],
    2: ['salary.manage'],
};
exports.ROLE_PERMS_VERSION = Math.max(...Object.keys(exports.PERMISSIONS_ADDED).map(Number));
//# sourceMappingURL=permissions.js.map