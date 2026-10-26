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
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthGuard = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const jwt_1 = require("@nestjs/jwt");
const shared_1 = require("@localfinance/shared");
const context_1 = require("./context");
const errors_1 = require("./errors");
const prisma_service_1 = require("./prisma.service");
const scope_1 = require("./scope");
/**
 * Global guard: verifies the access token, loads the user fresh (so deactivation, force logout and role
 * changes apply at once), builds the request context, and enforces @Perm / @SuperAdminOnly and tenant status.
 */
let AuthGuard = class AuthGuard {
    reflector;
    jwt;
    prisma;
    constructor(reflector, jwt, prisma) {
        this.reflector = reflector;
        this.jwt = jwt;
        this.prisma = prisma;
    }
    async canActivate(ec) {
        const targets = [ec.getHandler(), ec.getClass()];
        if (this.reflector.getAllAndOverride(context_1.PUBLIC_KEY, targets))
            return true;
        const req = ec.switchToHttp().getRequest();
        const header = req.headers.authorization;
        // A token in the URL is accepted only for opening a file (image or PDF links), never for other calls.
        const fileGet = req.method === 'GET' && String(req.path ?? req.url ?? '').startsWith('/files/');
        const token = header?.startsWith('Bearer ') ? header.slice(7) : fileGet ? req.query?.access_token : undefined;
        if (!token)
            throw new common_1.UnauthorizedException({ message: 'Please log in', code: 'auth.login' });
        let payload;
        try {
            payload = await this.jwt.verifyAsync(token);
        }
        catch {
            throw new common_1.UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
        }
        const user = await this.prisma.user.findUnique({
            where: { id: payload.sub },
            include: { role: true, branches: true, tenant: true },
        });
        if (!user || !user.active || user.tokenVersion !== payload.ver) {
            throw new common_1.UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
        }
        const role = user.role.baseRole;
        let tenant = user.tenant;
        let readOnly = false;
        // Super Admin may open a tenant read-only while that tenant has granted support access.
        if (role === 'SUPER_ADMIN') {
            const tid = req.headers['x-tenant-id'];
            if (tid) {
                const t = await this.prisma.tenant.findUnique({ where: { id: tid } });
                if (!t || !t.supportAccessUntil || t.supportAccessUntil < new Date()) {
                    throw (0, errors_1.forbidden)('This business has not granted support access');
                }
                tenant = t;
                readOnly = true;
            }
        }
        const perms = new Set(user.role.permissions);
        if (role === 'SUPER_ADMIN' && tenant) {
            ['customer.view', 'report.view', 'daybook.view', 'pl.view', 'audit.view'].forEach((p) => perms.add(p));
        }
        const ctx = {
            userId: user.id,
            tenantId: tenant?.id ?? '',
            role,
            permissions: perms,
            branchIds: scope_1.ALL_BRANCH_ROLES.has(role) ? null : user.branches.map((b) => b.branchId),
            approvalLimit: user.approvalLimit,
            settings: shared_1.tenantSettingsSchema.parse(tenant?.settings ?? {}),
            tenantName: tenant?.name ?? 'Platform',
            tenantStatus: tenant?.status ?? 'ACTIVE',
            readOnly,
            ip: req.ip,
            device: req.headers['x-device-id'],
        };
        req.ctx = ctx;
        const superOnly = this.reflector.getAllAndOverride(context_1.SUPER_KEY, targets);
        if (superOnly && role !== 'SUPER_ADMIN')
            throw (0, errors_1.forbidden)();
        if (!superOnly && role === 'SUPER_ADMIN' && !tenant && !this.reflector.getAllAndOverride('anyUser', targets)) {
            throw (0, errors_1.forbidden)('Open a business with support access first');
        }
        if (tenant && tenant.status === 'CLOSED' && role !== 'SUPER_ADMIN')
            throw (0, errors_1.forbidden)('This business is closed');
        const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        if (isWrite && readOnly)
            throw (0, errors_1.forbidden)('Support access is read only');
        if (isWrite && tenant && tenant.status !== 'ACTIVE' && role !== 'SUPER_ADMIN') {
            throw (0, errors_1.forbidden)('This business is suspended; changes are not allowed', 'errors.tenantSuspended');
        }
        const needed = this.reflector.getAllAndOverride(context_1.PERMS_KEY, targets);
        if (needed?.length && !needed.some((p) => perms.has(p)))
            throw (0, errors_1.forbidden)();
        return true;
    }
};
exports.AuthGuard = AuthGuard;
exports.AuthGuard = AuthGuard = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.Reflector,
        jwt_1.JwtService,
        prisma_service_1.PrismaService])
], AuthGuard);
//# sourceMappingURL=auth.guard.js.map