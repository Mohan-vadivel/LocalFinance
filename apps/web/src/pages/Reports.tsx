import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BranchPicker, LocationPicker, ProductPicker, RoutePicker, StaffPicker } from '../components/pickers';
import { DataTable, ErrorBox, Loading, Stat, type Column } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, money, monthStart, pct, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import type { Permission } from '@localfinance/shared';

type Row = Record<string, unknown>;
type Filter = 'location' | 'route' | 'agent' | 'product' | 'dates';
interface ReportDef {
  key: string;
  path: string;
  title: string;
  perm?: Permission;
  filters: Filter[];
  /** Column keys; money keys are listed in MONEY. */
  columns: string[];
}

const MONEY = new Set(['due', 'collected', 'cash', 'upi', 'principal', 'fee', 'upfrontInterest', 'netDisbursed', 'principalOutstanding', 'interestOutstanding', 'penalty', 'totalOutstanding', 'overdue', 'demand', 'amount', 'cashDifference', 'expected', 'received', 'difference', 'available', 'lentOut', 'interest', 'fees', 'upfront', 'total', 'interestWaived', 'writtenOff', 'outstanding']);
const SUM = new Set([...MONEY, 'customersDue', 'missed', 'collections', 'customersVisited', 'noPaymentVisits', 'flagged', 'activeLoans', 'customers', 'loans']);
const DATES = new Set(['date', 'disbursedOn', 'closedOn']);

export const REPORTS: ReportDef[] = [
  { key: 'dailyCollection', path: 'daily-collection', title: 'report.dailyCollection', filters: ['dates', 'location', 'route', 'agent'], columns: ['date', 'route', 'due', 'collected', 'cash', 'upi', 'customersDue', 'missed', 'rate'] },
  { key: 'demandVsCollection', path: 'demand-vs-collection', title: 'report.demandVsCollection', filters: ['dates', 'location', 'route', 'agent'], columns: ['date', 'demand', 'collected', 'rate'] },
  { key: 'disbursement', path: 'disbursements', title: 'report.disbursement', filters: ['dates', 'location', 'route', 'product'], columns: ['date', 'loan', 'customer', 'branch', 'product', 'principal', 'fee', 'upfrontInterest', 'netDisbursed', 'mode'] },
  { key: 'outstanding', path: 'outstanding', title: 'report.outstanding', filters: ['location', 'route', 'product'], columns: ['loan', 'customer', 'phone', 'location', 'route', 'product', 'disbursedOn', 'principal', 'principalOutstanding', 'interestOutstanding', 'penalty', 'totalOutstanding', 'overdue', 'daysPastDue'] },
  { key: 'ageing', path: 'ageing', title: 'report.ageing', filters: ['location', 'route', 'product'], columns: ['loan', 'customer', 'phone', 'route', 'totalOutstanding', 'overdue', 'daysPastDue'] },
  { key: 'agentPerformance', path: 'agent-performance', title: 'report.agentPerformance', filters: ['dates', 'agent'], columns: ['agent', 'collections', 'amount', 'cash', 'upi', 'customersVisited', 'noPaymentVisits', 'flagged', 'cashDifference'] },
  { key: 'cashDifference', path: 'cash-differences', title: 'report.cashDifference', filters: ['dates'], columns: ['date', 'branch', 'agent', 'expected', 'received', 'difference', 'note', 'verifiedBy'] },
  { key: 'fundUtilisation', path: 'fund-utilisation', title: 'report.fundUtilisation', filters: [], columns: ['fund', 'branch', 'source', 'available', 'lentOut', 'activeLoans', 'utilisation'] },
  { key: 'income', path: 'income', title: 'report.income', perm: 'pl.view', filters: ['dates'], columns: ['month', 'interest', 'fees', 'upfront', 'penalty', 'total'] },
  { key: 'closedLoans', path: 'closed-loans', title: 'report.closedLoans', filters: ['dates', 'location', 'route'], columns: ['closedOn', 'loan', 'customer', 'branch', 'status', 'principal', 'interestWaived', 'writtenOff'] },
  { key: 'locationWise', path: 'location-wise', title: 'report.locationWise', filters: ['dates'], columns: ['location', 'branch', 'customers', 'activeLoans', 'outstanding', 'overdue', 'collected'] },
  { key: 'investorStatement', path: 'investor-statement', title: 'report.investorStatement', perm: 'investor.manage', filters: ['dates'], columns: ['date', 'investor', 'type', 'amount', 'period', 'mode', 'note'] },
];

