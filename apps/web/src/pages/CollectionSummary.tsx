import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, periodRange, type SummaryPeriod } from '@localfinance/shared';
import { BranchPicker, RoutePicker, StaffPicker } from '../components/pickers';
import { DataTable, ErrorBox, Loading, Stat, Tabs, type Column } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, money, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Totals { total: number; cash: number; upi: number; bank: number; count: number }
interface Summary {
  period: SummaryPeriod;
  from: string;
  to: string;
  mine: boolean;
  totals: Totals & { customers: number };
  previousTotal: number;
  byDay: (Totals & { date: string })[];
  byRoute: (Totals & { routeId: string | null; route: string })[];
  byAgent: (Totals & { agentId: string; agent: string })[];
}

/** Collection totals for a day, week or month with the cash, UPI and bank split. */
export default function CollectionSummary() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [period, setPeriod] = useState<SummaryPeriod>('DAY');
  const [date, setDate] = useState(today());
  const [branchId, setBranchId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [agentId, setAgentId] = useState('');
  const { data, error } = useLoad(
    () => get<Summary>('/reports/collection-summary', { period, date, branchId, routeId, agentId }),
    [period, date, branchId, routeId, agentId],
  );
  const range = periodRange(period, date);
  const atCurrent = range.to >= today();
  const label = range.from === range.to ? dateIN(range.from) : `${dateIN(range.from)} – ${dateIN(range.to)}`;
  const diff = data ? data.totals.total - data.previousTotal : 0;

  const modeCols = <T extends Totals>(): Column<T>[] => [
    { key: 'total', label: t('common.total'), money: true, total: true },
    { key: 'cash', label: t('common.modes.CASH'), money: true, total: true },
    { key: 'upi', label: t('common.modes.UPI'), money: true, total: true },
    { key: 'bank', label: t('common.modes.BANK'), money: true, total: true },
    { key: 'count', label: t('collSummary.receipts'), num: true, total: true },
  ];

  return (
    <div>
      <div className="page-head">
        <h1>{t('collSummary.title')}</h1>
      </div>
      <div className="card no-print">
        <Tabs<SummaryPeriod>
          value={period}
          onChange={setPeriod}
          items={[
            { key: 'DAY', label: t('collSummary.daily') },
            { key: 'WEEK', label: t('collSummary.weekly') },
            { key: 'MONTH', label: t('collSummary.monthly') },
          ]}
        />
        <div className="row" style={{ marginTop: 12 }}>
          <div className="period-nav">
            <button className="btn" onClick={() => setDate(addDays(range.from, -1))}>‹ {t('collSummary.prev')}</button>
            <strong>{label}</strong>
            <button className="btn" disabled={atCurrent} onClick={() => setDate(addDays(range.to, 1))}>{t('collSummary.next')} ›</button>
          </div>
          <div className="row">
            <button className="btn" disabled={atCurrent} onClick={() => setDate(today())}>{t('collSummary.current')}</button>
            <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
          <RoutePicker branchId={branchId || undefined} value={routeId} onChange={setRouteId} allowAll />
          {can('report.view') && <StaffPicker branchId={branchId || undefined} value={agentId} onChange={setAgentId} allowAll />}
        </div>
      </div>
      <ErrorBox error={error} />
      {!data && !error && <Loading />}
      {data && (
        <>
          {data.mine && <p className="muted">{t('collSummary.onlyMine')}</p>}
          <div className="grid k4" style={{ marginBottom: 16 }}>
            <Stat
              label={t('report.collected')}
              value={money(data.totals.total)}
              sub={`${t('collSummary.previousPeriod')}: ${money(data.previousTotal)} (${diff >= 0 ? '+' : '−'}${money(Math.abs(diff))})`}
            />
            <Stat label={t('common.modes.CASH')} value={money(data.totals.cash)} sub={share(data.totals.cash, data.totals.total)} />
            <Stat label={t('common.modes.UPI')} value={money(data.totals.upi)} sub={share(data.totals.upi, data.totals.total)} />
            {data.totals.bank > 0 && <Stat label={t('common.modes.BANK')} value={money(data.totals.bank)} sub={share(data.totals.bank, data.totals.total)} />}
            <Stat label={t('collSummary.receipts')} value={data.totals.count} sub={`${t('collSummary.customersPaid')}: ${data.totals.customers}`} />
          </div>
          {data.totals.count === 0 && <p className="muted">{t('collSummary.nothing')}</p>}
          {period !== 'DAY' && (
            <div className="card">
              <DataTable
                title={`${t('collSummary.byDay')} ${range.from} ${range.to}`}
                rows={data.byDay}
                columns={[{ key: 'date', label: t('reportCols.date'), render: (r) => dateIN(r.date) }, ...modeCols<Summary['byDay'][number]>()]}
              />
            </div>
          )}
          {data.byAgent.length > 0 && (
            <div className="card">
              <DataTable
                title={`${t('collSummary.byAgent')} ${range.from} ${range.to}`}
                rows={data.byAgent}
                columns={[{ key: 'agent', label: t('reportCols.agent') }, ...modeCols<Summary['byAgent'][number]>()]}
              />
            </div>
          )}
          {data.byRoute.length > 0 && (
            <div className="card">
              <DataTable
                title={`${t('collSummary.byRoute')} ${range.from} ${range.to}`}
                rows={data.byRoute}
                columns={[{ key: 'route', label: t('reportCols.route') }, ...modeCols<Summary['byRoute'][number]>()]}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

const share = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : '');
