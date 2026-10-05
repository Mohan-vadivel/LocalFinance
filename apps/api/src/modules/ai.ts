import { Body, Controller, Get, Injectable, Param, Post, Query } from '@nestjs/common';
import { addDays, formatINR, reportFilterSchema, todayIST, translate, weekday, type Permission, type ReportFilter } from '@localfinance/shared';
import { createHash } from 'crypto';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { positionOf } from '../common/books.service';
import { ClaudeService, type AiTool } from '../common/claude.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';
import { CustomersService } from './customers';
import { DashboardService, ProfitLossService, ReportsService } from './reports';

const LANG_NAMES: Record<string, string> = { en: 'English', ta: 'Tamil' };
const langName = (code: string) => LANG_NAMES[code] ?? 'English';
const rs = (paise: number) => formatINR(paise, { decimals: false });

export interface Alert {
  kind: 'agentDrop' | 'reversals' | 'dayReopened' | 'sharedPhone' | 'sharedId' | 'shortages' | 'flagged';
  severity: 'high' | 'medium';
  /** Numbers and names for the alert text. Money is in paise. */
  values: Record<string, string | number>;
  /** Customers behind a shared phone or ID, so staff can open them. */
  customers?: { id: string; code: string; name: string }[];
}

/** In-memory cache of briefing write-ups, keyed by business and a hash of the facts, so a reload costs nothing. */
const briefCache = new Map<string, { at: number; bullets: string[] }>();
const BRIEF_TTL_MS = 30 * 60_000;

