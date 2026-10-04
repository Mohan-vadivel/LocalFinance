import { addDays, addMonthsClamped, diffDays, parseDate, weekday } from './dates';
import type { Frequency, InterestMethod, PenaltyType } from './enums';

export interface LoanTerms {
  principal: number; // paise
  frequency: Frequency;
  tenure: number; // number of instalments
  interestMethod: InterestMethod;
  /** FLAT/UPFRONT: % of principal for the whole loan. REDUCING: annual %. */
  interestRate: number;
  /** Processing fee as % of principal (feePercent) plus a flat amount in paise (feeFlat). */
  feePercent?: number;
  feeFlat?: number;
}

export interface Calendar {
  /** Weekdays that are working days, 0 = Sunday. Defaults to Monday to Saturday. */
  workingDays?: number[];
  /** Holiday dates, YYYY-MM-DD. */
  holidays?: string[];
}

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  totalDue: number;
}

export interface DisbursementSummary {
  principal: number;
  fee: number;
  upfrontInterest: number;
  /** Cash actually handed to the customer. */
  netDisbursed: number;
  totalInterest: number;
  totalRepayable: number;
}

const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];

function isWorking(date: string, cal: Calendar): boolean {
  const days = cal.workingDays && cal.workingDays.length ? cal.workingDays : DEFAULT_WORKING_DAYS;
  return days.includes(weekday(date)) && !(cal.holidays ?? []).includes(date);
}

function nextWorking(date: string, cal: Calendar): string {
  let d = date;
  for (let i = 0; i < 400 && !isWorking(d, cal); i++) d = addDays(d, 1);
  return d;
}

/** Due dates for each instalment. Daily loans skip off days; weekly and monthly move to the next working day. */
export function dueDates(firstDue: string, frequency: Frequency, count: number, cal: Calendar = {}): string[] {
  const out: string[] = [];
  if (frequency === 'DAILY') {
    let d = nextWorking(firstDue, cal);
    while (out.length < count) {
      out.push(d);
      d = nextWorking(addDays(d, 1), cal);
    }
    return out;
  }
  const dom = parseDate(firstDue).getUTCDate();
  for (let i = 0; i < count; i++) {
    const nominal = frequency === 'WEEKLY' ? addDays(firstDue, 7 * i) : addMonthsClamped(firstDue, i, dom);
    out.push(nextWorking(nominal, cal));
  }
  return out;
}

/** Splits total into n integer parts; the remainder goes to the last part. */
function split(total: number, n: number): number[] {
  const base = Math.floor(total / n);
  const parts = Array<number>(n).fill(base);
  parts[n - 1] += total - base * n;
  return parts;
}

const periodsPerYear: Record<Frequency, number> = { DAILY: 365, WEEKLY: 52, MONTHLY: 12 };

export function summarize(terms: LoanTerms): DisbursementSummary {
  const fee = Math.round((terms.principal * (terms.feePercent ?? 0)) / 100) + (terms.feeFlat ?? 0);
  let totalInterest = 0;
  let upfrontInterest = 0;
  if (terms.interestMethod === 'FLAT') totalInterest = Math.round((terms.principal * terms.interestRate) / 100);
  if (terms.interestMethod === 'UPFRONT') upfrontInterest = Math.round((terms.principal * terms.interestRate) / 100);
  if (terms.interestMethod === 'REDUCING') {
    totalInterest = generateAmounts(terms).reduce((s, r) => s + r.interestDue, 0);
  }
  const netDisbursed = terms.principal - fee - upfrontInterest;
  if (netDisbursed <= 0) throw new Error('Fees and upfront interest exceed the principal');
  return {
    principal: terms.principal,
    fee,
    upfrontInterest,
    netDisbursed,
    totalInterest: totalInterest + upfrontInterest,
    totalRepayable: terms.principal + totalInterest,
  };
}

