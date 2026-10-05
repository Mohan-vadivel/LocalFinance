import { describe, expect, it } from 'vitest';
import { nameKey, parseSpokenEntry, riskScore, smartVisitOrder } from './ai';

const base = { loans: 3, closedLoans: 2, onTimeRatio: 0.95, recentOnTimeRatio: 1, missed: 0, maxDaysLate: 2, currentDaysPastDue: 0, writtenOff: 0, blacklisted: false, activeLoans: 1 };

describe('risk score', () => {
  it('rates a punctual repeat customer highly and says why', () => {
    const r = riskScore(base);
    expect(r.grade).toBe('A');
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.reasons.map((x) => x.key)).toEqual(expect.arrayContaining(['onTimeHigh', 'repaidBefore']));
  });
  it('drops for a recent slip, current lateness and a much bigger ask', () => {
    const r = riskScore({ ...base, recentOnTimeRatio: 0.5, currentDaysPastDue: 12, requested: 5_000_000, largestRepaid: 2_000_000 });
    expect(r.score!).toBeLessThan(riskScore(base).score!);
    expect(r.reasons[0].tone).toBe('bad');
    expect(r.reasons.map((x) => x.key)).toEqual(expect.arrayContaining(['recentSlip', 'lateNow', 'biggerThanBefore']));
  });
  it('caps written-off and blacklisted customers at D', () => {
    expect(riskScore({ ...base, writtenOff: 1 }).grade).toBe('D');
    expect(riskScore({ ...base, blacklisted: true }).grade).toBe('D');
  });
  it('has no score for a new customer', () => {
    expect(riskScore({ ...base, loans: 0, closedLoans: 0 })).toMatchObject({ score: null, grade: 'NEW' });
  });
});

describe('spoken collection entry', () => {
  const route = [
    { id: '1', name: 'Murugan S', code: 'C0001' },
    { id: '2', name: 'Lakshmi Devi', code: 'C0002' },
    { id: '3', name: 'Arumugam', code: 'C0003' },
    { id: '4', name: 'Selvi', code: 'C0004' },
  ];
  it('reads an English name and digits', () => {
    const r = parseSpokenEntry('Murugan 500', route);
    expect(r.amount).toBe(50_000);
    expect(r.matches[0].customer.id).toBe('1');
  });
  it('reads a Tamil name against an English one, with a Tamil amount', () => {
    const r = parseSpokenEntry('முருகன் ஐநூறு ரூபாய்', route);
    expect(r.amount).toBe(50_000);
    expect(r.matches[0].customer.id).toBe('1');
  });
  it('reads Tamil compound amounts', () => {
    expect(parseSpokenEntry('லட்சுமி ஆயிரத்து ஐநூறு', route)).toMatchObject({ amount: 150_000 });
    expect(parseSpokenEntry('செல்வி இரண்டு ஆயிரம்', route).amount).toBe(200_000);
    expect(parseSpokenEntry('Selvi ஐநூற்று ஐம்பது', route).amount).toBe(55_000);
    // The everyday spoken form ends in -றி rather than -று.
    expect(parseSpokenEntry('Selvi நூற்றி இருபது', route)).toMatchObject({ amount: 12_000, heard: 'Selvi' });
    expect(parseSpokenEntry('Selvi இருநூற்றி ஐம்பது', route).amount).toBe(25_000);
  });
  it('reads English number words and rupee symbols', () => {
    expect(parseSpokenEntry('Lakshmi one thousand two hundred', route).amount).toBe(120_000);
    expect(parseSpokenEntry('Selvi ₹1,500', route).amount).toBe(150_000);
  });
  it('does not mistake a name that starts like a number for an amount', () => {
    const r = parseSpokenEntry('ஆறுமுகம் 300', route);
    expect(r.amount).toBe(30_000);
    expect(r.matches[0].customer.id).toBe('3');
  });
  it('matches by customer code and returns no match for a stranger', () => {
    expect(parseSpokenEntry('C0004 200', route).matches[0].customer.id).toBe('4');
    expect(parseSpokenEntry('Rajkumar 200', route).matches).toEqual([]);
  });
  it('forgives spelling differences', () => {
    expect(nameKey('Lakshmi')).toBe(nameKey('Laksmi'));
    expect(nameKey('Selvi')).toBe(nameKey('செல்வி'));
  });
});

describe('smart visit order', () => {
  const stop = (id: string, extra: Partial<Parameters<typeof smartVisitOrder>[0][0]> = {}) => ({ id, lat: null, lng: null, pin: 'PENDING', dueNow: 10000, daysPastDue: 0, ...extra });
  it('puts promises and late customers first and finished ones last', () => {
    const plan = smartVisitOrder(
      [stop('paid', { pin: 'PAID', dueNow: 0 }), stop('plain'), stop('late', { daysPastDue: 15 }), stop('promise', { promiseDate: '2026-10-05' })],
      { today: '2026-10-05', hour: 9 },
    );
    expect(plan.map((p) => p.id)).toEqual(['promise', 'late', 'plain', 'paid']);
    expect(plan[0].reasons[0].key).toBe('promiseToday');
    expect(plan[3].reasons[0].key).toBe('done');
  });
  it('moves up someone who usually pays around now', () => {
    const plan = smartVisitOrder([stop('a'), stop('b', { usualHour: 10 })], { today: '2026-10-05', hour: 9 });
    expect(plan[0]).toMatchObject({ id: 'b', reasons: [{ key: 'usualTime', values: { hour: 10 } }] });
  });
  it('goes nearest-first inside the same priority', () => {
    const plan = smartVisitOrder(
      [stop('far', { lat: 13.1, lng: 80.3 }), stop('near', { lat: 13.0001, lng: 80.0001 })],
      { today: '2026-10-05', hour: 9, here: { lat: 13, lng: 80 } },
    );
    expect(plan.map((p) => p.id)).toEqual(['near', 'far']);
  });
});
