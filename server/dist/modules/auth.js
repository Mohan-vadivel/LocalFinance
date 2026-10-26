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
exports.AuthController = exports.AuthService = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const bcrypt = __importStar(require("bcryptjs"));
const crypto_1 = require("crypto");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const zod_pipe_1 = require("../common/zod.pipe");
const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 30;
const sha = (s) => (0, crypto_1.createHash)('sha256').update(s).digest('hex');
let AuthService = class AuthService {
    prisma;
    jwt;
    audit;
    constructor(prisma, jwt, audit) {
        this.prisma = prisma;
        this.jwt = jwt;
        this.audit = audit;
    }
    async login(input, ip) {
        const login = input.login.trim().toLowerCase();
        const candidates = await this.prisma.user.findMany({
            where: { OR: [{ phone: input.login.trim() }, { email: login }], active: true },
            include: { tenant: true, role: true },
        });
        if (!candidates.length)
            throw new common_1.UnauthorizedException({ message: 'Wrong phone, email or password', code: 'auth.invalid' });
        // Same phone may work for several businesses: ask which one.
        const matching = [];
        for (const u of candidates) {
            if (u.lockedUntil && u.lockedUntil > new Date())
                continue;
            if (await bcrypt.compare(input.password, u.passwordHash))
                matching.push(u);
        }
        if (!matching.length) {
            for (const u of candidates) {
                const fails = u.failedLogins + 1;
                await this.prisma.user.update({
                    where: { id: u.id },
                    data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
                });
            }
            const locked = candidates.every((u) => u.lockedUntil && u.lockedUntil > new Date()) || candidates.some((u) => u.failedLogins + 1 >= MAX_FAILS);
            throw new common_1.UnauthorizedException(locked
                ? { message: 'Account locked after too many attempts. Ask your manager.', code: 'auth.locked' }
                : { message: 'Wrong phone, email or password', code: 'auth.invalid' });
        }
        let user = matching[0];
        if (matching.length > 1) {
            const chosen = input.tenantId ? matching.find((u) => u.tenantId === input.tenantId) : undefined;
            if (!chosen) {
                return { chooseTenant: matching.map((u) => ({ tenantId: u.tenantId, name: u.tenant?.name ?? 'Platform' })) };
            }
            user = chosen;
        }
        return this.admit(user, input.deviceId, ip, 'LOGIN');
    }
    /** The last checks shared by login and switching business: closed business, phone binding; then fresh tokens. */
    async admit(user, deviceId, ip, action) {
        if (user.tenant && user.tenant.status === 'CLOSED')
            throw (0, errors_1.forbidden)('This business is closed');
        // Field staff are bound to one phone.
        if (deviceId && user.role.baseRole === 'COLLECTION_AGENT') {
            if (!user.deviceId) {
                await this.prisma.user.update({ where: { id: user.id }, data: { deviceId } });
            }
            else if (user.deviceId !== deviceId) {
                throw (0, errors_1.forbidden)('This phone is not registered for your account. Ask your manager to re-bind it.', 'auth.deviceNotAllowed');
            }
        }
        await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
        await this.audit.log({ tenantId: user.tenantId ?? '', userId: user.id, ip, device: deviceId }, action, 'User', user.id);
        return this.issue(user.id, user.tenantId, user.tokenVersion);
    }
    /**
     * Other businesses where an active account has the caller's own phone number. Built only from the caller's own
     * user row (never from a phone sent by the client), so it shows nothing about a business the person has no account in.
     */
    async otherAccounts(userId) {
        const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { phone: true, tenantId: true } });
        if (!me?.phone || !me.tenantId)
            return [];
        return this.prisma.user.findMany({
            where: { phone: me.phone, active: true, tenantId: { not: null, notIn: [me.tenantId] }, tenant: { status: { not: 'CLOSED' } } },
            include: { tenant: true, role: true },
            orderBy: { tenant: { name: 'asc' } },
        });
    }
    async businesses(ctx) {
        // A Super Admin under support access has no account of their own in the business being viewed.
        if (ctx.role === 'SUPER_ADMIN')
            return [];
        return (await this.otherAccounts(ctx.userId)).map((u) => ({ tenantId: u.tenantId, name: u.tenant.name }));
    }
    /**
     * Moves this phone to the caller's account in another business. Accounts are separate, so that account's own
     * password is checked (with the same lock-out as login). An unknown business and a wrong password give the same
     * answer, so nothing is learnt about businesses the caller has no account in.
     */
    async switchTenant(ctx, input, ip) {
        const invalid = () => new common_1.UnauthorizedException({ message: 'Wrong password', code: 'auth.invalid' });
        if (ctx.role === 'SUPER_ADMIN')
            throw invalid();
        const target = (await this.otherAccounts(ctx.userId)).find((u) => u.tenantId === input.tenantId);
        if (!target)
            throw invalid();
        if (target.lockedUntil && target.lockedUntil > new Date())
            throw new common_1.UnauthorizedException({ message: 'Account locked after too many attempts. Ask your manager.', code: 'auth.locked' });
        if (!(await bcrypt.compare(input.password, target.passwordHash))) {
            const fails = target.failedLogins + 1;
            await this.prisma.user.update({ where: { id: target.id }, data: { failedLogins: fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null } });
            throw fails >= MAX_FAILS ? new common_1.UnauthorizedException({ message: 'Account locked after too many attempts. Ask your manager.', code: 'auth.locked' }) : invalid();
        }
        await this.audit.log(ctx, 'SWITCH_BUSINESS', 'User', ctx.userId);
        return this.admit(target, input.deviceId ?? ctx.device, ip, 'LOGIN');
    }
    async issue(userId, tenantId, ver) {
        const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, ver });
        const refreshToken = (0, crypto_1.randomBytes)(32).toString('hex');
        await this.prisma.refreshToken.create({
            data: { userId, tokenHash: sha(refreshToken), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000) },
        });
        return { accessToken, refreshToken, profile: await this.profile(userId) };
    }
    async refresh(token) {
        const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha(token) } });
        if (!row || row.revoked || row.expiresAt < new Date())
            throw new common_1.UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
        const user = await this.prisma.user.findUnique({ where: { id: row.userId }, include: { tenant: true } });
        if (!user || !user.active || user.tenant?.status === 'CLOSED')
            throw new common_1.UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
        await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } });
        return this.issue(user.id, user.tenantId, user.tokenVersion);
    }
    async logout(token) {
        await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha(token) }, data: { revoked: true } });
        return { ok: true };
    }
    async profile(userId) {
        const u = await this.prisma.user.findUniqueOrThrow({
            where: { id: userId },
            include: { role: true, tenant: true, branches: { include: { branch: true } } },
        });
        return {
            id: u.id,
            name: u.name,
            phone: u.phone,
            email: u.email,
            language: u.language,
            role: u.role.baseRole,
            roleName: u.role.name,
            permissions: u.role.permissions,
            approvalLimit: u.approvalLimit,
            branches: u.branches.map((b) => ({ id: b.branch.id, name: b.branch.name, code: b.branch.code })),
            tenant: u.tenant
                ? { id: u.tenant.id, name: u.tenant.name, status: u.tenant.status, logoUrl: u.tenant.logoUrl, settings: shared_1.tenantSettingsSchema.parse(u.tenant.settings ?? {}) }
                : null,
        };
    }
    async changePassword(ctx, input) {
        const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
        if (!(await bcrypt.compare(input.currentPassword, u.passwordHash)))
            throw (0, errors_1.bad)('Current password is wrong', 'auth.invalid');
        await this.prisma.user.update({
            where: { id: u.id },
            data: { passwordHash: await bcrypt.hash(input.newPassword, 10), tokenVersion: { increment: 1 } },
        });
        await this.prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revoked: true } });
        await this.audit.log(ctx, 'CHANGE_PASSWORD', 'User', u.id);
        return { ok: true };
    }
};
exports.AuthService = AuthService;
exports.AuthService = AuthService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        audit_service_1.AuditService])
], AuthService);
const refreshSchema = zod_1.z.object({ refreshToken: zod_1.z.string().min(10) });
const languageSchema = zod_1.z.object({ language: zod_1.z.string().min(2).max(10) });
const locationPingSchema = zod_1.z.object({ lat: zod_1.z.number(), lng: zod_1.z.number() });
let AuthController = class AuthController {
    auth;
    prisma;
    constructor(auth, prisma) {
        this.auth = auth;
        this.prisma = prisma;
    }
    login(body, req) {
        return this.auth.login(body, req.ip);
    }
    refresh(body) {
        return this.auth.refresh(body.refreshToken);
    }
    logout(body) {
        return this.auth.logout(body.refreshToken);
    }
    async me(ctx) {
        const p = await this.auth.profile(ctx.userId);
        // A Super Admin viewing a business under support access sees it read-only, with the view rights the guard gave.
        if (ctx.role === 'SUPER_ADMIN' && ctx.tenantId) {
            return {
                ...p,
                permissions: [...ctx.permissions],
                readOnly: true,
                tenant: { id: ctx.tenantId, name: ctx.tenantName, status: ctx.tenantStatus, logoUrl: null, settings: ctx.settings },
            };
        }
        return { ...p, readOnly: ctx.readOnly };
    }
    /** The caller's other businesses (same phone number, active account), for "Switch business". */
    businesses(ctx) {
        return this.auth.businesses(ctx);
    }
    switchTenant(ctx, body, req) {
        return this.auth.switchTenant(ctx, body, req.ip);
    }
    password(ctx, body) {
        return this.auth.changePassword(ctx, body);
    }
    async language(ctx, body) {
        await this.prisma.user.update({ where: { id: ctx.userId }, data: { language: body.language } });
        return { ok: true };
    }
    /** Mobile app reports the agent's position so managers can see live progress. */
    async ping(ctx, body) {
        await this.prisma.user.update({ where: { id: ctx.userId }, data: { lastLat: body.lat, lastLng: body.lng, lastSeenAt: new Date() } });
        return { ok: true };
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, context_1.Public)(),
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.loginSchema))),
    __param(1, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "login", null);
__decorate([
    (0, context_1.Public)(),
    (0, common_1.Post)('refresh'),
    __param(0, (0, common_1.Body)((0, zod_pipe_1.V)(refreshSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "refresh", null);
__decorate([
    (0, context_1.Public)(),
    (0, common_1.Post)('logout'),
    __param(0, (0, common_1.Body)((0, zod_pipe_1.V)(refreshSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [void 0]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "logout", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Get)('me'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Get)('businesses'),
    __param(0, (0, context_1.CurrentCtx)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "businesses", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Post)('switch'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.switchTenantSchema))),
    __param(2, (0, common_1.Req)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0, Object]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "switchTenant", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Post)('password'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.changePasswordSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], AuthController.prototype, "password", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Post)('language'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(languageSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "language", null);
__decorate([
    (0, context_1.AnyUser)(),
    (0, common_1.Post)('ping'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(locationPingSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "ping", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [AuthService,
        prisma_service_1.PrismaService])
], AuthController);
//# sourceMappingURL=auth.js.map