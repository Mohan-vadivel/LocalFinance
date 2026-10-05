import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { FileSpreadsheet, Inbox, Printer } from 'lucide-react';
import { weekday } from '@localfinance/shared';
import { BranchPicker, RoutePicker } from '../components/pickers';
import { ErrorBox, Loading } from '../components/ui';
import { get } from '../lib/api';
import { dateIN, money, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Row {
  loanId: string;
  loan: string;
  customerId: string;
  customer: string;
  code: string;
  phone: string;
  route: string;
  routeSeq: number | null;
  principal: number;
  instalment: number;
  loanDate: string;
  closedOn: string | null;
  status: string;
  opening: number;
  daily: number[];
  total: number;
  closing: number;
}
interface LineListData {
  from: string;
  to: string;
  route: { id: string; name: string } | null;
  days: string[];
  rows: Row[];
  totals: { opening: number; daily: number[]; total: number; closing: number };
}

/** Day cells are rupees without the symbol so 31 of them fit on a landscape page; blank when nothing was collected. */
const cell = (paise: number) => (paise ? (paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '');

// Page-only rules: compact cells, the customer column stays in view while scrolling, landscape when printed.
const CSS = `
.line-list table.data th, .line-list table.data td { padding: 6px 8px; }
.line-list table.data td.day, .line-list table.data th.day { padding: 6px 5px; min-width: 44px; }
.line-list table.data th.day.sun, .line-list table.data td.day.sun { background: var(--panel-3); }
.line-list table.data .stick { position: sticky; left: 0; z-index: 2; background: var(--panel); box-shadow: inset -1px 0 0 var(--line); white-space: nowrap; }
.line-list table.data thead .stick { z-index: 3; background: var(--panel-2); }
.line-list table.data tfoot td { font-weight: 650; background: var(--panel-2); border-top: 1px solid var(--line-strong); }
.line-list .closed { color: var(--muted); }
@media print {
  @page { size: A4 landscape; margin: 6mm; }
  .line-list table.data, .line-list table.data th { font-size: 7.5px; }
  .line-list h1 { display: none; }
  .line-list table.data th, .line-list table.data td, .line-list table.data td.day, .line-list table.data th.day { padding: 2px 3px; min-width: 0; }
  .line-list table.data .stick { position: static; box-shadow: none; }
  .line-list table.data th.day.sun, .line-list table.data td.day.sun { background: #f1f5f9; }
}
`;

/** Line list: one line's month sheet, a row per loan in route order and a column per day of the month. */
export default function LineList() {
  const { t, i18n } = useTranslation();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const [routeId, setRouteId] = useState('');
  const { data, error, loading } = useLoad(() => get<LineListData>('/reports/line-list', { month, branchId, routeId }), [month, branchId, routeId]);

  const monthName = new Date(`${month}-01T00:00:00Z`).toLocaleString(i18n.language === 'ta' ? 'ta-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const showRoute = !data?.route;
  const title = `${t('lineList.title')} · ${data?.route?.name ?? t('lineList.allLines')} · ${monthName}`;

  const exportExcel = () => {
    if (!data) return;
    const r = (p: number) => p / 100;
    const sheet = data.rows.map((x, i) => ({
      '#': x.routeSeq ?? i + 1,
      ...(showRoute ? { [t('reportCols.route')]: x.route } : {}),
      [t('reportCols.loan')]: x.loan,
      [t('reportCols.customer')]: x.customer,
      [t('reportCols.phone')]: x.phone,
      [t('reportCols.principal')]: r(x.principal),
      [t('reportCols.instalment')]: r(x.instalment),
      [t('lineList.loanDate')]: dateIN(x.loanDate),
      [t('lineList.opening')]: r(x.opening),
      ...Object.fromEntries(data.days.map((d, j) => [String(Number(d.slice(8))), x.daily[j] ? r(x.daily[j]) : ''])),
      [t('lineList.monthTotal')]: r(x.total),
      [t('lineList.closing')]: r(x.closing),
      [t('lineList.closed')]: x.closedOn ? dateIN(x.closedOn) : '',
    }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), month);
    XLSX.writeFile(wb, `${title.replace(/[^\w\- ]+/g, '').trim() || 'line-list'} ${month}.xlsx`);
  };

  const lead = showRoute ? 8 : 7; // columns before the day columns

  return (
    <div className="line-list">
      <style>{CSS}</style>
      <div className="page-head">
        <h1>{t('lineList.title')}</h1>
      </div>
      <div className="card no-print">
        <div className="row">
          <label className="field inline">{t('abstract.month')}<input type="month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
          <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setRouteId(''); }} allowAll />
          <RoutePicker branchId={branchId || undefined} value={routeId} onChange={setRouteId} allowAll />
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <div className="card">
          <div className="dt-toolbar no-print">
            <h3>{title}</h3>
            <span className="count-pill">{data.rows.length}</span>
            <span className="spacer" />
            <button className="btn small" onClick={exportExcel} disabled={!data.rows.length}>
              <FileSpreadsheet aria-hidden />
              {t('common.exportExcel')}
            </button>
            <button className="btn small" onClick={() => window.print()} disabled={!data.rows.length}>
              <Printer aria-hidden />
              {t('common.exportPdf')}
            </button>
          </div>
          <h3 className="print-only">{title}</h3>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th className="stick">{t('reportCols.customer')}</th>
                  {showRoute && <th>{t('reportCols.route')}</th>}
                  <th>{t('reportCols.loan')}</th>
                  <th>{t('reportCols.phone')}</th>
                  <th className="num">{t('reportCols.principal')}</th>
                  <th className="num">{t('reportCols.instalment')}</th>
                  <th>{t('lineList.loanDate')}</th>
                  <th className="num">{t('lineList.opening')}</th>
                  {data.days.map((d) => (
                    <th key={d} className={`num day${weekday(d) === 0 ? ' sun' : ''}`} title={`${dateIN(d)} ${t(`weekdays.${weekday(d)}`)}`}>
                      {Number(d.slice(8))}
                    </th>
                  ))}
                  <th className="num">{t('lineList.monthTotal')}</th>
                  <th className="num">{t('lineList.closing')}</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r, i) => (
                  <tr key={r.loanId} className={r.closedOn ? 'closed' : undefined}>
                    <td className="stick">
                      <span className="muted">{r.routeSeq ?? i + 1}.</span> {r.customer}
                      {r.closedOn && <div className="muted" style={{ fontSize: 11 }}>{t('lineList.closed')} {dateIN(r.closedOn)}</div>}
                    </td>
                    {showRoute && <td style={{ whiteSpace: 'nowrap' }}>{r.route}</td>}
                    <td style={{ whiteSpace: 'nowrap' }}>{r.loan}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{r.phone}</td>
                    <td className="num">{money(r.principal)}</td>
                    <td className="num">{money(r.instalment)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{dateIN(r.loanDate)}</td>
                    <td className="num">{money(r.opening)}</td>
                    {r.daily.map((a, j) => (
                      <td key={data.days[j]} className={`num day${weekday(data.days[j]) === 0 ? ' sun' : ''}`}>{cell(a)}</td>
                    ))}
                    <td className="num">{money(r.total)}</td>
                    <td className="num">{money(r.closing)}</td>
                  </tr>
                ))}
                {!data.rows.length && (
                  <tr>
                    <td colSpan={lead + data.days.length + 2} className="empty">
                      <div className="empty-state">
                        <span className="ico"><Inbox aria-hidden /></span>
                        <span>{t('common.noData')}</span>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
              {data.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <td className="stick">{t('common.total')}</td>
                    <td colSpan={lead - 2} />
                    <td className="num">{money(data.totals.opening)}</td>
                    {data.totals.daily.map((a, j) => (
                      <td key={data.days[j]} className={`num day${weekday(data.days[j]) === 0 ? ' sun' : ''}`}>{cell(a)}</td>
                    ))}
                    <td className="num">{money(data.totals.total)}</td>
                    <td className="num">{money(data.totals.closing)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
