import { NavLink, Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Permission } from '@localfinance/shared';
import { useAuth } from '../lib/auth';
import { setLanguage } from '../lib/i18n';
import { setSupportTenant, supportTenant } from '../lib/api';

interface Item {
  to: string;
  key: string;
  perms?: Permission[];
  roles?: string[];
}

const groups: { title: string; items: Item[] }[] = [
  {
    title: 'nav.dashboard',
    items: [
      { to: '/', key: 'nav.dashboard', perms: ['report.view'] },
      { to: '/tenants', key: 'nav.tenants', roles: ['SUPER_ADMIN'] },
    ],
  },
  {
    title: 'nav.loans',
    items: [
      { to: '/customers', key: 'nav.customers', perms: ['customer.view'] },
      { to: '/loans', key: 'nav.loans', perms: ['customer.view', 'loan.request'] },
      { to: '/approvals', key: 'nav.approvals', perms: ['loan.approve'] },
      { to: '/collections', key: 'nav.collections', perms: ['collection.record', 'report.view'] },
      { to: '/collections/summary', key: 'nav.collectionSummary', perms: ['collection.record', 'report.view'] },
      { to: '/products', key: 'nav.products', perms: ['settings.manage'] },
    ],
  },
  {
    title: 'nav.routes',
    items: [
      { to: '/branches', key: 'nav.branches', perms: ['branch.manage', 'route.manage'] },
      { to: '/routes', key: 'nav.routes', perms: ['route.manage'] },
      { to: '/staff', key: 'nav.staff', perms: ['staff.manage'] },
      { to: '/roles', key: 'nav.roles', perms: ['staff.manage'] },
    ],
  },
  {
    title: 'nav.funds',
    items: [
      { to: '/funds', key: 'nav.funds', perms: ['fund.manage'] },
      { to: '/investors', key: 'nav.investors', perms: ['investor.manage'] },
      { to: '/daybook', key: 'nav.daybook', perms: ['daybook.view', 'daybook.manage'] },
      { to: '/handovers', key: 'nav.handovers', perms: ['handover.verify'] },
    ],
  },
  {
    title: 'nav.reports',
    items: [
      { to: '/reports', key: 'nav.reports', perms: ['report.view'] },
      { to: '/profit-loss', key: 'nav.profitLoss', perms: ['pl.view'] },
      { to: '/audit', key: 'nav.audit', perms: ['audit.view', 'staff.manage'] },
      { to: '/settings', key: 'nav.settings', perms: ['settings.manage'] },
    ],
  },
];

export function Layout() {
  const { t, i18n } = useTranslation();
  const { profile, logout, can } = useAuth();
  if (!profile) return null;
  const visible = (i: Item) => (i.roles ? i.roles.includes(profile.role) : !i.perms || can(...i.perms));
  const isSuper = profile.role === 'SUPER_ADMIN';
  return (
    <div className="shell">
      <nav className="side no-print" aria-label="Main">
        <div className="brand">
          {profile.tenant?.logoUrl ? <img src={profile.tenant.logoUrl} alt="" /> : <span>₹</span>}
          {profile.tenant?.name ?? t('common.appName')}
        </div>
        {groups.map((g) => {
          const items = g.items.filter(visible);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <div className="group">{t(g.title)}</div>
              {items.map((i) => (
                <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/collections'} className={({ isActive }) => (isActive ? 'active' : '')}>
                  {t(i.key)}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <main className="main">
        <div className="topbar no-print">
          <div className="muted">
            {isSuper && supportTenant && (
              <button
                className="btn small"
                onClick={() => {
                  setSupportTenant(null);
                  window.location.href = '/tenants';
                }}
              >
                {t('common.close')} {t('nav.tenants')}
              </button>
            )}
          </div>
          <div className="right">
            <select aria-label={t('common.language')} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
            <span>
              {profile.name} · {t(`roles.${profile.role}`)}
            </span>
            <button className="btn small" onClick={() => void logout()}>
              {t('common.logout')}
            </button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