function generateAmounts(terms: LoanTerms): { principalDue: number; interestDue: number }[] {
  const { principal, tenure } = terms;
  if (!Number.isInteger(principal) || principal <= 0) throw new Error('Principal must be a positive amount in paise');
  if (!Number.isInteger(tenure) || tenure <= 0) throw new Error('Tenure must be a positive whole number');
  if (terms.interestRate < 0) throw new Error('Interest rate cannot be negative');

  if (terms.interestMethod === 'FLAT') {
    const interest = Math.round((principal * terms.interestRate) / 100);
    const p = split(principal, tenure);
    const i = split(interest, tenure);
    return p.map((pd, k) => ({ principalDue: pd, interestDue: i[k] }));
  }
  if (terms.interestMethod === 'UPFRONT') {
    return split(principal, tenure).map((pd) => ({ principalDue: pd, interestDue: 0 }));
  }
  // REDUCING balance EMI
  const r = terms.interestRate / 100 / periodsPerYear[terms.frequency];
  if (r === 0) return split(principal, tenure).map((pd) => ({ principalDue: pd, interestDue: 0 }));
  const emi = Math.round((principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1));
  const rows: { principalDue: number; interestDue: number }[] = [];
  let balance = principal;
  for (let k = 0; k < tenure; k++) {
    const interestDue = Math.round(balance * r);
    let principalDue = emi - interestDue;
    if (k === tenure - 1 || principalDue > balance) principalDue = balance;
    balance -= principalDue;
    rows.push({ principalDue, interestDue });
  }
  return rows;
}

export function generateSchedule(terms: LoanTerms, firstDue: string, cal: Calendar = {}): ScheduleRow[] {
  const amounts = generateAmounts(terms);
  const dates = dueDates(firstDue, terms.frequency, terms.tenure, cal);
  return amounts.map((a, k) => ({
    seq: k + 1,
    dueDate: dates[k],
    principalDue: a.principalDue,
    interestDue: a.interestDue,
    totalDue: a.principalDue + a.interestDue,
  }));
}

/** First due date: one period after disbursement. */
export function defaultFirstDue(disbursedOn: string, frequency: Frequency): string {
  if (frequency === 'DAILY') return addDays(disbursedOn, 1);
  if (frequency === 'WEEKLY') return addDays(disbursedOn, 7);
  return addMonthsClamped(disbursedOn, 1, parseDate(disbursedOn).getUTCDate());
}

// ---------- Payments ----------

export interface InstalmentState {
  id: string;
  seq: number;
  dueDate: string;
  principalDue: number;
  interestDue: number;
  principalPaid: number;
  interestPaid: number;
  /** Date the instalment was fully paid, if it was. */
  paidOn?: string | null;
}

export interface PenaltyRule {
  type: PenaltyType;
  /** FIXED_PER_DAY: paise per day late. PERCENT_PER_DAY: % of the instalment per day late. */
  value: number;
  graceDays: number;
}

export const instalmentDue = (i: InstalmentState) => i.principalDue + i.interestDue - i.principalPaid - i.interestPaid;

/** Penalty charged so far: per instalment, for each day it was (or still is) unpaid after the grace days. */
export function penaltyCharged(instalments: InstalmentState[], rule: PenaltyRule, asOf: string): number {
  if (rule.type === 'NONE' || rule.value <= 0) return 0;
  let total = 0;
  for (const ins of instalments) {
    const end = ins.paidOn ?? asOf;
    const daysLate = diffDays(end, ins.dueDate) - rule.graceDays;
    if (daysLate <= 0) continue;
    const perDay =
      rule.type === 'FIXED_PER_DAY' ? rule.value : Math.round(((ins.principalDue + ins.interestDue) * rule.value) / 100);
    total += perDay * daysLate;
  }
  return total;
}

export interface Allocation {
  penalty: number;
  interest: number;
  principal: number;
  perInstalment: { id: string; interest: number; principal: number; fullyPaid: boolean }[];
}

export type PaymentOrder = 'PENALTY_FIRST' | 'PENALTY_LAST';

/**
 * Applies a payment to a loan: penalty (first or last), then each instalment oldest first, interest before
 * principal. Paying ahead of schedule simply fills later instalments. Throws if the amount exceeds what is owed.
 */
export function allocatePayment(
  amount: number,
  instalments: InstalmentState[],
  penaltyOutstanding: number,
  order: PaymentOrder = 'PENALTY_FIRST',
): Allocation {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error('Amount must be a positive amount in paise');
  const owed = instalments.reduce((s, i) => s + instalmentDue(i), 0) + Math.max(0, penaltyOutstanding);
  if (amount > owed) throw new Error(`Amount exceeds the outstanding balance of ${owed} paise`);

  let left = amount;
  const res: Allocation = { penalty: 0, interest: 0, principal: 0, perInstalment: [] };
  const takePenalty = () => {
    const p = Math.min(left, Math.max(0, penaltyOutstanding));
    res.penalty += p;
    left -= p;
  };
  if (order === 'PENALTY_FIRST') takePenalty();

  const sorted = [...instalments].sort((a, b) => a.seq - b.seq);
  for (const ins of sorted) {
    if (left <= 0) break;
    const iDue = ins.interestDue - ins.interestPaid;
    const pDue = ins.principalDue - ins.principalPaid;
    if (iDue + pDue <= 0) continue;
    const i = Math.min(left, iDue);
    left -= i;
    const p = Math.min(left, pDue);
    left -= p;
    res.interest += i;
    res.principal += p;
    res.perInstalment.push({ id: ins.id, interest: i, principal: p, fullyPaid: i === iDue && p === pDue });
  }
  if (order === 'PENALTY_LAST' && left > 0) takePenalty();
  return res;
}

