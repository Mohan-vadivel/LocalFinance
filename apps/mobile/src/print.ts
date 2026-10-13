import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { TFunction } from 'i18next';
import type { DayCustomer, RouteDay } from './store';
import { formatINR } from '@localfinance/shared';
import { dateIN } from './ui';

/** Printed receipts and sheets keep the full rupees-and-paise figure. */
const money = (p: number | null | undefined) => (p == null ? '-' : formatINR(p));

/** Escapes text for the HTML handed to the print module. */
export const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** `2026-10-05T04:30:00Z` → `05-10-2026 10:00` (IST). */
export const istStamp = (iso: string) => {
  const d = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return `${dateIN(d.slice(0, 10))} ${d.slice(11, 16)}`;
};

// =====================================================================
// Receipt: a narrow 58mm slip for the small Bluetooth printers agents carry. It goes through Android's own print
// dialog, so any printer whose maker installs an Android print service works; no Bluetooth code in the app.
// =====================================================================
export interface ReceiptData {
  business: string;
  receiptNo: string | null;
  customer: string;
  customerCode?: string;
  loanNumber: string;
  amount: number;
  mode: string;
  upiRef?: string | null;
  at: string;
  /** Balance on the loan after this payment, when known. */
  balance: number | null;
  agent: string;
  footer?: string | null;
}

/** 58mm paper at 72 points per inch. */
const RECEIPT_WIDTH = 164;

export function receiptHtml(r: ReceiptData, t: TFunction) {
  const line = (label: string, value: string, strong = false) =>
    `<tr><td class="l">${esc(label)}</td><td class="v${strong ? ' s' : ''}">${esc(value)}</td></tr>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: 58mm auto; margin: 2mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 54mm; font-family: sans-serif; font-size: 9pt; color: #000; }
  h1 { font-size: 11pt; text-align: center; margin: 0 0 1mm; }
  h2 { font-size: 9pt; text-align: center; margin: 0 0 2mm; font-weight: normal; text-transform: uppercase; letter-spacing: .5pt; }
  .amt { font-size: 16pt; font-weight: bold; text-align: center; margin: 2mm 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: .6mm 0; vertical-align: top; }
  td.l { color: #333; padding-right: 1.5mm; }
  td.v { text-align: right; word-break: break-word; }
  td.s { font-weight: bold; }
  hr { border: 0; border-top: 1px dashed #000; margin: 2mm 0; }
  .foot { text-align: center; margin-top: 2mm; }
</style></head><body>
<h1>${esc(r.business)}</h1>
<h2>${esc(t('receipt.title'))}</h2>
<hr>
<table>
${line(t('collection.receiptNo'), r.receiptNo ?? t('mobile.receiptPending'), true)}
${line(t('common.date'), istStamp(r.at))}
${line(t('common.customer'), r.customerCode ? `${r.customer} (${r.customerCode})` : r.customer)}
${line(t('common.loan'), r.loanNumber)}
</table>
<div class="amt">${esc(money(r.amount))}</div>
<table>
${line(t('common.mode'), `${t(`common.modes.${r.mode}`)}${r.upiRef ? ` · ${r.upiRef}` : ''}`)}
${r.balance != null ? line(t('print.outstandingAfter'), money(r.balance), true) : ''}
${line(t('print.collectedBy'), r.agent)}
</table>
<hr>
<div class="foot">${esc(r.footer || t('receipt.thanks'))}</div>
</body></html>`;
}

/** Opens Android's print dialog for one receipt. Returns false when printing is not possible or was cancelled. */
export async function printReceipt(r: ReceiptData, t: TFunction) {
  try {
    await Print.printAsync({ html: receiptHtml(r, t), width: RECEIPT_WIDTH });
    return true;
  } catch {
    return false;
  }
}

// =====================================================================
// Line sheet: one route's customers as a PDF, made on the phone and shared through the system share sheet.
// =====================================================================
export const SHEET_COLUMNS = ['seq', 'code', 'name', 'phone', 'address', 'loan', 'instalment', 'dueNow', 'arrears', 'outstanding', 'paidToday', 'collected', 'sign'] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export const DEFAULT_COLUMNS: SheetColumn[] = ['seq', 'name', 'phone', 'loan', 'instalment', 'dueNow', 'outstanding', 'collected'];

export interface SheetOptions {
  columns: SheetColumn[];
  groupByArea: boolean;
  landscape: boolean;
  order: 'route' | 'name';
}

/** Column headings; the last two are empty boxes to fill in by hand on the round. */
export const columnLabel = (c: SheetColumn, t: TFunction) =>
  ({
    seq: '#',
    code: t('mobile.sheet.cols.code'),
    name: t('common.name'),
    phone: t('common.phone'),
    address: t('common.address'),
    loan: t('common.loan'),
    instalment: t('loanMod.instalment'),
    dueNow: t('collection.dueNow'),
    arrears: t('collection.arrears'),
    outstanding: t('loanMod.outstanding'),
    paidToday: t('mobile.paidToday'),
    collected: t('mobile.sheet.cols.collected'),
    sign: t('print.signature'),
  })[c];

const MONEY_COLS: SheetColumn[] = ['instalment', 'dueNow', 'arrears', 'outstanding', 'paidToday'];

function cell(c: SheetColumn, x: DayCustomer, i: number) {
  const sum = (f: (l: DayCustomer['loans'][number]) => number) => x.loans.reduce((s, l) => s + f(l), 0);
  switch (c) {
    case 'seq':
      return String(x.routeSeq ?? i + 1);
    case 'code':
      return x.code;
    case 'name':
      return x.name;
    case 'phone':
      return x.phone;
    case 'address':
      return [x.address, x.landmark].filter(Boolean).join(', ');
    case 'loan':
      return x.loans.map((l) => l.number).join(', ');
    case 'instalment':
      return money(sum((l) => l.instalmentAmount));
    case 'dueNow':
      return money(x.dueNow);
    case 'arrears':
      return money(sum((l) => l.arrears));
    case 'outstanding':
      return money(sum((l) => l.outstanding));
    case 'paidToday':
      return x.paidToday ? money(x.paidToday) : '';
    default:
      return '';
  }
}

