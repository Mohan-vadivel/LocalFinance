import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { BranchPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Loading, Stat } from '../components/ui';
import { get } from '../lib/api';
import { money } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface AreaRow {
  id: string;
  name: string;
  active: boolean;
  branchId: string;
  branchName: string;
  routeCount: number;
  customerCount: number;
  activeLoans: number;
  collectedToday: number;
  dueToday: number;
  overdue: number;
}
interface Summary {
  date: string;
  areas: AreaRow[];
  totals: { routeCount: number; customerCount: number; activeLoans: number; collectedToday: number; dueToday: number; overdue: number };
}
interface AreaRoute { id: string; name: string; active: boolean; customerCount: number; collectionDays: number[] }
interface AreaCustomer { id: string; code: string; name: string; phone: string; status: string; routeName?: string }

/** Area tracking: each area with its routes, customers and today's money. Tapping an area shows its routes and customers. */
export default function Areas() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [branchId, setBranchId] = useState('');
  const [selected, setSelected] = useState<AreaRow | null>(null);
  const summary = useLoad(() => get<Summary>('/structure/areas-summary', { branchId }), [branchId]);
  const routes = useLoad(() => (selected ? get<AreaRoute[]>('/routes', { locationId: selected.id }) : Promise.resolve(null)), [selected?.id]);
  const customers = useLoad(
    () => (selected ? get<{ total: number; rows: AreaCustomer[] }>('/customers', { locationId: selected.id }) : Promise.resolve(null)),
    [selected?.id],
  );
  const d = summary.data;
  const totals = d?.totals;

  return (
    <div>
      <div className="page-head">
        <h1>{t('areas.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setSelected(null); }} allowAll />
          <Link className="btn" to="/setup">{t('structure.title')}</Link>
        </div>
      </div>
      <p className="muted">{t('areas.intro')}</p>
      <ErrorBox error={summary.error} />
      {!d && !summary.error && <Loading />}
      {d && totals && (
        <>
          <div className="grid c3" style={{ marginBottom: 12 }}>
            <Stat label={t('areas.collectedToday')} value={money(totals.collectedToday)} />
            <Stat label={t('areas.dueToday')} value={money(totals.dueToday)} />
            <Stat label={t('areas.overdue')} tone={totals.overdue > 0 ? 'danger' : undefined} value={money(totals.overdue)} />
          </div>
          <div className="card">
            <DataTable
              title={t('areas.title')}
              rows={d.areas}
              empty={t('areas.none')}
              onRow={(r) => setSelected(r)}
              columns={[
                { key: 'name', label: t('areas.area'), render: (r) => <span>{r.name} {!r.active && <Badge>{t('common.inactive')}</Badge>}</span>, value: (r) => r.name },
                { key: 'branch', label: t('common.branch'), value: (r) => r.branchName },
                { key: 'routeCount', label: t('areas.routes'), value: (r) => r.routeCount, num: true },
                { key: 'customerCount', label: t('areas.customers'), value: (r) => r.customerCount, num: true, total: true },
                { key: 'activeLoans', label: t('areas.activeLoans'), value: (r) => r.activeLoans, num: true, total: true },
                { key: 'collectedToday', label: t('areas.collectedToday'), value: (r) => r.collectedToday, money: true, total: true },
                { key: 'dueToday', label: t('areas.dueToday'), value: (r) => r.dueToday, money: true, total: true },
                { key: 'overdue', label: t('areas.overdue'), value: (r) => r.overdue, money: true, total: true },
              ]}
            />
          </div>
          {selected && (
            <div className="grid c2">
              <div className="card">
                <h2>{t('areas.routesIn', { name: selected.name })}</h2>
                <ErrorBox error={routes.error} />
                {routes.data && !routes.data.length && <div className="muted">{t('areas.noRoutes')}</div>}
                {(routes.data ?? []).map((r) => (
                  <div key={r.id} className="row" style={{ padding: '6px 0' }}>
                    <Link to={`/routes/${r.id}`}>{r.name}</Link>
                    {!r.active && <Badge>{t('common.inactive')}</Badge>}
                    <span className="spacer" />
                    <span className="muted">{t('areas.customers')}: {r.customerCount}</span>
                  </div>
                ))}
              </div>
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>{t('areas.customersIn', { name: selected.name })}</h2>
                  <span className="spacer" />
                  <button className="btn small" onClick={() => nav(`/customers?locationId=${selected.id}`)}>{t('areas.openAll')}</button>
                </div>
                <ErrorBox error={customers.error} />
                {customers.data && !customers.data.rows.length && <div className="muted">{t('areas.noCustomers')}</div>}
                {customers.data && customers.data.total > customers.data.rows.length && (
                  <div className="muted" style={{ marginBottom: 6 }}>{t('areas.showing', { count: customers.data.rows.length, total: customers.data.total })}</div>
                )}
                {(customers.data?.rows ?? []).map((c) => (
                  <div key={c.id} className="row" style={{ padding: '6px 0' }}>
                    <Link to={`/customers/${c.id}`}>{c.name}</Link>
                    <span className="muted">{c.code}</span>
                    <span className="spacer" />
                    <span className="muted">{c.routeName ?? '-'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
