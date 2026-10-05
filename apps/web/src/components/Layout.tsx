import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type Permission } from '@localfinance/shared';
import {
  Keyboard,
  Sheet,
  FileUp,
  TableProperties,
  ArrowLeftRight,
  BadgeCheck,
  BookOpen,
  Building2,
  ChartColumn,
  ChevronRight,
  Circle,
  ClipboardList,
  HandCoins,
  History,
  Landmark,
  Languages,
  LayoutDashboard,
  LogOut,
  Menu,
  Moon,
  Package,
  PiggyBank,
  Route,
  Settings,
  ShieldCheck,
  Store,
  Sun,
  TrendingUp,
  UserCog,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { setLanguage } from '../lib/i18n';
import { setSupportTenant, supportTenant } from '../lib/api';

interface Item {
  to: string;
  key: string;
  perms?: Permission[];
  roles?: string[];
  /** Optional lucide icon; items without one get a small dot. */
  icon?: LucideIcon;
}

const groups: { title: string; items: Item[] }[] = [
  {
    title: 'nav.dashboard',
    items: [
      { to: '/', key: 'nav.dashboard', perms: ['report.view'], icon: LayoutDashboard },
      { to: '/tenants', key: 'nav.tenants', roles: ['SUPER_ADMIN'], icon: Building2 },
    ],
  },
  {
    title: 'nav.loans',
    items: [
      { to: '/customers', key: 'nav.customers', perms: ['customer.view'], icon: Users },
      { to: '/loans', key: 'nav.loans', perms: ['customer.view', 'loan.request'], icon: HandCoins },
      { to: '/approvals', key: 'nav.approvals', perms: ['loan.approve'], icon: BadgeCheck },
      { to: '/collections', key: 'nav.collections', perms: ['collection.record', 'report.view'], icon: Wallet },
      { to: '/collections/summary', key: 'nav.collectionSummary', perms: ['collection.record', 'report.view'], icon: ClipboardList },
      { to: '/collections/desk', key: 'nav.deskEntry', perms: ['collection.reverse'], icon: Keyboard },
      { to: '/products', key: 'nav.products', perms: ['settings.manage'], icon: Package },
    ],
  },
  {
    title: 'nav.routes',
    items: [
      { to: '/branches', key: 'nav.branches', perms: ['branch.manage', 'route.manage'], icon: Store },
      { to: '/routes', key: 'nav.routes', perms: ['route.manage'], icon: Route },
      { to: '/staff', key: 'nav.staff', perms: ['staff.manage'], icon: UserCog },
      { to: '/roles', key: 'nav.roles', perms: ['staff.manage'], icon: ShieldCheck },
    ],
  },
  {
    title: 'nav.funds',
    items: [
      { to: '/funds', key: 'nav.funds', perms: ['fund.manage'], icon: Landmark },
      { to: '/investors', key: 'nav.investors', perms: ['investor.manage'], icon: PiggyBank },
      { to: '/daybook', key: 'nav.daybook', perms: ['daybook.view', 'daybook.manage'], icon: BookOpen },
      { to: '/handovers', key: 'nav.handovers', perms: ['handover.verify'], icon: ArrowLeftRight },
    ],
  },
  {
    title: 'nav.reports',
    items: [
      { to: '/reports', key: 'nav.reports', perms: ['report.view'], icon: ChartColumn },
      { to: '/reports/line-list', key: 'nav.lineList', perms: ['report.view'], icon: TableProperties },
      { to: '/reports/line-abstract', key: 'nav.lineAbstract', perms: ['report.view'], icon: Sheet },
      { to: '/profit-loss', key: 'nav.profitLoss', perms: ['pl.view'], icon: TrendingUp },
      { to: '/audit', key: 'nav.audit', perms: ['audit.view', 'staff.manage'], icon: History },
      { to: '/import', key: 'nav.import', perms: ['settings.manage'], icon: FileUp },
      { to: '/settings', key: 'nav.settings', perms: ['settings.manage'], icon: Settings },
    ],
  },
];

type Theme = 'light' | 'dark';
const currentTheme = (): Theme => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');

function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    // index.html follows the system setting until the user picks one; keep this state in sync.
    const obs = new MutationObserver(() => setTheme(currentTheme()));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);
  const toggle = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    try {
      localStorage.setItem('lf.theme', next);
    } catch {
      /* storage unavailable: theme still applies for this visit */
    }
    document.documentElement.dataset.theme = next;
  };
  return { theme, toggle };
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w.match(/\p{L}/u)?.[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

export function Layout() {
  const { t, i18n } = useTranslation();
  const { profile, logout, can } = useAuth();
  const { pathname } = useLocation();
  const { theme, toggle } = useTheme();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => setNavOpen(false), [pathname]);
  useEffect(() => {
    document.documentElement.lang = i18n.language;
  }, [i18n.language]);
  useEffect(() => {
    if (!navOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  if (!profile) return null;
  const visible = (i: Item) => (i.roles ? i.roles.includes(profile.role) : !i.perms || can(...i.perms));
  const isSuper = profile.role === 'SUPER_ADMIN';

  // Page context for the top bar: the nav item whose path best matches the URL.
  let current: { group: string; item: Item } | null = null;
  for (const g of groups)
    for (const i of g.items) {
      const hit = i.to === '/' ? pathname === '/' : pathname === i.to || pathname.startsWith(i.to + '/');
      if (hit && (!current || i.to.length > current.item.to.length)) current = { group: g.title, item: i };
    }
  const CurIcon = current?.item.icon;
  const brandName = profile.tenant?.name ?? t('common.appName');

  return (
    <div className={`shell${navOpen ? ' nav-open' : ''}`}>
      <div className="side-backdrop no-print" onClick={() => setNavOpen(false)} />
      <nav className="side no-print" aria-label="Main" id="main-nav">
        <div className="brand">
          {profile.tenant?.logoUrl ? <img src={profile.tenant.logoUrl} alt="" /> : <span className="logo-mark">₹</span>}
          <span className="name" title={brandName}>
            {brandName}
          </span>
          <button className="icon-btn ghost side-close" onClick={() => setNavOpen(false)} aria-label={t('common.close')}>
            <X />
          </button>
        </div>
        <div className="nav">
          {groups.map((g) => {
            const items = g.items.filter(visible);
            if (!items.length) return null;
            return (
              <div key={g.title}>
                <div className="group">{t(g.title)}</div>
                {items.map((i) => {
                  const Icon = i.icon ?? Circle;
                  return (
                    <NavLink key={i.to} to={i.to} end={i.to === '/' || i.to === '/collections' || i.to === '/reports'} className={({ isActive }) => (isActive ? 'active' : '')}>
                      <Icon aria-hidden style={i.icon ? undefined : { width: 8, height: 8, margin: '0 4.5px', fill: 'currentColor' }} />
                      <span className="label">{t(i.key)}</span>
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </div>
        <div className="user">
          <span className="avatar" aria-hidden>
            {initials(profile.name) || '?'}
          </span>
          <div className="who">
            <div className="n" title={profile.name}>
              {profile.name}
            </div>
            <div className="r">{t(`roles.${profile.role}`)}</div>
          </div>
          <button className="icon-btn ghost" onClick={() => void logout()} aria-label={t('common.logout')} title={t('common.logout')}>
            <LogOut />
          </button>
        </div>
      </nav>
      <main className="main">
        <header className="topbar no-print">
          <button className="icon-btn ghost hamburger" onClick={() => setNavOpen(true)} aria-label={t('common.menu')} aria-controls="main-nav" aria-expanded={navOpen}>
            <Menu />
          </button>
          <div className="crumbs">
            {current && (
              <>
                {current.group !== current.item.key && (
                  <>
                    <span className="grp">{t(current.group)}</span>
                    <ChevronRight aria-hidden />
                  </>
                )}
                {CurIcon && <CurIcon aria-hidden style={{ width: 15, height: 15, color: 'var(--muted)' }} />}
                <span className="cur">{t(current.item.key)}</span>
              </>
            )}
          </div>
          <div className="right">
            {isSuper && supportTenant && (
              <button
                className="btn small"
                onClick={() => {
                  setSupportTenant(null);
                  window.location.href = '/tenants';
                }}
              >
                <X />
                {t('common.close')} {t('nav.tenants')}
              </button>
            )}
            <div className="lang">
              <Languages aria-hidden />
              <select aria-label={t('common.language')} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </div>
            <button className="icon-btn" onClick={toggle} aria-label={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')} title={t(theme === 'dark' ? 'common.lightMode' : 'common.darkMode')}>
              {theme === 'dark' ? <Sun /> : <Moon />}
            </button>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
