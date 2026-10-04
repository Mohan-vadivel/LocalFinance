import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Ctx } from './context';
import { PrismaService, type Tx } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  log(
    ctx: Pick<Ctx, 'tenantId' | 'userId' | 'ip' | 'device'> | null,
    action: string,
    entity: string,
    entityId?: string | null,
    before?: unknown,
    after?: unknown,
    tx?: Tx,
  ) {
    const db = tx ?? this.prisma;
    return db.auditLog.create({
      data: {
        tenantId: ctx?.tenantId || null,
        userId: ctx?.userId ?? null,
        action,
        entity,
        entityId: entityId ?? null,
        before: before === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(before)) as Prisma.InputJsonValue),
        after: after === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(after)) as Prisma.InputJsonValue),
        ip: ctx?.ip ?? null,
        device: ctx?.device ?? null,
      },
    });
  }
}