export function sortedCustomers(day: RouteDay, order: SheetOptions['order']) {
  const list = [...day.customers];
  if (order === 'name') list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => (a.routeSeq ?? 1e9) - (b.routeSeq ?? 1e9) || a.name.localeCompare(b.name));
  return list;
}

export function lineSheetHtml(day: RouteDay, opt: SheetOptions, meta: { business: string; printedBy: string }, t: TFunction) {
  const cols = SHEET_COLUMNS.filter((c) => opt.columns.includes(c));
  const list = sortedCustomers(day, opt.order);
  const position = new Map(day.customers.map((c, i) => [c.id, i]));
  const groups: { area: string | null; rows: DayCustomer[] }[] = [];
  if (opt.groupByArea) {
    for (const c of list) {
      const area = c.area ?? day.route.location ?? '-';
      let g = groups.find((x) => x.area === area);
      if (!g) groups.push((g = { area, rows: [] }));
      g.rows.push(c);
    }
    groups.sort((a, b) => (a.area ?? '').localeCompare(b.area ?? ''));
  } else groups.push({ area: null, rows: list });

  const total = (rows: DayCustomer[], c: SheetColumn) => {
    const pick: Partial<Record<SheetColumn, (x: DayCustomer) => number>> = {
      instalment: (x) => x.loans.reduce((s, l) => s + l.instalmentAmount, 0),
      dueNow: (x) => x.dueNow,
      arrears: (x) => x.loans.reduce((s, l) => s + l.arrears, 0),
      outstanding: (x) => x.loans.reduce((s, l) => s + l.outstanding, 0),
      paidToday: (x) => x.paidToday,
    };
    const f = pick[c];
    return f ? money(rows.reduce((s, x) => s + f(x), 0)) : '';
  };
  const head = `<tr>${cols.map((c) => `<th class="${MONEY_COLS.includes(c) ? 'n' : ''} c-${c}">${esc(columnLabel(c, t))}</th>`).join('')}</tr>`;
  const body = groups
    .map((g) => {
      const rows = g.rows
        .map((x) => `<tr>${cols.map((c) => `<td class="${MONEY_COLS.includes(c) ? 'n' : ''} c-${c}">${esc(cell(c, x, position.get(x.id) ?? 0))}</td>`).join('')}</tr>`)
        .join('');
      const foot = `<tr class="tot">${cols.map((c, i) => `<td class="${MONEY_COLS.includes(c) ? 'n' : ''}">${i === 0 ? esc(`${t('common.total')} (${g.rows.length})`) : esc(total(g.rows, c))}</td>`).join('')}</tr>`;
      return `${g.area != null ? `<h3>${esc(t('common.location'))}: ${esc(g.area)}</h3>` : ''}<table><thead>${head}</thead><tbody>${rows}${foot}</tbody></table>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  @page { size: A4 ${opt.landscape ? 'landscape' : 'portrait'}; margin: 10mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: sans-serif; font-size: 9pt; color: #111; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #0f766e; padding-bottom: 2mm; margin-bottom: 3mm; gap: 4mm; }
  h1 { font-size: 14pt; margin: 0; }
  h2 { font-size: 11pt; margin: 1mm 0 0; font-weight: normal; }
  .meta { text-align: right; color: #444; font-size: 8.5pt; }
  h3 { font-size: 10pt; margin: 4mm 0 1.5mm; color: #0b4f4a; }
  table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  th { background: #ddf1ed; text-align: left; font-weight: bold; }
  th, td { border: 1px solid #9aa9a6; padding: 1.4mm 1.6mm; vertical-align: top; }
  .n { text-align: right; white-space: nowrap; }
  .c-seq { width: 8mm; text-align: center; }
  .c-collected, .c-sign { min-width: 22mm; }
  tr.tot td { font-weight: bold; background: #f3f6f5; }
  tr:nth-child(even) td { background: #fafcfb; }
</style></head><body>
<header>
  <div><h1>${esc(meta.business)}</h1><h2>${esc(t('mobile.sheet.title'))}: ${esc(day.route.name)}${day.route.location ? ` · ${esc(day.route.location)}` : ''}</h2></div>
  <div class="meta">${esc(t('common.date'))}: ${esc(dateIN(day.date))}<br>${esc(t('print.printedOn'))}: ${esc(istStamp(new Date().toISOString()))}<br>${esc(meta.printedBy)}</div>
</header>
${list.length ? body : `<p>${esc(t('common.noData'))}</p>`}
</body></html>`;
}

/** A4 in points (72 per inch). */
const A4 = { w: 595, h: 842 };

/** Makes the PDF on the phone and opens the share sheet (WhatsApp, Drive, a printer app, Files…). */
export async function shareLineSheet(html: string, landscape: boolean, title: string) {
  const { uri } = await Print.printToFileAsync({ html, width: landscape ? A4.h : A4.w, height: landscape ? A4.w : A4.h });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: title, UTI: 'com.adobe.pdf' });
    return { uri, shared: true };
  }
  return { uri, shared: false };
}

/** Prints the line sheet straight away (or saves it as PDF from the print dialog). */
export async function printLineSheet(html: string, landscape: boolean) {
  await Print.printAsync({ html, width: landscape ? A4.h : A4.w, height: landscape ? A4.w : A4.h, orientation: landscape ? Print.Orientation.landscape : Print.Orientation.portrait });
}