@Injectable()
export class AiService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly claude: ClaudeService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly dashboard: DashboardService,
    private readonly pl: ProfitLossService,
    private readonly customers: CustomersService,
  ) {}

  status(ctx: Ctx) {
    return { configured: this.claude.configured(), enabled: this.claude.enabled(ctx), switchedOn: ctx.settings.aiEnabled === true };
  }

  // -------------------------------------------------------------------
  // Unusual activity (runs on our server; no data leaves it)
  // -------------------------------------------------------------------
  async alerts(ctx: Ctx, branchId?: string): Promise<Alert[]> {
    const today = todayIST();
    const yesterday = addDays(today, -1);
    const since7 = addDays(today, -7);
    const since15 = addDays(today, -15);
    const scope = branchScope(ctx, branchId);
    const out: Alert[] = [];
    const [daily, reversed, reopens, phones, ids, shortages, flagged] = await Promise.all([
      this.prisma.collection.groupBy({ by: ['agentId', 'date'], where: { ...scope, date: { gte: since15, lte: yesterday }, reversedAt: null }, _sum: { amount: true } }),
      this.prisma.collection.findMany({ where: { ...scope, reversedAt: { gte: new Date(`${since7}T00:00:00+05:30`) } }, select: { agentId: true, date: true, reversedAt: true, amount: true } }),
      this.prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'REOPEN_DAY', createdAt: { gte: new Date(`${since7}T00:00:00+05:30`) } }, select: { before: true, createdAt: true, userId: true } }),
      this.prisma.customer.groupBy({ by: ['phone'], where: { ...scope, status: 'ACTIVE' }, _count: { _all: true }, having: { phone: { _count: { gt: 1 } } } }),
      this.prisma.customer.groupBy({ by: ['idNumber'], where: { ...scope, status: 'ACTIVE', idNumber: { not: null } }, _count: { _all: true }, having: { idNumber: { _count: { gt: 1 } } } }),
      this.prisma.handover.findMany({ where: { ...scope, date: { gte: since15 }, difference: { lt: 0 } }, select: { agentId: true, difference: true } }),
      this.prisma.collection.groupBy({ by: ['agentId'], where: { ...scope, flagged: true, reversedAt: null, date: { gte: since7 } }, _count: { _all: true } }),
    ]);
    const agentIds = [...new Set([...daily.map((d) => d.agentId), ...reversed.map((r) => r.agentId), ...shortages.map((s) => s.agentId), ...flagged.map((f) => f.agentId)])];
    const users = await this.prisma.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: agentIds } }, select: { id: true, name: true } });
    const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? '?';

    // 1. An agent who collected far less yesterday than on their usual days.
    const workingYesterday = ctx.settings.workingDays.includes(weekday(yesterday)) && !ctx.settings.holidays.includes(yesterday);
    if (workingYesterday) {
      for (const id of new Set(daily.map((d) => d.agentId))) {
        const days = daily.filter((d) => d.agentId === id && d.date < yesterday);
        if (days.length < 5) continue;
        const usual = days.reduce((s, d) => s + (d._sum.amount ?? 0), 0) / days.length;
        const y = daily.find((d) => d.agentId === id && d.date === yesterday)?._sum.amount ?? 0;
        if (usual > 0 && y < usual * 0.6) {
          const pct = Math.round((y / usual) * 100);
          out.push({ kind: 'agentDrop', severity: pct < 30 ? 'high' : 'medium', values: { agent: nameOf(id), yesterday: y, usual: Math.round(usual), pct } });
        }
      }
    }
    // 2. Collections cancelled again and again by the same agent's book.
    const revBy = new Map<string, { count: number; amount: number; later: number }>();
    for (const r of reversed) {
      const v = revBy.get(r.agentId) ?? { count: 0, amount: 0, later: 0 };
      v.count++;
      v.amount += r.amount;
      // Cancelled on a later day than it was collected: after the cash was counted.
      if (r.reversedAt && r.reversedAt.toISOString().slice(0, 10) > r.date) v.later++;
      revBy.set(r.agentId, v);
    }
    for (const [id, v] of revBy) if (v.count >= 2 || v.later >= 1) out.push({ kind: 'reversals', severity: v.count >= 4 || v.later >= 2 ? 'high' : 'medium', values: { agent: nameOf(id), count: v.count, amount: v.amount, later: v.later } });

    // 3. Closed days opened again for changes.
    const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
    for (const r of reopens) {
      const closes = (Array.isArray(r.before) ? r.before : []) as { branchId?: string; date?: string }[];
      const mine = closes.filter((c) => c.branchId && (!ctx.branchIds || ctx.branchIds.includes(c.branchId)) && (!branchId || c.branchId === branchId));
      if (!mine.length) continue;
      out.push({ kind: 'dayReopened', severity: 'medium', values: { branch: branches.find((b) => b.id === mine[0].branchId)?.name ?? '?', date: mine.map((c) => c.date).sort()[0] ?? '', days: mine.length } });
    }

    // 4 and 5. The same phone or ID number on several active customers.
    const dupes = async (field: 'phone' | 'idNumber', values: string[]) =>
      values.length ? this.prisma.customer.findMany({ where: { ...scope, status: 'ACTIVE', [field]: { in: values } }, select: { id: true, code: true, name: true, phone: true, idNumber: true } }) : [];
    const phoneRows = await dupes('phone', phones.map((p) => p.phone).slice(0, 20));
    for (const p of phones.slice(0, 20)) {
      const cs = phoneRows.filter((c) => c.phone === p.phone);
      out.push({ kind: 'sharedPhone', severity: cs.length >= 3 ? 'high' : 'medium', values: { phone: p.phone, count: cs.length }, customers: cs.map(({ id, code, name }) => ({ id, code, name })) });
    }
    const idRows = await dupes('idNumber', ids.map((p) => p.idNumber!).slice(0, 20));
    for (const p of ids.slice(0, 20)) {
      const cs = idRows.filter((c) => c.idNumber === p.idNumber);
      out.push({ kind: 'sharedId', severity: 'high', values: { id: maskId(p.idNumber!), count: cs.length }, customers: cs.map(({ id, code, name }) => ({ id, code, name })) });
    }

    // 6. Cash short at handover more than once.
    const shortBy = new Map<string, { count: number; amount: number }>();
    for (const s of shortages) {
      const v = shortBy.get(s.agentId) ?? { count: 0, amount: 0 };
      v.count++;
      v.amount += -s.difference;
      shortBy.set(s.agentId, v);
    }
    for (const [id, v] of shortBy) if (v.count >= 2) out.push({ kind: 'shortages', severity: v.count >= 3 ? 'high' : 'medium', values: { agent: nameOf(id), count: v.count, amount: v.amount } });

    // 7. Many collections saved far from the customer's address.
    for (const f of flagged) if (f._count._all >= 3) out.push({ kind: 'flagged', severity: f._count._all >= 6 ? 'high' : 'medium', values: { agent: nameOf(f.agentId), count: f._count._all } });

    return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  }

  // -------------------------------------------------------------------
  // Cash forecast (runs on our server)
  // -------------------------------------------------------------------
  async forecast(ctx: Ctx, branchId?: string) {
    const today = todayIST();
    const scope = branchScope(ctx, branchId);
    const histFrom = addDays(today, -56);
    const end = addDays(today, 6);
    const loans = await this.prisma.loan.findMany({ where: { ...scope, status: { in: ['ACTIVE', 'CLOSED', 'FORECLOSED', 'WRITTEN_OFF'] } }, select: { id: true, status: true } });
    const ids = loans.map((l) => l.id);
    const activeIds = new Set(loans.filter((l) => l.status === 'ACTIVE').map((l) => l.id));
    const [pastDue, collected, upcoming, funds, approved] = await Promise.all([
      this.prisma.instalment.groupBy({ by: ['dueDate'], where: { loanId: { in: ids }, dueDate: { gte: histFrom, lt: today } }, _sum: { principalDue: true, interestDue: true } }),
      this.prisma.collection.groupBy({ by: ['date'], where: { ...scope, date: { gte: histFrom, lt: today }, reversedAt: null }, _sum: { amount: true } }),
      this.prisma.instalment.findMany({ where: { loanId: { in: [...activeIds] }, dueDate: { gte: today, lte: end } }, select: { dueDate: true, principalDue: true, interestDue: true, principalPaid: true, interestPaid: true } }),
      this.prisma.fund.aggregate({ where: { ...scope, active: true }, _sum: { balance: true } }),
      this.prisma.loan.aggregate({ where: { ...scope, status: 'APPROVED' }, _sum: { principal: true }, _count: true }),
    ]);
    // Collection rate by weekday over the last 8 weeks: money collected on that weekday / money due on it.
    const dueW = Array(7).fill(0);
    const colW = Array(7).fill(0);
    for (const d of pastDue) dueW[weekday(d.dueDate)] += (d._sum.principalDue ?? 0) + (d._sum.interestDue ?? 0);
    for (const c of collected) colW[weekday(c.date)] += c._sum.amount ?? 0;
    const allDue = dueW.reduce((a, b) => a + b, 0);
    const overall = allDue ? colW.reduce((a, b) => a + b, 0) / allDue : 0.9;
    const rateFor = (w: number) => {
      if (!ctx.settings.workingDays.includes(w)) return 0;
      const r = dueW[w] > 0 ? colW[w] / dueW[w] : overall;
      return Math.max(0.2, Math.min(1.5, r || overall));
    };
    const days = Array.from({ length: 7 }, (_, k) => {
      const date = addDays(today, k);
      const due = upcoming.filter((i) => i.dueDate === date).reduce((s, i) => s + Math.max(0, i.principalDue + i.interestDue - i.principalPaid - i.interestPaid), 0);
      const holiday = ctx.settings.holidays.includes(date) || !ctx.settings.workingDays.includes(weekday(date));
      return { date, due, expected: holiday ? 0 : Math.round(due * rateFor(weekday(date))), holiday };
    });
    const totalExpected = days.reduce((s, d) => s + d.expected, 0);
    const fundBalance = funds._sum.balance ?? 0;
    const approvedWaiting = approved._sum.principal ?? 0;
    return {
      from: today,
      to: end,
      days,
      totalDue: days.reduce((s, d) => s + d.due, 0),
      totalExpected,
      ratePct: Math.round(overall * 100),
      fundBalance,
      approvedWaiting,
      approvedCount: approved._count,
      freeToLend: fundBalance + totalExpected - approvedWaiting,
    };
  }

  // -------------------------------------------------------------------
  // Morning briefing
  // -------------------------------------------------------------------
  private async briefingFacts(ctx: Ctx, branchId?: string) {
    const today = todayIST();
    const yesterday = addDays(today, -1);
    const scope = branchScope(ctx, branchId);
    const [dash, alerts, forecast, collectedY, dueY, handoversY, activeLoans] = await Promise.all([
      this.dashboard.get(ctx, branchId),
      this.alerts(ctx, branchId),
      this.forecast(ctx, branchId),
      this.prisma.collection.aggregate({ where: { ...scope, date: yesterday, reversedAt: null }, _sum: { amount: true }, _count: true }),
      this.prisma.instalment.aggregate({ where: { dueDate: yesterday, loan: { ...scope, status: { in: ['ACTIVE', 'CLOSED', 'FORECLOSED'] } } }, _sum: { principalDue: true, interestDue: true } }),
      this.prisma.handover.findMany({ where: { ...scope, date: yesterday }, select: { difference: true } }),
      this.prisma.loan.findMany({ where: { ...scope, status: 'ACTIVE' }, include: { instalments: true } }),
    ]);
    let newlyLate = 0;
    let newlyLateAmount = 0;
    for (const l of activeLoans) {
      const p = positionOf(l, today);
      // Fell behind in the last three days: the ones worth a call before they slip further.
      if (p.daysPastDue >= 1 && p.daysPastDue <= 3) {
        newlyLate++;
        newlyLateAmount += p.overdue;
      }
    }
    const dueYesterday = (dueY._sum.principalDue ?? 0) + (dueY._sum.interestDue ?? 0);
    const short = handoversY.filter((h) => h.difference < 0);
    const late = dash.ageing.reduce((s, a) => ({ loans: s.loans + a.loans, amount: s.amount + a.amount }), { loans: 0, amount: 0 });
    return {
      today,
      yesterday,
      collectedYesterday: collectedY._sum.amount ?? 0,
      dueYesterday,
      ratePctYesterday: dueYesterday ? Math.round(((collectedY._sum.amount ?? 0) / dueYesterday) * 100) : null,
      dueToday: dash.dueToday,
      collectedToday: dash.collectedToday,
      lateLoans: late.loans,
      lateAmount: late.amount,
      newlyLate,
      newlyLateAmount,
      shortCount: short.length,
      shortAmount: short.reduce((s, h) => s - h.difference, 0),
      pendingApprovals: dash.pendingApprovals,
      expectedNext7: forecast.totalExpected,
      freeToLend: forecast.freeToLend,
      alerts: alerts.slice(0, 3).map((a) => alertText(a, 'en')),
      alertCount: alerts.length,
    };
  }

  /** Plain-rule bullets in the user's language; used when AI is off or unreachable. */
  private ruleBullets(f: Awaited<ReturnType<AiService['briefingFacts']>>, lang: string) {
    const t = (k: string, v: Record<string, string | number> = {}) => translate(lang, `ai.brief.${k}`, v);
    const b: string[] = [];
    if (f.dueYesterday > 0) b.push(t('yesterday', { collected: rs(f.collectedYesterday), due: rs(f.dueYesterday), pct: f.ratePctYesterday ?? 0 }));
    else if (f.collectedYesterday > 0) b.push(t('yesterdayNoDue', { collected: rs(f.collectedYesterday) }));
    b.push(t('today', { due: rs(f.dueToday), collected: rs(f.collectedToday) }));
    if (f.newlyLate) b.push(t('newlyLate', { count: f.newlyLate, amount: rs(f.newlyLateAmount) }));
    if (f.lateLoans) b.push(t('late', { count: f.lateLoans, amount: rs(f.lateAmount) }));
    if (f.shortCount) b.push(t('short', { count: f.shortCount, amount: rs(f.shortAmount) }));
    if (f.pendingApprovals) b.push(t('approvals', { count: f.pendingApprovals }));
    b.push(t('forecast', { expected: rs(f.expectedNext7), free: rs(f.freeToLend) }));
    if (f.alertCount) b.push(t('alerts', { count: f.alertCount }));
    return b;
  }

  async briefing(ctx: Ctx, branchId: string | undefined, lang: string) {
    const facts = await this.briefingFacts(ctx, branchId);
    const rules = this.ruleBullets(facts, lang);
    if (!this.claude.enabled(ctx)) return { date: facts.today, bullets: rules, source: 'rules' as const, facts };
    const key = createHash('sha256').update(JSON.stringify([ctx.tenantId, ctx.userId, branchId ?? '', lang, facts])).digest('hex');
    const hit = briefCache.get(key);
    if (hit && Date.now() - hit.at < BRIEF_TTL_MS) return { date: facts.today, bullets: hit.bullets, source: 'ai' as const, facts };
    try {
      const money = Object.fromEntries(
        Object.entries(facts).map(([k, v]) => [k, typeof v === 'number' && /(collected|due|amount|expected|free)/i.test(k) ? rs(v) : v]),
      );
      const res = await this.claude.json<{ bullets: string[] }>({
        system:
          `You write the morning briefing for the owner or manager of "${ctx.tenantName}", a small daily-collection lending business in Tamil Nadu, India. ` +
          `Write 3 to 6 short bullet points in ${langName(lang)}, plain everyday words, no jargon. Lead with what needs action today. ` +
          `Use only the facts given; never invent numbers. Money is already formatted in rupees. Each bullet is one sentence with no markdown.`,
        content: [{ type: 'text', text: `Facts for ${facts.today} (yesterday was ${facts.yesterday}):\n${JSON.stringify(money, null, 1)}` }],
        schema: { type: 'object', properties: { bullets: { type: 'array', items: { type: 'string' } } }, required: ['bullets'], additionalProperties: false },
        effort: 'low',
      });
      const bullets = (res.bullets ?? []).filter((s) => typeof s === 'string' && s.trim()).slice(0, 6);
      if (!bullets.length) return { date: facts.today, bullets: rules, source: 'rules' as const, facts };
      briefCache.set(key, { at: Date.now(), bullets });
      if (briefCache.size > 500) briefCache.delete(briefCache.keys().next().value!);
      return { date: facts.today, bullets, source: 'ai' as const, facts };
    } catch {
      // The briefing must always show; fall back to the plain version if Claude is unreachable.
      return { date: facts.today, bullets: rules, source: 'rules' as const, facts };
    }
  }

  // -------------------------------------------------------------------
  // Ask in plain words
  // -------------------------------------------------------------------
  private tools(ctx: Ctx): AiTool[] {
    const has = (p: Permission) => ctx.permissions.has(p);
    const filterProps = {
      from: { type: 'string', description: 'Start date YYYY-MM-DD (default: first day of this month)' },
      to: { type: 'string', description: 'End date YYYY-MM-DD (default: today)' },
      branchId: { type: 'string', description: 'Branch id from the places tool' },
      locationId: { type: 'string', description: 'Location (area) id from the places tool' },
      routeId: { type: 'string', description: 'Route (line) id from the places tool' },
      agentId: { type: 'string', description: 'Collection agent id from the places tool' },
      productId: { type: 'string', description: 'Loan scheme (product) id from the places tool' },
    };
    const f = (i: Record<string, unknown>): ReportFilter => {
      const r = reportFilterSchema.safeParse(i);
      if (!r.success) throw bad('Bad filter: ' + r.error.issues.map((x) => x.path.join('.') + ' ' + x.message).join('; '));
      return r.data;
    };
    const report = (name: string, description: string, run: (f: ReportFilter, i: Record<string, unknown>) => Promise<unknown>, extra: Record<string, unknown> = {}): AiTool => ({
      name,
      description,
      input_schema: { type: 'object', properties: { ...filterProps, ...extra } },
      run: (i) => run(f(i), i),
    });
    const tools: AiTool[] = [];
    tools.push({
      name: 'places',
      description: 'Lists the branches, locations (areas), routes (lines), collection agents and loan schemes this user can see, with their ids. Call this first to turn a name in the question into an id.',
      input_schema: { type: 'object', properties: {} },
      run: async () => {
        const s = branchScope(ctx);
        const [branches, locations, routes, agents, products] = await Promise.all([
          this.prisma.branch.findMany({ where: ctx.branchIds ? { tenantId: ctx.tenantId, id: { in: ctx.branchIds } } : { tenantId: ctx.tenantId }, select: { id: true, name: true, code: true } }),
          this.prisma.location.findMany({ where: s, select: { id: true, name: true, branchId: true } }),
          this.prisma.route.findMany({ where: s, select: { id: true, name: true, branchId: true, active: true } }),
          this.prisma.user.findMany({ where: { tenantId: ctx.tenantId, active: true, role: { baseRole: 'COLLECTION_AGENT' } }, select: { id: true, name: true } }),
          this.prisma.loanProduct.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
        ]);
        return { branches, locations, routes, agents, schemes: products };
      },
    });
    if (has('report.view')) {
      tools.push(
        { name: 'dashboard_today', description: "Today's snapshot: due today, collected today (cash and UPI), active loans, portfolio, overdue by age, approvals waiting, each agent's collection and each route's progress.", input_schema: { type: 'object', properties: { branchId: filterProps.branchId } }, run: (i) => this.dashboard.get(ctx, (i.branchId as string) || undefined) },
        report('daily_collection', 'Collections per day in a date range, with totals by mode, agent and route.', (x) => this.reports.dailyCollection(ctx, x)),
        report('pending_list', 'Customers with overdue dues (who has not paid), with amounts and days late.', (x) => this.reports.pendingList(ctx, x)),
        report('outstanding', 'Outstanding balance of every active loan.', (x) => this.reports.outstanding(ctx, x)),
        report('ageing', 'Overdue amounts grouped by how many days late.', (x) => this.reports.ageing(ctx, x)),
        report('demand_vs_collection', 'Money due versus money collected for a period.', (x) => this.reports.demandVsCollection(ctx, x)),
        report('agent_performance', 'Each collection agent: amount due, collected, visits and rate for a period.', (x) => this.reports.agentPerformance(ctx, x)),
        report('disbursements', 'Loans given out (disbursed) in a period.', (x) => this.reports.disbursements(ctx, x)),
        report('closed_loans', 'Loans closed or foreclosed in a period.', (x) => this.reports.closedLoans(ctx, x)),
        report('scheme_wise', 'Loans and collection by loan scheme (product).', (x) => this.reports.schemeWise(ctx, x)),
        report('location_wise', 'Loans and collection by location (area).', (x) => this.reports.locationWise(ctx, x)),
        report('cash_differences', 'Agent handovers where the cash received did not match what was expected.', (x) => this.reports.cashDifferences(ctx, x)),
        report('fund_utilisation', 'Fund balances and how much of each fund is lent out.', (x) => this.reports.fundUtilisation(ctx, x)),
        report('weekday_collection', 'Collection by day of the week.', (x) => this.reports.weekdayCollection(ctx, x)),
        report('growth', 'Month-by-month growth: new loans, amount lent, collections, active loans.', (x, i) => this.reports.growth(ctx, { ...x, months: Number(i.months) || 6 }), { months: { type: 'number', description: 'How many months back (1 to 36, default 6)' } }),
        { name: 'unusual_activity', description: 'Unusual activity alerts: agents collecting far less than usual, repeated cancellations, reopened days, shared phone or ID numbers, repeated cash shortages, collections far from the customer.', input_schema: { type: 'object', properties: { branchId: filterProps.branchId } }, run: (i) => this.alerts(ctx, (i.branchId as string) || undefined) },
        { name: 'cash_forecast', description: 'Expected collections for each of the next 7 days, fund balance, approved loans waiting and money free to lend.', input_schema: { type: 'object', properties: { branchId: filterProps.branchId } }, run: (i) => this.forecast(ctx, (i.branchId as string) || undefined) },
      );
    }
    if (has('pl.view')) {
      tools.push(
        report('profit_loss', 'Profit and loss for a period: interest and fee income, expenses, investor returns, net profit.', (x) => this.pl.report(ctx, x)),
        report('income', 'Income (interest, fees, penalty) for a period.', (x) => this.reports.income(ctx, x)),
      );
    }
    if (has('customer.view')) {
      tools.push(
        {
          name: 'find_customers',
          description: 'Finds customers by name, phone or customer code. Returns at most 10.',
          input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
          run: async (i) => {
            const r = (await this.customers.list(ctx, { q: String(i.query ?? '') })) as { items?: unknown[] } | unknown[];
            return Array.isArray(r) ? r.slice(0, 10) : (r.items ?? []).slice(0, 10);
          },
        },
        { name: 'customer_history', description: "One customer's repayment history and risk score.", input_schema: { type: 'object', properties: { customerId: { type: 'string' } }, required: ['customerId'] }, run: (i) => this.customers.history(ctx, String(i.customerId)) },
      );
    }
    return tools;
  }

  async ask(ctx: Ctx, input: z.infer<typeof askSchema>) {
    this.claude.assertEnabled(ctx);
    const today = todayIST();
    const system =
      `You answer questions from staff of "${ctx.tenantName}", a small daily-collection lending business in Tamil Nadu, India. ` +
      `Today is ${today} (${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday(today)]}). ` +
      `Use the tools to look up real figures; never guess a number. Call "places" first when the question names a branch, area, line, agent or scheme. ` +
      `IMPORTANT: every money field in tool results is in paise (100 paise = 1 rupee). Divide by 100 and write rupees with Indian grouping, like ₹1,25,000. ` +
      `Counts, days and percentages are not money. Dates are YYYY-MM-DD. "Line" means route. ` +
      `Reply in ${langName(input.language)}, in plain short sentences a busy owner can read on a phone. Lead with the answer, then the few figures behind it. ` +
      `A small table in markdown is fine when comparing several items. If the tools cannot answer, say what you could not find. ` +
      `Only answer about this business's own data.`;
    const messages = [
      ...(input.history ?? []).slice(-8).map((h) => ({ role: h.role, content: h.text })),
      { role: 'user' as const, content: input.question },
    ];
    const res = await this.claude.withTools({ system, messages, tools: this.tools(ctx), effort: 'medium' });
    await this.audit.log(ctx, 'AI_ASK', 'AI', null, undefined, { question: input.question, tools: res.used });
    return { answer: res.answer || translate(input.language, 'ai.ask.noAnswer'), tools: [...new Set(res.used)] };
  }

  // -------------------------------------------------------------------
  // Reminder message draft
  // -------------------------------------------------------------------
  async reminder(ctx: Ctx, customerId: string, input: z.infer<typeof reminderSchema>) {
    const c = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId }, include: { loans: { where: { status: 'ACTIVE' }, include: { instalments: true } } } });
    if (!c) throw notFound('Customer');
    assertBranch(ctx, c.branchId);
    const today = todayIST();
    let overdue = 0;
    let daysLate = 0;
    let nextDue: { date: string; amount: number } | null = null;
    for (const l of c.loans) {
      const p = positionOf(l, today);
      overdue += p.overdue + p.penaltyOutstanding;
      daysLate = Math.max(daysLate, p.daysPastDue);
      const next = l.instalments
        .filter((i) => i.dueDate >= today && i.principalPaid + i.interestPaid < i.principalDue + i.interestDue)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
      if (next && (!nextDue || next.dueDate < nextDue.date)) nextDue = { date: next.dueDate, amount: next.principalDue + next.interestDue - next.principalPaid - next.interestPaid };
    }
    const lang = input.language ?? (c.language === 'ta' ? 'ta' : 'en');
    const vars = { name: c.name, amount: rs(overdue), days: daysLate, business: ctx.tenantName, nextDate: nextDue ? nextDue.date.split('-').reverse().join('-') : '', nextAmount: nextDue ? rs(nextDue.amount) : '' };
    const template = translate(lang, overdue > 0 ? 'ai.reminder.overdue' : nextDue ? 'ai.reminder.upcoming' : 'ai.reminder.none', vars);
    const base = { phone: c.phone, language: lang, overdue, daysLate, nextDue };
    if (!this.claude.enabled(ctx) || (overdue === 0 && !nextDue)) return { ...base, text: template, source: 'rules' as const };
    let res: { message: string };
    try {
      res = await this.claude.json<{ message: string }>({
      system:
        `You write short, polite payment reminders that a small lending business in Tamil Nadu sends to its customers by SMS or WhatsApp. ` +
        `Write in ${langName(lang)}${lang === 'ta' ? ' (Tamil script)' : ''}. Respectful and warm, never threatening or shaming, no legal language. ` +
        `At most 3 short sentences (under 300 characters). Mention the amount and that the collection agent will come or they can pay at the office. ` +
        `Sign with the business name. Plain text, no emojis, no markdown. Use only the facts given.`,
      content: [{ type: 'text', text: JSON.stringify({ ...vars, overdue: overdue > 0, tone: input.tone ?? 'gentle', note: input.note ?? '' }) }],
      schema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'], additionalProperties: false },
      effort: 'low',
      maxTokens: 1500,
      });
    } catch {
      return { ...base, text: template, source: 'rules' as const };
    }
    const text = (res.message ?? '').trim() || template;
    await this.audit.log(ctx, 'AI_REMINDER', 'Customer', c.id, undefined, { language: lang });
    return { ...base, text, source: 'ai' as const };
  }

  // -------------------------------------------------------------------
  // Read an ID card photo
  // -------------------------------------------------------------------
  async readId(ctx: Ctx, input: z.infer<typeof readIdSchema>) {
    this.claude.assertEnabled(ctx);
    const res = await this.claude.json<IdRead>({
      system:
        'You read Indian identity documents (Aadhaar, voter ID, PAN, driving licence, ration card) from a photo for a customer sign-up form. ' +
        'Copy text exactly as printed; write the name and address in English letters when the card has both. Leave a field empty when it is not readable. ' +
        'Never guess digits. If the photo is not an identity document, set documentType to NOT_ID.',
      content: [
        { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.image } },
        { type: 'text', text: 'Read this card.' },
      ],
      schema: {
        type: 'object',
        properties: {
          documentType: { type: 'string', enum: ['AADHAAR', 'VOTER_ID', 'PAN', 'DRIVING_LICENCE', 'RATION_CARD', 'OTHER', 'NOT_ID'] },
          name: { type: 'string' },
          idNumber: { type: 'string' },
          address: { type: 'string' },
          pincode: { type: 'string' },
          dateOfBirth: { type: 'string', description: 'YYYY-MM-DD or the year only' },
          fatherOrHusbandName: { type: 'string' },
          readable: { type: 'boolean', description: 'false when the photo is too blurred or cut off to read the number' },
        },
        required: ['documentType', 'name', 'idNumber', 'address', 'pincode', 'dateOfBirth', 'fatherOrHusbandName', 'readable'],
        additionalProperties: false,
      },
      effort: 'medium',
      maxTokens: 2000,
    });
    const idNumber = (res.idNumber ?? '').replace(/\s+/g, '').toUpperCase();
    const idType = ({ AADHAAR: 'AADHAAR', VOTER_ID: 'VOTER_ID', PAN: 'PAN', DRIVING_LICENCE: 'DRIVING_LICENCE' } as Record<string, string>)[res.documentType] ?? (res.documentType === 'NOT_ID' ? null : 'OTHER');
    // Someone already signed up with this ID, or the same name, in this business only.
    const duplicates = idNumber || res.name
      ? await this.prisma.customer.findMany({
          where: { tenantId: ctx.tenantId, OR: [...(idNumber ? [{ idNumber }, { idNumber: res.idNumber }] : []), ...(res.name ? [{ name: { equals: res.name.trim(), mode: 'insensitive' as const } }] : [])] },
          select: { id: true, code: true, name: true, phone: true, status: true, idNumber: true, branchId: true },
          take: 5,
        })
      : [];
    await this.audit.log(ctx, 'AI_READ_ID', 'Customer', null, undefined, { documentType: res.documentType, found: !!idNumber });
    return {
      documentType: res.documentType,
      readable: res.readable !== false && res.documentType !== 'NOT_ID',
      fields: { name: res.name?.trim() || '', idType, idNumber, address: [res.address?.trim(), res.pincode?.trim()].filter(Boolean).join(' - '), dateOfBirth: res.dateOfBirth || '', guardian: res.fatherOrHusbandName || '' },
      duplicates: duplicates.map((d) => ({ id: d.id, code: d.code, name: d.name, phone: d.phone, status: d.status, sameId: !!idNumber && d.idNumber?.replace(/\s+/g, '').toUpperCase() === idNumber, otherBranch: !!ctx.branchIds && !ctx.branchIds.includes(d.branchId) })),
    };
  }
}

