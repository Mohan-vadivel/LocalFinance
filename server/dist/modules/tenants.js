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
exports.SettingsController = exports.TenantsController = exports.TenantsService = exports.DEFAULT_EXPENSE_CATEGORIES = void 0;
exports.bootstrapTenant = bootstrapTenant;
const common_1 = require("@nestjs/common");
const client_1 = require("@prisma/client");
const bcrypt = __importStar(require("bcryptjs"));
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const zod_pipe_1 = require("../common/zod.pipe");
const ROLE_NAMES = {
    SUPER_ADMIN: 'Super Admin',
    TENANT_ADMIN: 'Tenant Admin',
    BRANCH_MANAGER: 'Branch Manager',
    LOAN_OFFICER: 'Loan Officer',
    COLLECTION_AGENT: 'Collection Agent',
    ACCOUNTANT: 'Accountant',
    AUDITOR: 'Auditor',
};
exports.DEFAULT_EXPENSE_CATEGORIES = [
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
async function bootstrapTenant(tx, tenantId) {
    for (const code of shared_1.ROLES.filter((r) => r !== 'SUPER_ADMIN')) {
        await tx.role.create({
            data: { tenantId, name: ROLE_NAMES[code], baseRole: code, permissions: shared_1.DEFAULT_ROLE_PERMISSIONS[code], permsVersion: shared_1.ROLE_PERMS_VERSION, system: true },
        });
    }
    await tx.expenseCategory.createMany({ data: exports.DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ ...c, tenantId })) });
}
let TenantsService = class TenantsService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    /** Gives built-in roles of existing businesses the permissions added since they were set up. */
    async onModuleInit() {
        const roles = await this.prisma.role.findMany({ where: { system: true, permsVersion: { lt: shared_1.ROLE_PERMS_VERSION } } });
        for (const r of roles) {
            const defaults = shared_1.DEFAULT_ROLE_PERMISSIONS[r.baseRole] ?? [];
            const added = Object.entries(shared_1.PERMISSIONS_ADDED)
                .filter(([v]) => Number(v) > r.permsVersion)
                .flatMap(([, perms]) => perms.filter((p) => defaults.includes(p)));
            await this.prisma.role.update({ where: { id: r.id }, data: { permissions: [...new Set([...r.permissions, ...added])], permsVersion: shared_1.ROLE_PERMS_VERSION } });
        }
    }
    async list() {
        const tenants = await this.prisma.tenant.findMany({ orderBy: { createdAt: 'desc' } });
        const counts = await Promise.all(tenants.map(async (t) => ({
            id: t.id,
            branches: await this.prisma.branch.count({ where: { tenantId: t.id } }),
            staff: await this.prisma.user.count({ where: { tenantId: t.id, active: true } }),
            activeLoans: await this.prisma.loan.count({ where: { tenantId: t.id, status: 'ACTIVE' } }),
            customers: await this.prisma.customer.count({ where: { tenantId: t.id } }),
        })));
        return tenants.map((t) => ({ ...t, usage: counts.find((c) => c.id === t.id) }));
    }
    async create(ctx, input) {
        const exists = await this.prisma.user.findFirst({ where: { phone: input.ownerPhone, role: { baseRole: 'TENANT_ADMIN' }, tenant: { name: input.name } } });
        if (exists)
            throw (0, errors_1.conflict)('A business with this name and owner already exists');
        const tenant = await this.prisma.tx(async (tx) => {
            const t = await tx.tenant.create({
                data: {
                    name: input.name,
                    businessId: input.businessId,
                    plan: input.plan,
                    planExpiresOn: input.planExpiresOn ?? null,
                    maxBranches: input.maxBranches,
                    maxStaff: input.maxStaff,
                    maxActiveLoans: input.maxActiveLoans,
                    settings: shared_1.tenantSettingsSchema.parse({}),
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
    async update(ctx, id, input) {
        const t = await this.prisma.tenant.findUnique({ where: { id } });
        if (!t)
            throw (0, errors_1.notFound)('Business');
        const { settings, ...rest } = input;
        const merged = settings ? shared_1.tenantSettingsSchema.parse({ ...t.settings, ...settings }) : undefined;
        const updated = await this.prisma.tenant.update({ where: { id }, data: { ...rest, ...(merged ? { settings: merged } : {}) } });
        await this.audit.log(ctx, 'UPDATE', 'Tenant', id, { status: t.status, plan: t.plan, planExpiresOn: t.planExpiresOn }, rest);
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
};
exports.TenantsService = TenantsService;
exports.TenantsService = TenantsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], TenantsService);
const supportSchema = zod_1.z.object({ days: zod_1.z.number().int().min(0).max(30) });
let TenantsController = class TenantsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    list() {
        return this.svc.list();
    }
    stats() {
        return this.svc.platformStats();
    }
    create(ctx, body) {
        return this.svc.create(ctx, body);
    }
    update(ctx, id, body) {
        return this.svc.update(ctx, id, body);
    }
};
exports.TenantsController = TenantsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "list", null);
__decorate([
    (0, common_1.Get)('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "stats", null);
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.createTenantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "create", null);
__decorate([
    (0, common_1.Patch)(':id'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.updateTenantSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, void 0]),
    __metadata("design:returntype", void 0)
], TenantsController.prototype, "update", null);
exports.TenantsController = TenantsController = __decorate([
    (0, common_1.Controller)('platform/tenants'),
    (0, context_1.SuperAdminOnly)(),
    __metadata("design:paramtypes", [TenantsService])
], TenantsController);
/** The tenant's own settings, branding and support access, managed by the Tenant Admin. */
let SettingsController = class SettingsController {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async get(ctx) {
        const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        return { id: t.id, name: t.name, logoUrl: t.logoUrl, status: t.status, supportAccessUntil: t.supportAccessUntil, settings: ctx.settings };
    }
    async put(ctx, body) {
        const merged = shared_1.tenantSettingsSchema.parse({ ...ctx.settings, ...(body.settings ?? {}) });
        const t = await this.prisma.tenant.update({
            where: { id: ctx.tenantId },
            data: { name: body.name, logoUrl: body.logoUrl, settings: merged },
        });
        await this.audit.log(ctx, 'UPDATE', 'Settings', t.id, ctx.settings, merged);
        return { id: t.id, name: t.name, logoUrl: t.logoUrl, settings: merged };
    }
    /** Every record of this business as one JSON file, for the owner to keep. Passwords and login tokens are left out. */
    async backup(ctx) {
        const tenantId = ctx.tenantId;
        const own = { tenantId };
        const db = this.prisma;
        const tables = {};
        for (const m of client_1.Prisma.dmmf.datamodel.models) {
            const delegate = m.name[0].toLowerCase() + m.name.slice(1);
            if (m.name === 'Tenant' || m.name === 'RefreshToken')
                continue;
            const where = m.fields.some((f) => f.name === 'tenantId')
                ? own
                : m.name === 'UserBranch'
                    ? { user: own }
                    : m.name === 'LoanApproval'
                        ? { loan: own }
                        : m.name === 'CollectionAllocation'
                            ? { collection: own }
                            : null;
            if (!where)
                continue;
            const rows = await db[delegate].findMany({ where });
            tables[m.name] = m.name === 'User' ? rows.map((u) => ({ ...u, passwordHash: undefined })) : rows;
        }
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
        await this.audit.log(ctx, 'BACKUP', 'Tenant', tenantId);
        return { format: 'localfinance-backup', version: 1, exportedAt: new Date().toISOString(), tenant, tables };
    }
    /** Lets the platform's Super Admin view this business read-only for a number of days (0 revokes). */
    async support(ctx, body) {
        const until = body.days ? new Date(Date.now() + body.days * 86_400_000) : null;
        await this.prisma.tenant.update({ where: { id: ctx.tenantId }, data: { supportAccessUntil: until } });
        await this.audit.log(ctx, body.days ? 'GRANT_SUPPORT' : 'REVOKE_SUPPORT', 'Tenant', ctx.tenantId, undefined, { until });
        return { supportAccessUntil: until };
    }
};
exports.SettingsController = SettingsController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Put)(),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.updateTenantSchema.pick({ name: true, logoUrl: true, settings: true })))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "put", null);
__decorate([
    (0, common_1.Get)('backup'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "backup", null);
__decorate([
    (0, common_1.Post)('support-access'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(supportSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", Promise)
], SettingsController.prototype, "support", null);
exports.SettingsController = SettingsController = __decorate([
    (0, common_1.Controller)('settings'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], SettingsController);
//# sourceMappingURL=tenants.js.map