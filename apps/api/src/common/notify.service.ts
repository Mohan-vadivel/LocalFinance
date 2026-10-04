import { Injectable, Logger } from '@nestjs/common';
import { translate } from '@localfinance/shared';
import { PrismaService } from './prisma.service';

/**
 * Sends SMS through the configured provider. SMS_PROVIDER=log (default) only records the message in the
 * notifications table; SMS_PROVIDER=msg91 sends it through MSG91. Sending never blocks or fails the business
 * operation that triggered it.
 */
@Injectable()
export class NotifyService {
  private readonly log = new Logger('Notify');
  constructor(private readonly prisma: PrismaService) {}

  async sms(tenantId: string | null, to: string, language: string, key: string, vars: Record<string, string | number>, template?: string) {
    const body = template
      ? template.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] !== undefined ? String(vars[v]) : ''))
      : translate(language, key, vars);
    const n = await this.prisma.notification.create({ data: { tenantId, channel: 'SMS', to, body } });
    void this.deliver(n.id, to, body);
    return n;
  }

  private async deliver(id: string, to: string, body: string) {
    const provider = process.env.SMS_PROVIDER ?? 'log';
    try {
      if (provider === 'msg91' && process.env.MSG91_AUTH_KEY) {
        const res = await fetch('https://control.msg91.com/api/v5/flow/', {
          method: 'POST',
          headers: { authkey: process.env.MSG91_AUTH_KEY, 'content-type': 'application/json' },
          body: JSON.stringify({ sender: process.env.MSG91_SENDER, mobiles: to.replace(/\D/g, ''), message: body }),
        });
        if (!res.ok) throw new Error(`MSG91 ${res.status}`);
        await this.prisma.notification.update({ where: { id }, data: { status: 'SENT' } });
      } else {
        await this.prisma.notification.update({ where: { id }, data: { status: 'LOGGED' } });
      }
    } catch (e) {
      this.log.warn(`SMS ${id} failed: ${(e as Error).message}`);
      await this.prisma.notification.update({ where: { id }, data: { status: 'FAILED', error: (e as Error).message } }).catch(() => undefined);
    }
  }
}
