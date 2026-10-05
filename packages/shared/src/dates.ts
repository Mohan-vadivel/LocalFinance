/** Date-only helpers on 'YYYY-MM-DD' strings, computed in UTC so time zones never shift a day. */
const DAY = 86_400_000;

export const parseDate = (d: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error(`Invalid date: ${d}`);
  return new Date(`${d}T00:00:00.000Z`);
};
export const fmtDate = (d: Date): string => d.toISOString().slice(0, 10);
export const addDays = (d: string, n: number): string => fmtDate(new Date(parseDate(d).getTime() + n * DAY));
export const diffDays = (a: string, b: string): number => Math.round((parseDate(a).getTime() - parseDate(b).getTime()) / DAY);
export const weekday = (d: string): number => parseDate(d).getUTCDay();

export function addMonthsClamped(d: string, n: number, dayOfMonth: number): string {
  const base = parseDate(d);
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return fmtDate(new Date(Date.UTC(y, m, Math.min(dayOfMonth, lastDay))));
}

/** Today's date in India (IST), as YYYY-MM-DD. */
export const todayIST = (now: Date = new Date()): string => fmtDate(new Date(now.getTime() + 330 * 60_000));

export type SummaryPeriod = 'DAY' | 'WEEK' | 'MONTH';
/** The day, the Monday-to-Sunday week, or the calendar month that contains `d`. */
export function periodRange(period: SummaryPeriod, d: string): { from: string; to: string } {
  if (period === 'DAY') return { from: d, to: d };
  if (period === 'WEEK') {
    const from = addDays(d, -((weekday(d) + 6) % 7));
    return { from, to: addDays(from, 6) };
  }
  const from = d.slice(0, 8) + '01';
  return { from, to: addDays(addMonthsClamped(from, 1, 1), -1) };
}
