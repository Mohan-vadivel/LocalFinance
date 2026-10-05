import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate } from 'react-router-dom';
import type { Permission } from '@localfinance/shared';
import {
  AlarmClock,
  ArrowLeftRight,
  BadgeCheck,
  BellRing,
  BookOpen,
  Briefcase,
  CalendarClock,
  CalendarX,
  ChevronRight,
  Circle,
  CircleCheck,
  CircleDollarSign,
  FilePlus2,
  Gauge,
  HandCoins,
  MapPin,
  MapPinOff,
  Rocket,
  Route,
  Wallet,
} from 'lucide-react';
import { AlertsCard, BriefingCard, ForecastCard } from '../components/AiDashboard';
import { BranchPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Loading, Stat } from '../components/ui';
import { MapView } from '../components/MapView';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, money, pct } from '../lib/format';
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

/** Per-branch-day items carry the oldest day so the link can open the page on it. */
type DayCount = { count: number; date: string | null; branchId: string | null } | null;
/** GET /dashboard/actions: each count is null when the user has no right to act on it. */
export interface Actions {
  date: string;
  since: string;
  pendingApprovals: number | null;
  toDisburse: number | null;
  handovers: DayCount;
  dayBooks: DayCount;
  flaggedCollections: number | null;
  missedPromises: number | null;
}
/** Days the API looks back for handovers, day books, flags and promises (ACTION_DAYS in reports.ts). */
const ACTION_DAYS = 7;
/** Rights that give a user something to act on from the "Action needed" strip. */
export const ACTION_PERMS: Permission[] = ['loan.approve', 'loan.disburse', 'handover.verify', 'daybook.manage'];

const dayLink = (path: string, d: DayCount) => (d?.date ? `${path}?${new URLSearchParams({ branchId: d.branchId ?? '', date: d.date })}` : path);

/** The "Action needed" strip: one tile per thing waiting on this user, each linking to where it is done. */
export function ActionStrip({ data }: { data: Actions }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const items: { key: string; n: number | null | undefined; to: string; icon: ReactNode; tone: 'warn' | 'danger' | 'info'; sub?: string; show: boolean }[] = [
    { key: 'pendingApprovals', n: data.pendingApprovals, to: '/approvals', icon: <BadgeCheck />, tone: 'warn', show: can('loan.approve') },
    { key: 'toDisburse', n: data.toDisburse, to: '/loans', icon: <HandCoins />, tone: 'info', show: can('customer.view', 'loan.request', 'loan.approve', 'report.view') },
    { key: 'handovers', n: data.handovers?.count, to: dayLink('/handovers', data.handovers), icon: <ArrowLeftRight />, tone: 'warn', sub: data.handovers?.date ? t('actions.oldest', { date: dateIN(data.handovers.date) }) : undefined, show: can('handover.verify') },
    { key: 'dayBooks', n: data.dayBooks?.count, to: dayLink('/daybook', data.dayBooks), icon: <BookOpen />, tone: 'danger', sub: data.dayBooks?.date ? t('actions.oldest', { date: dateIN(data.dayBooks.date) }) : undefined, show: can('daybook.manage') },
    { key: 'flaggedCollections', n: data.flaggedCollections, to: `/collections?flagged=true&from=${data.since}`, icon: <MapPinOff />, tone: 'danger', sub: t('actions.lastDays', { n: ACTION_DAYS }), show: can('collection.record', 'report.view') },
    { key: 'missedPromises', n: data.missedPromises, to: can('report.view') ? '/reports?r=pendingList' : '/customers', icon: <CalendarX />, tone: 'warn', sub: t('actions.lastDays', { n: ACTION_DAYS }), show: can('report.view', 'customer.view') },
  ];
  const due = items.filter((i) => i.show && (i.n ?? 0) > 0);
  if (!due.length) {
    return (
      <div className="card row action-clear">
        <span className="chip-icon sm ok">
          <CircleCheck />
        </span>
        <span className="muted">{t('actions.allClear')}</span>
      </div>
    );
  }
  return (
    <section className="card" aria-labelledby="actions-title">
      <div className="card-head">
        <span className="chip-icon sm warn">
          <BellRing />
        </span>
        <h2 id="actions-title">{t('actions.title')}</h2>
      </div>
      <div className="action-strip">
        {due.map((i) => (
          <Link key={i.key} to={i.to} className="action-item">
            <span className={`chip-icon sm ${i.tone}`}>{i.icon}</span>
            <span className="n">{i.n}</span>
            <span className="txt">
              <span className="l">{t(`actions.${i.key}`)}</span>
              {i.sub && <span className="s">{i.sub}</span>}
            </span>
            <ChevronRight aria-hidden className="go" />
          </Link>
        ))}
      </div>
    </section>
  );
}