interface IdRead {
  documentType: string;
  name: string;
  idNumber: string;
  address: string;
  pincode: string;
  dateOfBirth: string;
  fatherOrHusbandName: string;
  readable: boolean;
}

/** Shows only the last four characters of an ID number. */
const maskId = (s: string) => (s.length > 4 ? '•'.repeat(Math.min(8, s.length - 4)) + s.slice(-4) : s);

/** One alert as an English sentence (for the briefing write-up); the apps show their own translated text. */
export function alertText(a: Alert, lang: string) {
  const v = Object.fromEntries(Object.entries(a.values).map(([k, x]) => [k, typeof x === 'number' && /amount|usual|yesterday/.test(k) ? rs(x) : x]));
  return translate(lang, `ai.alerts.${a.kind}`, v);
}

const askSchema = z.object({
  question: z.string().trim().min(2).max(1000),
  language: z.enum(['en', 'ta']).default('en'),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(6000) })).max(12).optional(),
});
const reminderSchema = z.object({
  language: z.enum(['en', 'ta']).optional(),
  tone: z.enum(['gentle', 'firm']).optional(),
  note: z.string().max(200).optional(),
});
const readIdSchema = z.object({
  mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  // Base64 without the data: prefix; about 3.5 MB of image at most.
  image: z.string().min(100).max(4_800_000).regex(/^[A-Za-z0-9+/=\s]+$/, 'Not a picture'),
});
const branchQuery = z.object({ branchId: z.string().optional(), language: z.enum(['en', 'ta']).optional() });

