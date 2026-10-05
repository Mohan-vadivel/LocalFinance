import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import { AlarmClock, BadgeCheck, Briefcase, CalendarClock, CircleDollarSign, FilePlus2, Gauge, MapPin, Route, Wallet } from 'lucide-react';
import { BranchPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Loading, Stat } from '../components/ui';
import { MapView } from '../components/MapView';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, pct } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Dash {
  date: string;
  dueToday: number;
  overdueAtStart: number;
  collectedToday: number;
  collectedCash: number;
  collectedUpi: number;
  collectionRate: number | null;
  newLoans: number;
  disbursedToday: number;
  activeLoans: number;
  portfolio: number;
  pendingApprovals: number;
  ageing: { bucket: string; loans: number; amount: number }[];
  agents: { agentId: string; name: string; collected: number; cashInHand: number; handedOver: boolean; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null }[];
  routes: { routeId: string; name: string; agents: string[]; customers: number; visited: number }[];
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const [branchId, setBranchId] = useState('');
  const { data, error, loading } = useLoad(() => get<Dash>('/dashboard', { branchId }), [branchId]);
  if (profile?.role === 'SUPER_ADMIN' && !profile.tenant) return <Navigate to="/tenants" />;
  if (!can('report.view')) return <Navigate to={can('customer.view') ? '/customers' : '/collections'} />;
  const located = (data?.agents ?? []).filter((a) => a.lastLat != null && a.lastLng != null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        <BranchPicker value={branchId} onChange={setBranchId} allowAll />
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="grid k3">
            <Stat icon={<CalendarClock />} label={t('dashboard.dueToday')} value={money(data.dueToday)} sub={`${t('loanMod.overdue')}: ${money(data.overdueAtStart)}`} />
            <Stat
              icon={<Wallet />}
              tone="ok"
              label={t('dashboard.collectedToday')}
              value={money(data.collectedToday)}
              sub={`${t('common.modes.CASH')} ${money(data.collectedCash)} · UPI ${money(data.collectedUpi)}`}
            />
            <Stat icon={<Gauge />} tone="info" label={t('dashboard.collectionRate')} value={pct(data.collectionRate)} />
            <Stat icon={<FilePlus2 />} label={t('dashboard.newLoans')} value={data.newLoans} sub={`${t('dashboard.disbursedToday')}: ${money(data.disbursedToday)}`} />
            <Stat icon={<Briefcase />} tone="info" label={t('dashboard.portfolio')} value={money(data.portfolio)} sub={`${t('dashboard.activeLoans')}: ${data.activeLoans}`} />
            <Stat icon={<BadgeCheck />} tone={data.pendingApprovals ? 'warn' : undefined} label={t('dashboard.pendingApprovals')} value={<Link to="/approvals">{data.pendingApprovals}</Link>} />
          </div>
          <div className="grid c2">
            <div className="card">
              <div className="card-head">
                <span className="chip-icon sm danger">
                  <AlarmClock />
                </span>
                <h2>{t('dashboard.overdue')}</h2>
              </div>
              <DataTable
                rows={data.ageing}
                columns={[
                  { key: 'bucket', label: t('loanMod.daysPastDue'), render: (r) => t(`report.buckets.${r.bucket}`), value: (r) => t(`report.buckets.${r.bucket}`) },
                  { key: 'loans', label: t('nav.loans'), num: true, total: true },
                  { key: 'amount', label: t('loanMod.overdue'), money: true, total: true },
                ]}
              />
            </div>
            <div className="card">
              <div className="card-head">
                <span className="chip-icon sm">
                  <Route />
                </span>
                <h2>{t('dashboard.routeProgress')}</h2>
              </div>
              {data.routes.length === 0 && <div className="muted">{t('common.noData')}</div>}
              <div className="route-list">
                {data.routes.map((r) => (
                  <div key={r.routeId} className="route-item">
                    <div className="row">
                      <Link to={`/routes/${r.routeId}`}>{r.name}</Link>
                      <span className="muted agents">{r.agents.join(', ')}</span>
                      <span className="spacer" />
                      <span className="frac">
                        {r.visited} / {r.customers}
                      </span>
                    </div>
                    <div className="bar">
                      <span style={{ width: `${r.customers ? Math.min(100, (r.visited / r.customers) * 100) : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-head">
              <span className="chip-icon sm ok">
                <CircleDollarSign />
              </span>
              <h2>{t('dashboard.cashInHand')}</h2>
            </div>
            <DataTable
              rows={data.agents}
              columns={[
                { key: 'name', label: t('common.agent') },
                { key: 'collected', label: t('report.collected'), money: true, total: true },
                { key: 'cashInHand', label: t('dashboard.cashInHand'), money: true, total: true },
                {
                  key: 'handedOver',
                  label: t('handover.title'),
                  render: (r) => <Badge tone={r.handedOver ? 'ok' : 'warn'}>{r.handedOver ? t('common.yes') : t('handover.pending')}</Badge>,
                },
              ]}
            />
            {located.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <h3 className="row" style={{ gap: 6 }}>
                  <MapPin aria-hidden style={{ width: 15, height: 15, color: 'var(--muted)' }} />
                  {t('mobile.liveAgents')}
                </h3>
                <MapView
                  height={300}
                  pins={located.map((a) => ({
                    id: a.agentId,
                    lat: a.lastLat!,
                    lng: a.lastLng!,
                    label: a.name.slice(0, 1),
                    title: `${a.name} · ${a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleTimeString() : ''}`,
                    color: '#b54708',
                  }))}
                />
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