const SETUP_STEPS: { key: string; to: string }[] = [
  { key: 'branches', to: '/branches' },
  { key: 'locations', to: '/branches' },
  { key: 'routes', to: '/routes' },
  { key: 'agents', to: '/staff' },
  { key: 'assignedRoutes', to: '/routes' },
  { key: 'products', to: '/products' },
  { key: 'fundedFunds', to: '/funds' },
];

/** First-run checklist for the business owner; hidden once every step is done. */
function GetStarted() {
  const { t } = useTranslation();
  const { data } = useLoad(() => get<Record<string, number>>('/dashboard/setup'), []);
  if (!data) return null;
  const steps = SETUP_STEPS.map((s) => ({ ...s, done: (data[s.key] ?? 0) > 0 }));
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find((s) => !s.done)?.key;
  return (
    <section className="card get-started" aria-labelledby="setup-title">
      <div className="card-head">
        <span className="chip-icon sm">
          <Rocket />
        </span>
        <h2 id="setup-title">{t('setup.title')}</h2>
        <span className="muted">{t('setup.progress', { done, total: steps.length })}</span>
      </div>
      <p className="muted" style={{ margin: '-6px 0 10px' }}>{t('setup.intro')}</p>
      <div className="bar" style={{ marginBottom: 12 }}>
        <span style={{ width: `${(done / steps.length) * 100}%` }} />
      </div>
      <ol className="checklist">
        {steps.map((s) => (
          <li key={s.key} className={s.done ? 'done' : s.key === next ? 'next' : ''}>
            {s.done ? <CircleCheck aria-label={t('setup.done')} className="ok" /> : <Circle aria-hidden />}
            <span className="l">{t(`setup.steps.${s.key}`)}</span>
            {!s.done && (
              <Link to={s.to} className={`btn small${s.key === next ? ' primary' : ''}`}>
                {t('setup.open')}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Loads what is waiting on this user; skipped (null) for users who can act on nothing. */
export function useActions(branchId = '') {
  const { can } = useAuth();
  const allowed = can('report.view', ...ACTION_PERMS);
  return useLoad(() => (allowed ? get<Actions>('/dashboard/actions', { branchId }) : Promise.resolve(null)), [branchId, allowed]);
}

/** First page after login for users without reports: what is waiting on them, or their main page when nothing is. */
export function ActionHome({ fallback }: { fallback: { to: string; key: string } | null }) {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { data, error, loading } = useActions();
  if (!can(...ACTION_PERMS)) return fallback ? <Navigate to={fallback.to} replace /> : <div className="error-box">{t('errors.forbidden')}</div>;
  if (loading && !data) return <Loading />;
  return (
    <div>
      <div className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        {fallback && (
          <Link to={fallback.to} className="btn">
            {t('actions.goTo', { page: t(fallback.key) })}
            <ChevronRight aria-hidden />
          </Link>
        )}
      </div>
      <ErrorBox error={error} />
      {data && <ActionStrip data={data} />}
    </div>
  );
}

export default function Dashboard() {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const [branchId, setBranchId] = useState('');
  const { data, error, loading } = useLoad(() => get<Dash>('/dashboard', { branchId }), [branchId]);
  const actions = useActions(branchId);
  if (profile?.role === 'SUPER_ADMIN' && !profile.tenant) return <Navigate to="/tenants" />;
  if (!can('report.view')) return <Navigate to={can('customer.view') ? '/customers' : '/collections'} />;
  const located = (data?.agents ?? []).filter((a) => a.lastLat != null && a.lastLng != null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('nav.dashboard')}</h1>
        <BranchPicker value={branchId} onChange={setBranchId} allowAll />
      </div>
      {can('settings.manage') && !profile?.readOnly && <GetStarted />}
      <BriefingCard branchId={branchId} />
      {actions.data && <ActionStrip data={actions.data} />}
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
          <div className="grid c2 ai-row">
            <AlertsCard branchId={branchId} />
            <ForecastCard branchId={branchId} />
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
