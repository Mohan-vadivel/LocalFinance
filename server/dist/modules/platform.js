"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlanController = exports.SupportController = exports.PlatformSettingsController = exports.PlatformService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const zod_pipe_1 = require("../common/zod.pipe");
const ROW = 'platform';
/** The platform's own settings (support contacts, help videos, renewal by UPI): one row, edited by the Super Admin. */
let PlatformService = class PlatformService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async get() {
        const r = await this.prisma.platformSettings.findUnique({ where: { id: ROW } });
        return {
            supportPhone: r?.supportPhone ?? null,
            supportEmail: r?.supportEmail ?? null,
            supportHours: r?.supportHours ?? null,
            helpVideos: r?.helpVideos ?? [],
            upiId: r?.upiId ?? null,
            upiName: r?.upiName ?? 'WITS',
            yearlyPrice: r?.yearlyPrice ?? 0,
        };
    }
    async put(ctx, input) {
        const before = await this.get();
        await this.prisma.platformSettings.upsert({ where: { id: ROW }, create: { id: ROW, ...input }, update: input });
        await this.audit.log(ctx, 'UPDATE', 'PlatformSettings', ROW, before, input);
        return this.get();
    }
};
exports.PlatformService = PlatformService;
exports.PlatformService = PlatformService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], PlatformService);
let PlatformSettingsController = class PlatformSettingsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    get() {
        return this.svc.get();
    }
    put(ctx, b) {
        return this.svc.put(ctx, b);
    }
};
exports.PlatformSettingsController = PlatformSettingsController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], PlatformSettingsController.prototype, "get", null);
__decorate([
    (0, common_1.Put)(),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.platformSettingsSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], PlatformSettingsController.prototype, "put", null);
exports.PlatformSettingsController = PlatformSettingsController = __decorate([
    (0, common_1.Controller)('platform/settings'),
    (0, context_1.SuperAdminOnly)(),
    __metadata("design:paramtypes", [PlatformService])
], PlatformSettingsController);
/** Support contacts and help videos, for every logged-in user. */
let SupportController = class SupportController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    async get() {
        const s = await this.svc.get();
        return { supportPhone: s.supportPhone, supportEmail: s.supportEmail, supportHours: s.supportHours, helpVideos: s.helpVideos };
    }
};
exports.SupportController = SupportController;
__decorate([
    (0, common_1.Get)(),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], SupportController.prototype, "get", null);
exports.SupportController = SupportController = __decorate([
    (0, common_1.Controller)('support'),
    (0, context_1.AnyUser)(),
    __metadata("design:paramtypes", [PlatformService])
], SupportController);
/** The business's plan and how to renew it. Only the owner (Tenant Admin) sees it; renewal is paid by UPI and confirmed by hand. */
let PlanController = class PlanController {
    svc;
    prisma;
    constructor(svc, prisma) {
        this.svc = svc;
        this.prisma = prisma;
    }
    async get(ctx) {
        if (ctx.role !== 'TENANT_ADMIN')
            throw (0, errors_1.forbidden)('Only the business owner can see the plan');
        const [t, s] = await Promise.all([this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }), this.svc.get()]);
        const daysLeft = t.planExpiresOn ? (0, shared_1.diffDays)(t.planExpiresOn, (0, shared_1.todayIST)()) : null;
        return {
            plan: t.plan,
            planExpiresOn: t.planExpiresOn,
            daysLeft,
            expiringSoon: daysLeft !== null && daysLeft < 15,
            yearlyPrice: s.yearlyPrice,
            upiId: s.upiId,
            upiName: s.upiName,
            upiLink: s.upiId ? (0, shared_1.upiPayLink)({ upiId: s.upiId, name: s.upiName, amount: s.yearlyPrice, note: `SmartFinora renewal ${t.name}` }) : null,
            supportPhone: s.supportPhone,
            supportEmail: s.supportEmail,
        };
    }
};
exports.PlanController = PlanController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], PlanController.prototype, "get", null);
exports.PlanController = PlanController = __decorate([
    (0, common_1.Controller)('plan'),
    __metadata("design:paramtypes", [PlatformService,
        prisma_service_1.PrismaService])
], PlanController);
//# sourceMappingURL=platform.js.map