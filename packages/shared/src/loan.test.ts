import { describe, expect, it } from 'vitest';
import {
  allocatePayment,
  dueDates,
  generateSchedule,
  loanPosition,
  penaltyCharged,
  riskGrade,
  suggestRouteOrder,
  summarize,
  type InstalmentState,
} from './loan';
import { formatINR } from './money';
import { missingKeys, translate } from './i18n';

const st = (rows: ReturnType<typeof generateSchedule>): InstalmentState[] =>
  rows.map((r) => ({ id: String(r.seq), seq: r.seq, dueDate: r.dueDate, principalDue: r.principalDue, interestDue: r.interestDue, principalPaid: 0, interestPaid: 0 }));

describe('schedules', () => {
  it('daily flat: 10,000 at 20% over 100 days sums exactly', () => {
    const terms = { principal: 1_000_000, frequency: 'DAILY' as const, tenure: 100, interestMethod: 'FLAT' as const, interestRate: 20 };
    const rows = generateSchedule(terms, '2026-10-05');
    expect(rows).toHaveLength(100);
    expect(rows.reduce((s, r) => s + r.principalDue, 0)).toBe(1_000_000);
    expect(rows.reduce((s, r) => s + r.interestDue, 0)).toBe(200_000);
    expect(rows[0].totalDue).toBe(12_000);
    // Sundays skipped by default
    expect(rows.every((r) => new Date(r.dueDate).getUTCDay() !== 0)).toBe(true);
  });

  it('daily skips holidays', () => {
    const d = dueDates('2026-10-05', 'DAILY', 3, { holidays: ['2026-10-06'] });
    expect(d).toEqual(['2026-10-05', '2026-10-07', '2026-10-08']);
  });

  it('monthly clamps to month end and moves off Sundays', () => {
    const d = dueDates('2026-01-31', 'MONTHLY', 3, { workingDays: [0, 1, 2, 3, 4, 5, 6] });
    expect(d).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
  });

  it('reducing balance EMI repays principal exactly', () => {
    const terms = { principal: 5_000_000, frequency: 'MONTHLY' as const, tenure: 12, interestMethod: 'REDUCING' as const, interestRate: 24 };
    const rows = generateSchedule(terms, '2026-11-01');
    expect(rows.reduce((s, r) => s + r.principalDue, 0)).toBe(5_000_000);
    expect(rows[0].interestDue).toBe(100_000); // 2% of 50,000
    expect(rows[0].interestDue).toBeGreaterThan(rows[11].interestDue);
  });

  it('upfront deduction: hand over 9,000, collect 10,000', () => {
    const s = summarize({ principal: 1_000_000, frequency: 'DAILY', tenure: 100, interestMethod: 'UPFRONT', interestRate: 10 });
    expect(s.netDisbursed).toBe(900_000);
    expect(s.totalRepayable).toBe(1_000_000);
  });

  it('rejects fees bigger than the loan', () => {
    expect(() => summarize({ principal: 1000, frequency: 'DAILY', tenure: 10, interestMethod: 'UPFRONT', interestRate: 90, feePercent: 20 })).toThrow();
  });
});

describe('payments', () => {
  const rows = st(generateSchedule({ principal: 100_000, frequency: 'WEEKLY', tenure: 4, interestMethod: 'FLAT', interestRate: 20 }, '2026-10-05'));

  it('fills oldest instalment first, interest before principal, penalty first', () => {
    const a = allocatePayment(36_000, rows, 1_000);
    expect(a.penalty).toBe(1_000);
    expect(a.perInstalment[0]).toMatchObject({ interest: 5_000, principal: 25_000, fullyPaid: true });
    expect(a.perInstalment[1]).toMatchObject({ interest: 5_000, principal: 0, fullyPaid: false });
  });

  it('penalty last when configured', () => {
    const a = allocatePayment(25_000, rows, 1_000, 'PENALTY_LAST');
    expect(a.penalty).toBe(0);
    expect(a.interest + a.principal).toBe(25_000);
  });

  it('refuses overpayment', () => {
    expect(() => allocatePayment(200_000, rows, 0)).toThrow(/exceeds/);
  });

  it('penalty per day after grace, stops when paid', () => {
    const r = [{ ...rows[0], paidOn: '2026-10-10' }, rows[1]];
    const p = penaltyCharged(r, { type: 'FIXED_PER_DAY', value: 100, graceDays: 2 }, '2026-10-15');
    // first: paid 5 days late - 2 grace = 3 days; second due 10-12, 3 days - 2 = 1 day
    expect(p).toBe(400);
  });

  it('position shows overdue and days past due', () => {
    const pos = loanPosition(rows, { charged: 500, paid: 0, waived: 0 }, '2026-10-12');
    expect(pos.overdue).toBe(30_000);
    expect(pos.dueToday).toBe(30_000);
    expect(pos.daysPastDue).toBe(7);
    expect(pos.totalOutstanding).toBe(120_500);
  });
});

describe('misc', () => {
  it('formats Indian rupees', () => {
    expect(formatINR(12_345_678_90)).toBe('₹1,23,45,678.90');
    expect(formatINR(50_000)).toBe('₹500.00');
  });
  it('grades risk', () => {
    expect(riskGrade({ loans: 0, onTimeRatio: 0, maxDaysLate: 0, writtenOff: 0 })).toBe('NEW');
    expect(riskGrade({ loans: 2, onTimeRatio: 0.95, maxDaysLate: 3, writtenOff: 0 })).toBe('A');
    expect(riskGrade({ loans: 1, onTimeRatio: 1, maxDaysLate: 0, writtenOff: 1 })).toBe('D');
  });
  it('orders route by nearest neighbour', () => {
    const order = suggestRouteOrder({ lat: 9.9, lng: 78.1 }, [
      { id: 'far', lat: 9.95, lng: 78.15 },
      { id: 'near', lat: 9.901, lng: 78.101 },
      { id: 'nogps', lat: null, lng: null },
    ]);
    expect(order).toEqual(['near', 'far', 'nogps']);
  });
});

describe('language files', () => {
  it('Tamil has every English key', () => {
    expect(missingKeys('ta')).toEqual([]);
  });
  it('translates with placeholders and falls back to English', () => {
    expect(translate('ta', 'common.save')).toBe('சேமி');
    expect(translate('xx', 'common.save')).toBe('Save');
    expect(translate('en', 'receipt.body', { amount: '₹100', customer: 'Ravi', loan: 'L1', date: '2026-10-04', balance: '₹0', receipt: 'R1' })).toContain('Ravi');
  });
});
