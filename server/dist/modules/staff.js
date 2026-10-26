"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaffController = exports.StaffService = void 0;
const common_1 = require("@nestjs/common");
const bcrypt = __importStar(require("bcryptjs"));
const crypto_1 = require("crypto");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const zod_pipe_1 = require("../common/zod.pipe");
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
};
let StaffService = class StaffService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async list(ctx, q) {
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
    async checkRoleAndBranches(ctx, roleId, branchIds) {
        const role = await this.prisma.role.findFirst({ where: { id: roleId, tenantId: ctx.tenantId } });
        if (!role)
            throw (0, errors_1.notFound)('Role');
        // Only a Tenant Admin can create other admins, accountants or auditors.
        if (ctx.role !== 'TENANT_ADMIN' && ['TENANT_ADMIN', 'ACCOUNTANT', 'AUDITOR'].includes(role.baseRole)) {
            throw (0, errors_1.forbidden)('Only the Tenant Admin can give this role');
        }
        const branches = await this.prisma.branch.count({ where: { tenantId: ctx.tenantId, id: { in: branchIds } } });
        if (branches !== branchIds.length)
            throw (0, errors_1.bad)('Unknown branch');
        if (ctx.branchIds && branchIds.some((b) => !ctx.branchIds.includes(b)))
            throw (0, errors_1.forbidden)('You can only add staff to your own branches');
        return role;
    }
    async create(ctx, input) {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        if ((await this.prisma.user.count({ where: { tenantId: ctx.tenantId, active: true } })) >= t.maxStaff) {
            throw (0, errors_1.bad)(`Your plan allows ${t.maxStaff} staff`);
        }
        await this.checkRoleAndBranches(ctx, input.roleId, input.branchIds);
        if (await this.prisma.user.findFirst({ where: { tenantId: ctx.tenantId, phone: input.phone } }))
            throw (0, errors_1.conflict)('A staff member with this phone already exists');
        const password = input.password ?? (0, crypto_1.randomBytes)(4).toString('hex');
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
    async update(ctx, id, input) {
        const before = await this.get(ctx, id);
        await this.checkRoleAndBranches(ctx, input.roleId, input.branchIds);
        const dup = await this.prisma.user.findFirst({ where: { tenantId: ctx.tenantId, phone: input.phone, id: { not: id } } });
        if (dup)
            throw (0, errors_1.conflict)('A staff member with this phone already exists');
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
    async get(ctx, id) {
        const u = await this.prisma.user.findFirst({ where: { id, tenantId: ctx.tenantId }, select: PUBLIC_USER });
        if (!u)
            throw (0, errors_1.notFound)('Staff member');
        if (ctx.branchIds && !u.branches.some((b) => ctx.branchIds.includes(b.branchId)))
            throw (0, errors_1.forbidden)();
        return u;
    }
    async resetPassword(ctx, id) {
        await this.get(ctx, id);
        const password = (0, crypto_1.randomBytes)(4).toString('hex');
        await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10), tokenVersion: { increment: 1 }, failedLogins: 0, lockedUntil: null } });
        await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
        await this.audit.log(ctx, 'RESET_PASSWORD', 'User', id);
        return { temporaryPassword: password };
    }
    async resetDevice(ctx, id) {
        await this.get(ctx, id);
        await this.prisma.user.update({ where: { id }, data: { deviceId: null, tokenVersion: { increment: 1 } } });
        await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
        await this.audit.log(ctx, 'RESET_DEVICE', 'User', id);
        return { ok: true };
    }
    async forceLogout(ctx, id) {
        await this.get(ctx, id);
        await this.prisma.user.update({ where: { id }, data: { tokenVersion: { increment: 1 } } });
        await this.prisma.refreshToken.updateMany({ where: { userId: id }, data: { revoked: true } });
        await this.audit.log(ctx, 'FORCE_LOGOUT', 'User', id);
        return { ok: true };
    }
    // ---------- Roles ----------
    roles(ctx) {
        return this.prisma.role.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' }, include: { _count: { select: { users: true } } } });
    }
    async createRole(ctx, input) {
        if (input.baseRole === 'SUPER_ADMIN')
            throw (0, errors_1.forbidden)();
        if (await this.prisma.role.findFirst({ where: { tenantId: ctx.tenantId, name: input.name } }))
            throw (0, errors_1.conflict)('A role with this name exists');
        const r = await this.prisma.role.create({ data: { ...input, tenantId: ctx.tenantId, permissions: input.permissions.filter((p) => p !== 'tenant.manage'), permsVersion: shared_1.ROLE_PERMS_VERSION } });
        await this.audit.log(ctx, 'CREATE', 'Role', r.id, undefined, input);
        return r;
    }
    async updateRole(ctx, id, input) {
        const r = await this.prisma.role.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!r)
            throw (0, errors_1.notFound)('Role');
        if (input.baseRole === 'SUPER_ADMIN')
            throw (0, errors_1.forbidden)();
        if (r.baseRole === 'TENANT_ADMIN' && !input.permissions.includes('staff.manage'))
            throw (0, errors_1.bad)('The Tenant Admin role must keep staff management');
        const u = await this.prisma.role.update({
            where: { id },
            data: { name: input.name, baseRole: r.system ? r.baseRole : input.baseRole, permissions: input.permissions.filter((p) => p !== 'tenant.manage') },
        });
        await this.audit.log(ctx, 'UPDATE', 'Role', id, r, input);
        return u;
    }
};
exports.StaffService = StaffService;
exports.StaffService = StaffService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], StaffService);
let StaffController = class StaffController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list(ctx, branchId, role) {
        return this.svc.list(ctx, { branchId, role });
    }
    get(ctx, id) {
        return this.svc.get(ctx, id);
    }
    create(ctx, b) {
        return this.svc.create(ctx, b);
    }
    update(ctx, id, b) {
        return this.svc.update(ctx, id, b);
    }
    reset(ctx, id) {
        return this.svc.resetPassword(ctx, id);
    }
    resetDevice(ctx, id) {
        return this.svc.resetDevice(ctx, id);
    }
    forceLogout(ctx, id) {
        return this.svc.forceLogout(ctx, id);
    }
    roles(ctx) {
        return this.svc.roles(ctx);
    }
    createRole(ctx, b) {
        return this.svc.createRole(ctx, b);
    }
    updateRole(ctx, id, b) {
        return this.svc.updateRole(ctx, id, b);
    }
};
exports.StaffController = StaffController;
__decorate([
    (0, common_1.Get)('staff'),
    (0, context_1.Perm)('staff.manage', 'route.manage', 'report.view', 'handover.verify', 'daybook.approve'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Query)('branchId')),
    __param(2, (0, common_1.Query)('role')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, String]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('staff/:id'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "get", null);
__decorate([
    (0, common_1.Post)('staff'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.staffSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "create", null);
__decorate([
    (0, common_1.Put)('staff/:id'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.staffSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "update", null);
__decorate([
    (0, common_1.Post)('staff/:id/reset-password'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "reset", null);
__decorate([
    (0, common_1.Post)('staff/:id/reset-device'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "resetDevice", null);
__decorate([
    (0, common_1.Post)('staff/:id/force-logout'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "forceLogout", null);
__decorate([
    (0, common_1.Get)('roles'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "roles", null);
__decorate([
    (0, common_1.Post)('roles'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.roleSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "createRole", null);
__decorate([
    (0, common_1.Put)('roles/:id'),
    (0, context_1.Perm)('staff.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.roleSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], StaffController.prototype, "updateRole", null);
exports.StaffController = StaffController = __decorate([
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [StaffService])
], StaffController);
//# sourceMappingURL=staff.js.map