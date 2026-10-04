import { formatINR } from '@localfinance/shared';

export const money = (paise: number | null | undefined) => (paise == null ? '-' : formatINR(paise));
/** Rupees typed in a form to paise. */
export const toPaise = (rupees: string | number) => Math.round(Number(rupees || 0) * 100);
export const toRupeesInput = (paise: number | null | undefined) => (paise == null ? '' : String(paise / 100));
export const dateIN = (d: string | null | undefined) => {
  if (!d) return '-';
  const s = d.slice(0, 10);
  return `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`;
};
export const dateTime = (d: string | null | undefined) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '-');
export const pct = (n: number | null | undefined) => (n == null ? '-' : `${n}%`);
export const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const monthStart = () => today().slice(0, 8) + '01';
