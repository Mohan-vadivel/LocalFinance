import { Body, Controller, Get, Injectable, Post, Req, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { changePasswordSchema, loginSchema, tenantSettingsSchema } from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AnyUser, CurrentCtx, Public, type Ctx } from '../common/context';
import { bad, forbidden } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { V } from '../common/zod.pipe';

const MAX_FAILS = 5;
const LOCK_MINUTES = 15;
const REFRESH_DAYS = 30;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
  ) {}

  async login(input: z.infer<typeof loginSchema>, ip?: string) {
    const login = input.login.trim().toLowerCase();
    const candidates = await this.prisma.user.findMany({
      where: { OR: [{ phone: input.login.trim() }, { email: login }], active: true },
      include: { tenant: true, role: true },
    });
    if (!candidates.length) throw new UnauthorizedException({ message: 'Wrong phone, email or password', code: 'auth.invalid' });

    // Same phone may work for several businesses: ask which one.
    const matching: typeof candidates = [];
    for (const u of candidates) {
      if (u.lockedUntil && u.lockedUntil > new Date()) continue;
      if (await bcrypt.compare(input.password, u.passwordHash)) matching.push(u);
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
      throw new UnauthorizedException(
        locked
          ? { message: 'Account locked after too many attempts. Ask your manager.', code: 'auth.locked' }
          : { message: 'Wrong phone, email or password', code: 'auth.invalid' },
      );
    }
    let user = matching[0];
    if (matching.length > 1) {
      const chosen = input.tenantId ? matching.find((u) => u.tenantId === input.tenantId) : undefined;
      if (!chosen) {
        return { chooseTenant: matching.map((u) => ({ tenantId: u.tenantId, name: u.tenant?.name ?? 'Platform' })) };
      }
      user = chosen;
    }
    if (user.tenant && user.tenant.status === 'CLOSED') throw forbidden('This business is closed');

    // Field staff are bound to one phone.
    if (input.deviceId && user.role.baseRole === 'COLLECTION_AGENT') {
      if (!user.deviceId) {
        await this.prisma.user.update({ where: { id: user.id }, data: { deviceId: input.deviceId } });
      } else if (user.deviceId !== input.deviceId) {
        throw forbidden('This phone is not registered for your account. Ask your manager to re-bind it.', 'auth.deviceNotAllowed');
      }
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null } });
    await this.audit.log({ tenantId: user.tenantId ?? '', userId: user.id, ip, device: input.deviceId }, 'LOGIN', 'User', user.id);
    return this.issue(user.id, user.tenantId, user.tokenVersion);
  }

  private async issue(userId: string, tenantId: string | null, ver: number) {
    const accessToken = await this.jwt.signAsync({ sub: userId, tid: tenantId, ver });
    const refreshToken = randomBytes(32).toString('hex');
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: sha(refreshToken), expiresAt: new Date(Date.now() + REFRESH_DAYS * 86_400_000) },
    });
    return { accessToken, refreshToken, profile: await this.profile(userId) };
  }

  async refresh(token: string) {
    const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha(token) } });
    if (!row || row.revoked || row.expiresAt < new Date()) throw new UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
    const user = await this.prisma.user.findUnique({ where: { id: row.userId } });
    if (!user || !user.active) throw new UnauthorizedException({ message: 'Session expired', code: 'auth.login' });
    await this.prisma.refreshToken.update({ where: { id: row.id }, data: { revoked: true } });
    return this.issue(user.id, user.tenantId, user.tokenVersion);
  }

  async logout(token: string) {
    await this.prisma.refreshToken.updateMany({ where: { tokenHash: sha(token) }, data: { revoked: true } });
    return { ok: true };
  }

  async profile(userId: string) {
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
        ? { id: u.tenant.id, name: u.tenant.name, status: u.tenant.status, logoUrl: u.tenant.logoUrl, settings: tenantSettingsSchema.parse(u.tenant.settings ?? {}) }
        : null,
    };
  }

  async changePassword(ctx: Ctx, input: z.infer<typeof changePasswordSchema>) {
    const u = await this.prisma.user.findUniqueOrThrow({ where: { id: ctx.userId } });
    if (!(await bcrypt.compare(input.currentPassword, u.passwordHash))) throw bad('Current password is wrong', 'auth.invalid');
    await this.prisma.user.update({
      where: { id: u.id },
      data: { passwordHash: await bcrypt.hash(input.newPassword, 10), tokenVersion: { increment: 1 } },
    });
    await this.prisma.refreshToken.updateMany({ where: { userId: u.id }, data: { revoked: true } });
    await this.audit.log(ctx, 'CHANGE_PASSWORD', 'User', u.id);
    return { ok: true };
  }
}

const refreshSchema = z.object({ refreshToken: z.string().min(10) });
const languageSchema = z.object({ language: z.string().min(2).max(10) });
const locationPingSchema = z.object({ lat: z.number(), lng: z.number() });

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @Post('login')
  login(@Body(V(loginSchema)) body: z.infer<typeof loginSchema>, @Req() req: { ip?: string }) {
    return this.auth.login(body, req.ip);
  }

  @Public()
  @Post('refresh')
  refresh(@Body(V(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Public()
  @Post('logout')
  logout(@Body(V(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.logout(body.refreshToken);
  }

  @AnyUser()
  @Get('me')
  async me(@CurrentCtx() ctx: Ctx) {
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

  @AnyUser()
  @Post('password')
  password(@CurrentCtx() ctx: Ctx, @Body(V(changePasswordSchema)) body: z.infer<typeof changePasswordSchema>) {
    return this.auth.changePassword(ctx, body);
  }

  @AnyUser()
  @Post('language')
  async language(@CurrentCtx() ctx: Ctx, @Body(V(languageSchema)) body: z.infer<typeof languageSchema>) {
    await this.prisma.user.update({ where: { id: ctx.userId }, data: { language: body.language } });
    return { ok: true };
  }

  /** Mobile app reports the agent's position so managers can see live progress. */
  @AnyUser()
  @Post('ping')
  async ping(@CurrentCtx() ctx: Ctx, @Body(V(locationPingSchema)) body: z.infer<typeof locationPingSchema>) {
    await this.prisma.user.update({ where: { id: ctx.userId }, data: { lastLat: body.lat, lastLng: body.lng, lastSeenAt: new Date() } });
    return { ok: true };
  }
}
