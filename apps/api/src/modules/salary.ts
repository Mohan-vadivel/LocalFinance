import { Body, Controller, Get, Injectable, Param, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatINR, salaryAdvanceSchema, salaryPaySchema, salaryRateSchema, todayIST } from '@localfinance/shared';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { BooksService } from '../common/books.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, forbidden, notFound } from '../common/errors';
import { PrismaService, type Tx } from '../common/prisma.service';
import { assertBranch, assertOwned, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

/** Salary lines go to the day book under this expense category, so profit and loss counts them. */
const SALARY_CATEGORY = 'Salary';

/**
 * Staff salaries: a monthly amount per person, advances paid ahead of it, and each month's payment net of the
 * advances taken back. Every rupee paid out is a day book line. Never open to collection agents.
 */
@Injectable()
export class SalaryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly books: BooksService,
    private readonly audit: AuditService,
  ) {}

  private check(ctx: Ctx) {
    // A custom role could be given the right by mistake; agents never handle salaries.
    if (ctx.role === 'COLLECTION_AGENT') throw forbidden();
  }

  /** Staff of this business the caller may see: everyone for all-branch roles, else staff of their branches. */
  private staffWhere(ctx: Ctx): Prisma.UserWhereInput {
    return { tenantId: ctx.tenantId, ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) };
  }

  private async staff(ctx: Ctx, userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, ...this.staffWhere(ctx) }, select: { id: true, name: true } });
    if (!u) throw notFound('Staff');
    return u;
  }

  private async category(tx: Tx, tenantId: string) {
    const c = await tx.expenseCategory.findFirst({ where: { tenantId, name: SALARY_CATEGORY } });
    return c ?? tx.expenseCategory.create({ data: { tenantId, name: SALARY_CATEGORY, kind: 'EXPENSE' } });
  }

  /** Advances given less advances taken back, per person. */
  private async outstanding(db: Tx, ctx: Ctx, userIds: string[]) {
    const scope = branchScope(ctx);
    const [adv, ded] = await Promise.all([
      db.salaryAdvance.groupBy({ by: ['userId'], where: { ...scope, userId: { in: userIds } }, _sum: { amount: true } }),
      db.salaryPayment.groupBy({ by: ['userId'], where: { ...scope, userId: { in: userIds } }, _sum: { advanceDeducted: true } }),
    ]);
    return new Map(userIds.map((id) => [id, (adv.find((a) => a.userId === id)?._sum.amount ?? 0) - (ded.find((d) => d.userId === id)?._sum.advanceDeducted ?? 0)]));
  }

  /** One month: each staff member's salary, whether it is paid, and advances outstanding. */
  async month(ctx: Ctx, q: z.infer<typeof monthQuery>) {
    this.check(ctx);
    const month = q.month ?? todayIST().slice(0, 7);
    if (q.branchId) assertBranch(ctx, q.branchId);
    const users = await this.prisma.user.findMany({
      where: { ...this.staffWhere(ctx), ...(q.branchId ? { AND: [{ branches: { some: { branchId: q.branchId } } }] } : {}) },
      select: { id: true, name: true, phone: true, active: true, role: { select: { name: true, baseRole: true } }, branches: { select: { branchId: true, branch: { select: { name: true } } } } },
      orderBy: { name: 'asc' },
    });
    const ids = users.map((u) => u.id);
    const [rates, payments, given, outstanding] = await Promise.all([
      this.prisma.staffSalary.findMany({ where: { tenantId: ctx.tenantId, userId: { in: ids } } }),
      this.prisma.salaryPayment.findMany({ where: { ...branchScope(ctx), month, userId: { in: ids } } }),
      this.prisma.salaryAdvance.groupBy({ by: ['userId'], where: { ...branchScope(ctx), userId: { in: ids }, date: { startsWith: month } }, _sum: { amount: true } }),
      this.outstanding(this.prisma, ctx, ids),
    ]);
    const rows = users
      .map((u) => {
        const salary = rates.find((r) => r.userId === u.id)?.amount ?? 0;
        const payment = payments.find((p) => p.userId === u.id) ?? null;
        const advance = outstanding.get(u.id) ?? 0;
        return {
          userId: u.id,
          name: u.name,
          phone: u.phone,
          active: u.active,
          roleName: u.role.name,
          baseRole: u.role.baseRole,
          branchIds: u.branches.map((b) => b.branchId),
          branches: u.branches.map((b) => b.branch.name).join(', '),
          salary,
          advancesThisMonth: given.find((g) => g.userId === u.id)?._sum.amount ?? 0,
          advanceOutstanding: advance,
          // What paying now would hand over, taking back all outstanding advances up to the salary.
          netDue: payment ? 0 : Math.max(0, salary - Math.min(advance, salary)),
          status: payment ? 'PAID' : salary > 0 ? 'UNPAID' : 'NO_SALARY',
          payment,
        };
      })
      .filter((r) => r.active || r.payment || r.advanceOutstanding > 0);
    return {
      month,
      rows,
      totals: {
        salary: rows.reduce((s, r) => s + r.salary, 0),
        paid: rows.reduce((s, r) => s + (r.payment?.net ?? 0), 0),
        unpaid: rows.filter((r) => r.status === 'UNPAID').reduce((s, r) => s + r.netDue, 0),
        advanceOutstanding: rows.reduce((s, r) => s + r.advanceOutstanding, 0),
      },
    };
  }

  /** A person's advances and salary payments, newest first. */
  async history(ctx: Ctx, userId: string) {
    this.check(ctx);
    const u = await this.staff(ctx, userId);
    const [advances, payments, outstanding] = await Promise.all([
      this.prisma.salaryAdvance.findMany({ where: { ...branchScope(ctx), userId }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
      this.prisma.salaryPayment.findMany({ where: { ...branchScope(ctx), userId }, orderBy: { month: 'desc' } }),
      this.outstanding(this.prisma, ctx, [userId]),
    ]);
    return { userId, name: u.name, advanceOutstanding: outstanding.get(userId) ?? 0, advances, payments };
  }

  async setRate(ctx: Ctx, userId: string, input: z.infer<typeof salaryRateSchema>) {
    this.check(ctx);
    await this.staff(ctx, userId);
    const before = await this.prisma.staffSalary.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId } } });
    const r = await this.prisma.staffSalary.upsert({
      where: { tenantId_userId: { tenantId: ctx.tenantId, userId } },
      create: { tenantId: ctx.tenantId, userId, amount: input.amount },
      update: { amount: input.amount },
    });
    await this.audit.log(ctx, 'SET_SALARY', 'StaffSalary', r.id, before ? { amount: before.amount } : undefined, { userId, amount: input.amount });
    return r;
  }

  private async branchAndDate(ctx: Ctx, branchId: string, date: string) {
    assertBranch(ctx, branchId);
    await assertOwned(this.prisma.branch, ctx, branchId, 'Branch');
    if (date > todayIST()) throw bad('Entries cannot be in the future');
  }

  /** Money given ahead of salary, paid out through the day book at once. */
  async advance(ctx: Ctx, input: z.infer<typeof salaryAdvanceSchema>) {
    this.check(ctx);
    const u = await this.staff(ctx, input.userId);
    await this.branchAndDate(ctx, input.branchId, input.date);
    const a = await this.prisma.tx(async (tx) => {
      const cat = await this.category(tx, ctx.tenantId);
      const row = await tx.salaryAdvance.create({
        data: { tenantId: ctx.tenantId, branchId: input.branchId, userId: u.id, date: input.date, amount: input.amount, mode: input.mode, note: input.note ?? null, createdById: ctx.userId },
      });
      const e = await this.books.daybook(tx, {
        tenantId: ctx.tenantId,
        branchId: input.branchId,
        date: input.date,
        direction: 'OUT',
        amount: input.amount,
        mode: input.mode,
        particulars: `Salary advance to ${u.name}${input.note ? `: ${input.note}` : ''}`,
        categoryId: cat.id,
        source: 'MANUAL',
        refType: 'SalaryAdvance',
        refId: row.id,
        userId: ctx.userId,
      });
      return tx.salaryAdvance.update({ where: { id: row.id }, data: { daybookEntryId: e?.id ?? null } });
    });
    await this.audit.log(ctx, 'SALARY_ADVANCE', 'SalaryAdvance', a.id, undefined, input);
    return a;
  }

  /**
   * Pays one month's salary. Outstanding advances are taken back from it (all of them, up to the salary, unless a
   * smaller amount is given) and only the rest is paid out through the day book. A month is paid once.
   */
  async pay(ctx: Ctx, input: z.infer<typeof salaryPaySchema>) {
    this.check(ctx);
    const u = await this.staff(ctx, input.userId);
    await this.branchAndDate(ctx, input.branchId, input.date);
    if (input.month > todayIST().slice(0, 7)) throw bad('This month has not started yet');
    const rate = await this.prisma.staffSalary.findUnique({ where: { tenantId_userId: { tenantId: ctx.tenantId, userId: u.id } } });
    if (!rate?.amount) throw bad('Set a monthly salary for this person first');
    const gross = rate.amount;
    try {
      const p = await this.prisma.tx(async (tx) => {
        if (await tx.salaryPayment.findFirst({ where: { tenantId: ctx.tenantId, userId: u.id, month: input.month } })) throw conflict('This month is already paid');
        const outstanding = (await this.outstanding(tx, ctx, [u.id])).get(u.id) ?? 0;
        const deduct = input.advanceDeduct ?? Math.min(outstanding, gross);
        if (deduct > outstanding) throw bad('That is more than the advances outstanding');
        if (deduct > gross) throw bad('That is more than the salary');
        const cat = await this.category(tx, ctx.tenantId);
        const row = await tx.salaryPayment.create({
          data: {
            tenantId: ctx.tenantId,
            branchId: input.branchId,
            userId: u.id,
            month: input.month,
            date: input.date,
            gross,
            advanceDeducted: deduct,
            net: gross - deduct,
            mode: input.mode,
            note: input.note ?? null,
            createdById: ctx.userId,
          },
        });
        // Nothing is posted when advances cover the whole salary: that money left the day book as the advance.
        const e = await this.books.daybook(tx, {
          tenantId: ctx.tenantId,
          branchId: input.branchId,
          date: input.date,
          direction: 'OUT',
          amount: gross - deduct,
          mode: input.mode,
          particulars: `Salary ${input.month} to ${u.name}${deduct ? ` (advance ${formatINR(deduct)} taken back)` : ''}`,
          categoryId: cat.id,
          source: 'MANUAL',
          refType: 'SalaryPayment',
          refId: row.id,
          userId: ctx.userId,
        });
        return tx.salaryPayment.update({ where: { id: row.id }, data: { daybookEntryId: e?.id ?? null } });
      });
      await this.audit.log(ctx, 'PAY_SALARY', 'SalaryPayment', p.id, undefined, { ...input, gross, advanceDeducted: p.advanceDeducted, net: p.net });
      return p;
    } catch (e) {
      // Two people paying the same month at once: the unique key stops the second.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('This month is already paid');
      throw e;
    }
  }
}

const monthQuery = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), branchId: z.string().optional() });

@Controller('salaries')
@Perm('salary.manage')
export class SalaryController {
  constructor(private readonly svc: SalaryService) {}
  @Get() month(@CurrentCtx() ctx: Ctx, @Query(V(monthQuery)) q: z.infer<typeof monthQuery>) {
    return this.svc.month(ctx, q);
  }
  @Get('staff/:userId') history(@CurrentCtx() ctx: Ctx, @Param('userId') userId: string) {
    return this.svc.history(ctx, userId);
  }
  @Put('staff/:userId') setRate(@CurrentCtx() ctx: Ctx, @Param('userId') userId: string, @Body(V(salaryRateSchema)) b: z.infer<typeof salaryRateSchema>) {
    return this.svc.setRate(ctx, userId, b);
  }
  @Post('advances') advance(@CurrentCtx() ctx: Ctx, @Body(V(salaryAdvanceSchema)) b: z.infer<typeof salaryAdvanceSchema>) {
    return this.svc.advance(ctx, b);
  }
  @Post('payments') pay(@CurrentCtx() ctx: Ctx, @Body(V(salaryPaySchema)) b: z.infer<typeof salaryPaySchema>) {
    return this.svc.pay(ctx, b);
  }
}