export interface LoanPosition {
  principalOutstanding: number;
  interestOutstanding: number;
  penaltyOutstanding: number;
  totalOutstanding: number;
  /** Amount due up to and including asOf that is still unpaid. */
  overdue: number;
  dueToday: number;
  /** Days since the oldest unpaid due date (0 if nothing is overdue). */
  daysPastDue: number;
}

export function loanPosition(
  instalments: InstalmentState[],
  penalty: { charged: number; paid: number; waived: number },
  asOf: string,
): LoanPosition {
  let principalOutstanding = 0;
  let interestOutstanding = 0;
  let overdue = 0;
  let dueToday = 0;
  let oldest: string | null = null;
  for (const i of instalments) {
    const pd = i.principalDue - i.principalPaid;
    const id = i.interestDue - i.interestPaid;
    principalOutstanding += pd;
    interestOutstanding += id;
    if (pd + id > 0) {
      if (i.dueDate < asOf) {
        overdue += pd + id;
        if (!oldest || i.dueDate < oldest) oldest = i.dueDate;
      } else if (i.dueDate === asOf) dueToday += pd + id;
    }
  }
  const penaltyOutstanding = Math.max(0, penalty.charged - penalty.paid - penalty.waived);
  return {
    principalOutstanding,
    interestOutstanding,
    penaltyOutstanding,
    totalOutstanding: principalOutstanding + interestOutstanding + penaltyOutstanding,
    overdue,
    dueToday,
    daysPastDue: oldest ? diffDays(asOf, oldest) : 0,
  };
}

export const AGEING_BUCKETS = [
  { key: 'd1_7', min: 1, max: 7 },
  { key: 'd8_30', min: 8, max: 30 },
  { key: 'd31_90', min: 31, max: 90 },
  { key: 'd90_plus', min: 91, max: Infinity },
] as const;

export function ageingBucket(daysPastDue: number): (typeof AGEING_BUCKETS)[number]['key'] | null {
  const b = AGEING_BUCKETS.find((x) => daysPastDue >= x.min && daysPastDue <= x.max);
  return b ? b.key : null;
}

/** Risk grade from repayment history: A best, D worst. Advisory only. */
export function riskGrade(h: { loans: number; onTimeRatio: number; maxDaysLate: number; writtenOff: number }): 'A' | 'B' | 'C' | 'D' | 'NEW' {
  if (h.loans === 0) return 'NEW';
  if (h.writtenOff > 0 || h.maxDaysLate > 90) return 'D';
  if (h.onTimeRatio >= 0.9 && h.maxDaysLate <= 7) return 'A';
  if (h.onTimeRatio >= 0.75 && h.maxDaysLate <= 30) return 'B';
  return 'C';
}

/** Haversine distance in metres. */
export function distanceMetres(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Nearest-neighbour visiting order from a start point; returns ids in order. */
export function suggestRouteOrder<T extends { id: string; lat: number | null; lng: number | null }>(
  start: { lat: number; lng: number } | null,
  stops: T[],
): string[] {
  const located = stops.filter((s) => s.lat != null && s.lng != null) as (T & { lat: number; lng: number })[];
  const unlocated = stops.filter((s) => s.lat == null || s.lng == null).map((s) => s.id);
  const order: string[] = [];
  let cur = start ?? (located[0] ? { lat: located[0].lat, lng: located[0].lng } : null);
  const left = [...located];
  while (left.length && cur) {
    let best = 0;
    let bestD = Infinity;
    left.forEach((s, k) => {
      const d = distanceMetres(cur!, s);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    });
    const [next] = left.splice(best, 1);
    order.push(next.id);
    cur = { lat: next.lat, lng: next.lng };
  }
  return [...order, ...unlocated];
}
