import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { tenantSettingsSchema, type Permission, type RoleCode } from '@localfinance/shared';
import { PERMS_KEY, PUBLIC_KEY, SUPER_KEY, type Ctx } from './context';
import { forbidden } from './errors';
import { PrismaService } from './prisma.service';
import { ALL_BRANCH_ROLES } from './scope';

export interface JwtPayload {
  sub: string;
  tid: string | null;
  ver: number;
}

/**
 * Global guard: verifies the access token, loads the user fresh (so deactivation, force logout and role
 * changes apply at once), builds the request context, and enforces @Perm / @SuperAdminOnly and tenant status.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ec: ExecutionContext): Promise<boolean> {
    const targets = [ec.getHandler(), ec.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ec.switchToHttp().getRequest();
    const header: string | undefined = req.headers.authorization;
    // A token in the URL is accepted only for opening a file (image or PDF links), never for other calls.
    const fileGet = req.method === 'GET' && String(req.path ?? req.url ?? '').startsWith('/files/');
    const token = header?.startsWith('Bearer ') ? header.slice(7) : fileGet ? (req.query?.access_token as string | undefined) : undefined;
    if (!token) throw new UnauthorizedException({ message: 'Please log in', code: 'auth.login' });

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
    }
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: true, branches: true, tenant: true },
    });
    if (!user || !user.active || user.tokenVersion !== payload.ver) {
      throw new UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
    }

    const role = user.role.baseRole as RoleCode;
    let tenant = user.tenant;
    let readOnly = false;
    // Super Admin may open a tenant read-only while that tenant has granted support access.
    if (role === 'SUPER_ADMIN') {
      const tid = req.headers['x-tenant-id'] as string | undefined;
      if (tid) {
        const t = await this.prisma.tenant.findUnique({ where: { id: tid } });
        if (!t || !t.supportAccessUntil || t.supportAccessUntil < new Date()) {
          throw forbidden('This business has not granted support access');
        }
        tenant = t;
        readOnly = true;
      }
    }

    const perms = new Set(user.role.permissions as Permission[]);
    if (role === 'SUPER_ADMIN' && tenant) {
      ['customer.view', 'report.view', 'daybook.view', 'pl.view', 'audit.view'].forEach((p) => perms.add(p as Permission));
    }
    const ctx: Ctx = {
      userId: user.id,
      tenantId: tenant?.id ?? '',
      role,
      permissions: perms,
      branchIds: ALL_BRANCH_ROLES.has(role) ? null : user.branches.map((b) => b.branchId),
      approvalLimit: user.approvalLimit,
      settings: tenantSettingsSchema.parse(tenant?.settings ?? {}),
      tenantName: tenant?.name ?? 'Platform',
      tenantStatus: tenant?.status ?? 'ACTIVE',
      readOnly,
      ip: req.ip,
      device: req.headers['x-device-id'] as string | undefined,
    };
    req.ctx = ctx;

    const superOnly = this.reflector.getAllAndOverride<boolean>(SUPER_KEY, targets);
    if (superOnly && role !== 'SUPER_ADMIN') throw forbidden();
    if (!superOnly && role === 'SUPER_ADMIN' && !tenant && !this.reflector.getAllAndOverride<boolean>('anyUser', targets)) {
      throw forbidden('Open a business with support access first');
    }

    if (tenant && tenant.status === 'CLOSED' && role !== 'SUPER_ADMIN') throw forbidden('This business is closed');
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    if (isWrite && readOnly) throw forbidden('Support access is read only');
    if (isWrite && tenant && tenant.status !== 'ACTIVE' && role !== 'SUPER_ADMIN') {
      throw forbidden('This business is suspended; changes are not allowed', 'errors.tenantSuspended');
    }

    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMS_KEY, targets);
    if (needed?.length && !needed.some((p) => perms.has(p))) throw forbidden();
    return true;
  }
}
