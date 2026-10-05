import { z } from 'zod';

/**
 * Bringing customers and running loans over from another system (Excel or CSV). The web app maps the sheet's
 * columns to these fields and sends the raw cell values; the API parses and checks them with the helpers below,
 * so the preview and the import agree.
 */
export const IMPORT_FIELDS = [
  'accountNo',
  'name',
  'nameTamil',
  'phone',
  'altPhone',
  'address',
  'occupation',
  'idNumber',
  'line',
  'loanAmount',
  'totalPayable',
  'loanDate',
  'instalment',
  'tenure',
  'firstDueDate',
  'maturityDate',
  'received',
  'balance',
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
export const IMPORT_REQUIRED: ImportField[] = ['accountNo', 'name', 'phone', 'loanAmount', 'loanDate'];
export const IMPORT_MAX_ROWS = 5000;

const cell = z.union([z.string().max(500), z.number()]).nullable().optional();
export const importRowSchema = z.object({
  /** Row number in the spreadsheet, for messages. */
  rowNo: z.number().int().positive(),
  ...(Object.fromEntries(IMPORT_FIELDS.map((f) => [f, cell])) as Record<ImportField, typeof cell>),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export const importRequestSchema = z.object({
  /** Branch of the default line; also preferred when a line name exists in more than one branch. */
  branchId: z.string().min(1).optional().nullable(),
  /** Line (route) for rows without a Line column value. */
  routeId: z.string().min(1).optional().nullable(),
  productId: z.string().min(1),
  /** Fund that future collections on the imported loans are paid into (optional). */
  fundId: z.string().min(1).optional().nullable(),
  fileName: z.string().max(200).optional().nullable(),
  /** Import the good rows and leave out rows with errors (otherwise any error stops the import). */
  skipErrors: z.boolean().default(false),
  rows: z.array(importRowSchema).min(1).max(IMPORT_MAX_ROWS),
});
export type ImportRequest = z.infer<typeof importRequestSchema>;

const blank = (v: unknown) => v == null || (typeof v === 'string' && v.trim() === '');

export function importText(v: string | number | null | undefined): string | null {
  if (blank(v)) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  // Spreadsheets turn account numbers like 12 into 12.0 sometimes.
  return typeof v === 'number' && Number.isInteger(v) ? String(v) : s;
}

/** Rupees as typed in a sheet ("1,000", "₹ 1000.50", 1000) to paise. null when blank, NaN when not a number. */
export function importAmount(v: string | number | null | undefined): number | null {
  if (blank(v)) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  const s = v!.replace(/(rs\.?|inr|₹|,|\s|\/-)/gi, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}

/** A whole number (instalment count). null when blank, NaN when not a whole number. */
export function importCount(v: string | number | null | undefined): number | null {
  if (blank(v)) return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, '') || 'x');
  return Number.isInteger(n) ? n : NaN;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n: number) => String(n).padStart(2, '0');
function ymd(y: number, m: number, d: number): string | 'invalid' {
  if (y < 100) y += 2000;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100) return 'invalid';
  return `${y}-${pad2(m)}-${pad2(d)}`;
}

/**
 * Dates as Indian sheets have them: DD-MM-YYYY, DD/MM/YY, DD.MM.YYYY, 05-Jan-2026, YYYY-MM-DD, or an Excel date
 * serial number. null when blank, 'invalid' when it cannot be read.
 */
export function importDate(v: string | number | null | undefined): string | null | 'invalid' {
  if (blank(v)) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v < 20000 || v > 80000) return 'invalid';
    // Excel serial: days since 1899-12-30.
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  const s = v!.trim().replace(/[ T]\d{1,2}:\d{2}.*$/, ''); // drop a time part
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return ymd(+m[3], +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/. ]?([a-z]{3})[a-z]*[-/. ,]*(\d{2}|\d{4})$/i);
  if (m && MONTHS.includes(m[2].toLowerCase())) return ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  if (/^\d{5}(\.\d+)?$/.test(s)) return importDate(Number(s));
  return 'invalid';
}

/** Phone to the form the app stores: digits only, Indian +91 / 0 prefixes removed. */
export function importPhone(v: string | number | null | undefined): string | null {
  if (blank(v)) return null;
  let d = String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

export const hasTamil = (s: string) => /[஀-௿]/.test(s);
