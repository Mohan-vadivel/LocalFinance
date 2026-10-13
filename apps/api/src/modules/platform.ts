import { Body, Controller, Get, Injectable, Put } from '@nestjs/common';
import { diffDays, platformSettingsSchema, todayIST, upiPayLink, type HelpVideo, type PlatformSettings } from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { AnyUser, CurrentCtx, SuperAdminOnly, type Ctx } from '../common/context';
import { forbidden } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { V } from '../common/zod.pipe';

const ROW = 'platform';

/** The platform's own settings (support contacts, help videos, renewal by UPI): one row, edited by the Super Admin. */
@Injectable()
export class PlatformService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(): Promise<PlatformSettings> {
    const r = await this.prisma.platformSettings.findUnique({ where: { id: ROW } });
    return {
      supportPhone: r?.supportPhone ?? null,
      supportEmail: r?.supportEmail ?? null,
      supportHours: r?.supportHours ?? null,
      helpVideos: (r?.helpVideos as HelpVideo[] | undefined) ?? [],
      upiId: r?.upiId ?? null,
      upiName: r?.upiName ?? 'WITS',
      yearlyPrice: r?.yearlyPrice ?? 0,
    };
  }

  async put(ctx: Ctx, input: PlatformSettings) {
    const before = await this.get();
    await this.prisma.platformSettings.upsert({ where: { id: ROW }, create: { id: ROW, ...input }, update: input });
    await this.audit.log(ctx, 'UPDATE', 'PlatformSettings', ROW, before, input);
    return this.get();
  }
}

@Controller('platform/settings')
@SuperAdminOnly()
export class PlatformSettingsController {
  constructor(private readonly svc: PlatformService) {}
  @Get() get() {
    return this.svc.get();
  }
  @Put() put(@CurrentCtx() ctx: Ctx, @Body(V(platformSettingsSchema)) b: z.infer<typeof platformSettingsSchema>) {
    return this.svc.put(ctx, b);
  }
}

/** Support contacts and help videos, for every logged-in user. */
@Controller('support')
@AnyUser()
export class SupportController {
  constructor(private readonly svc: PlatformService) {}
  @Get() async get() {
    const s = await this.svc.get();
    return { supportPhone: s.supportPhone, supportEmail: s.supportEmail, supportHours: s.supportHours, helpVideos: s.helpVideos };
  }
}

/** The business's plan and how to renew it. Only the owner (Tenant Admin) sees it; renewal is paid by UPI and confirmed by hand. */
@Controller('plan')
export class PlanController {
  constructor(
    private readonly svc: PlatformService,
    private readonly prisma: PrismaService,
  ) {}
  @Get() async get(@CurrentCtx() ctx: Ctx) {
    if (ctx.role !== 'TENANT_ADMIN') throw forbidden('Only the business owner can see the plan');
    const [t, s] = await Promise.all([this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }), this.svc.get()]);
    const daysLeft = t.planExpiresOn ? diffDays(t.planExpiresOn, todayIST()) : null;
    return {
      plan: t.plan,
      planExpiresOn: t.planExpiresOn,
      daysLeft,
      expiringSoon: daysLeft !== null && daysLeft < 15,
      yearlyPrice: s.yearlyPrice,
      upiId: s.upiId,
      upiName: s.upiName,
      upiLink: s.upiId ? upiPayLink({ upiId: s.upiId, name: s.upiName, amount: s.yearlyPrice, note: `LocalFinance renewal ${t.name}` }) : null,
      supportPhone: s.supportPhone,
      supportEmail: s.supportEmail,
    };
  }
}