@Controller('ai')
export class AiController {
  constructor(private readonly svc: AiService) {}

  @Get('status') status(@CurrentCtx() ctx: Ctx) {
    return this.svc.status(ctx);
  }
  @Get('briefing') @Perm('report.view') briefing(@CurrentCtx() ctx: Ctx, @Query(V(branchQuery)) q: z.infer<typeof branchQuery>) {
    return this.svc.briefing(ctx, q.branchId || undefined, q.language ?? ctx.settings.defaultLanguage);
  }
  @Get('alerts') @Perm('report.view') alerts(@CurrentCtx() ctx: Ctx, @Query(V(branchQuery)) q: z.infer<typeof branchQuery>) {
    return this.svc.alerts(ctx, q.branchId || undefined);
  }
  @Get('forecast') @Perm('report.view') forecast(@CurrentCtx() ctx: Ctx, @Query(V(branchQuery)) q: z.infer<typeof branchQuery>) {
    return this.svc.forecast(ctx, q.branchId || undefined);
  }
  @Post('ask') @Perm('report.view') ask(@CurrentCtx() ctx: Ctx, @Body(V(askSchema)) b: z.infer<typeof askSchema>) {
    return this.svc.ask(ctx, b);
  }
  @Post('customers/:id/reminder') @Perm('collection.record', 'report.view', 'customer.view') reminder(@CurrentCtx() ctx: Ctx, @Param('id') id: string, @Body(V(reminderSchema)) b: z.infer<typeof reminderSchema>) {
    return this.svc.reminder(ctx, id, b);
  }
  @Post('read-id') @Perm('customer.create', 'customer.edit') readId(@CurrentCtx() ctx: Ctx, @Body(V(readIdSchema)) b: z.infer<typeof readIdSchema>) {
    return this.svc.readId(ctx, b);
  }
}