export default function Reports() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const visible = REPORTS.filter((r) => !r.perm || can(r.perm, 'pl.view'));
  const [key, setKey] = useState(visible[0]?.key ?? '');
  const def = visible.find((r) => r.key === key) ?? visible[0];
  const [f, setF] = useState({ from: monthStart(), to: today(), branchId: '', locationId: '', routeId: '', agentId: '', productId: '' });
  const [applied, setApplied] = useState(f);
  const params = {
    ...(def?.filters.includes('dates') ? { from: applied.from, to: applied.to } : {}),
    branchId: applied.branchId,
    locationId: def?.filters.includes('location') ? applied.locationId : undefined,
    routeId: def?.filters.includes('route') ? applied.routeId : undefined,
    agentId: def?.filters.includes('agent') ? applied.agentId : undefined,
    productId: def?.filters.includes('product') ? applied.productId : undefined,
  };
  const { data, error, loading } = useLoad(() => (def ? get<Row[] | { buckets: Row[]; loans: Row[] }>(`/reports/${def.path}`, params) : Promise.resolve([])), [def?.key, JSON.stringify(params)]);

  if (!def) return null;
  const rows = Array.isArray(data) ? data : data?.loans ?? [];
  const buckets = !Array.isArray(data) && data ? data.buckets : null;
  const label = (k: string) => t(`reportCols.${k}`);
  const columns: Column<Row>[] = def.columns.map((c) => ({
    key: c,
    label: label(c),
    money: MONEY.has(c),
    num: !MONEY.has(c) && ['rate', 'utilisation', 'daysPastDue', ...SUM].includes(c),
    total: SUM.has(c),
    value: (r) => {
      const v = r[c];
      if (c === 'type' && typeof v === 'string') return t(`investor.txnTypes.${v}`, { defaultValue: v });
      if (c === 'status' && typeof v === 'string') return t(`loanMod.statuses.${v}`, { defaultValue: v });
      if (c === 'source' && typeof v === 'string') return t(`fund.sourceTypes.${v}`, { defaultValue: v });
      if (c === 'mode' && typeof v === 'string') return t(`common.modes.${v}`, { defaultValue: v });
      if (DATES.has(c) && typeof v === 'string') return dateIN(v);
      if ((c === 'rate' || c === 'utilisation') && (typeof v === 'number' || v == null)) return pct(v as number | null);
      return v as string | number | null;
    },
  }));

  return (
    <div>
      <div className="page-head">
        <h1>{t('report.title')}</h1>
      </div>
      <div className="card no-print">
        <div className="row" style={{ marginBottom: 10 }}>
          <select value={def.key} onChange={(e) => setKey(e.target.value)} style={{ minWidth: 240 }}>
            {visible.map((r) => <option key={r.key} value={r.key}>{t(r.title)}</option>)}
          </select>
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
          {def.filters.includes('dates') && (
            <>
              <label className="field inline">{t('common.from')}<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
              <label className="field inline">{t('common.to')}<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
            </>
          )}
          <BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v, locationId: '', routeId: '' })} allowAll />
          {def.filters.includes('location') && <LocationPicker branchId={f.branchId || undefined} value={f.locationId} onChange={(v) => setF({ ...f, locationId: v, routeId: '' })} allowAll />}
          {def.filters.includes('route') && <RoutePicker branchId={f.branchId || undefined} locationId={f.locationId || undefined} value={f.routeId} onChange={(v) => setF({ ...f, routeId: v })} allowAll />}
          {def.filters.includes('agent') && <StaffPicker branchId={f.branchId || undefined} value={f.agentId} onChange={(v) => setF({ ...f, agentId: v })} allowAll />}
          {def.filters.includes('product') && <ProductPicker value={f.productId} onChange={(v) => setF({ ...f, productId: v })} allowAll />}
          <button className="btn primary">{t('report.run')}</button>
        </form>
      </div>
      <ErrorBox error={error} />
      {buckets && (
        <div className="grid k4" style={{ marginBottom: 16 }}>
          {buckets.map((b) => (
            <Stat key={String(b.bucket)} label={t(`report.buckets.${b.bucket}`)} value={money(b.overdue as number)} sub={`${b.loans} · ${t('loanMod.outstanding')} ${money(b.outstanding as number)}`} />
          ))}
        </div>
      )}
      <div className="card">
        <div className="print-only muted">
          {def.filters.includes('dates') ? `${dateIN(applied.from)} – ${dateIN(applied.to)}` : dateIN(today())}
        </div>
        {loading && !data ? <Loading /> : <DataTable title={t(def.title)} rows={rows} columns={columns} />}
      </div>
    </div>
  );
}
