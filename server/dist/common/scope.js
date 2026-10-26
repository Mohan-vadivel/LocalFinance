"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALL_BRANCH_ROLES = void 0;
exports.branchScope = branchScope;
exports.assertBranch = assertBranch;
exports.assertOwned = assertOwned;
exports.can = can;
const errors_1 = require("./errors");
/** Prisma where-fragment limiting a branch-owned table to the user's tenant and branches. */
function branchScope(ctx, branchId) {
    if (branchId) {
        assertBranch(ctx, branchId);
        return { tenantId: ctx.tenantId, branchId };
    }
    return ctx.branchIds ? { tenantId: ctx.tenantId, branchId: { in: ctx.branchIds } } : { tenantId: ctx.tenantId };
}
function assertBranch(ctx, branchId) {
    if (ctx.branchIds && !ctx.branchIds.includes(branchId))
        throw (0, errors_1.forbidden)('This record belongs to a branch you cannot access');
}
/**
 * Throws "not found" unless the record belongs to the caller's business. Use it on every id taken from a request
 * before saving it as a link, so one business can never point its rows at another business's records.
 */
async function assertOwned(model, ctx, id, what) {
    if (!id)
        return;
    if (!(await model.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true } })))
        throw (0, errors_1.notFound)(what);
}
function can(ctx, perm) {
    return ctx.permissions.has(perm);
}
/** Roles that see every branch of the tenant. */
exports.ALL_BRANCH_ROLES = new Set(['TENANT_ADMIN', 'ACCOUNTANT', 'AUDITOR', 'SUPER_ADMIN']);
//# sourceMappingURL=scope.js.map