import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrowserRouter, Navigate, Route, Routes as Switch } from 'react-router-dom';
import type { Permission } from '@localfinance/shared';
import { Layout } from './components/Layout';
import { Loading, ToastProvider } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import Branches from './pages/Branches';
import CollectionSummary from './pages/CollectionSummary';
import DeskEntry from './pages/DeskEntry';
import LineAbstract from './pages/LineAbstract';
import LineList from './pages/LineList';
import Collections from './pages/Collections';
import Customers, { CustomerDetail } from './pages/Customers';
import Dashboard from './pages/Dashboard';
import Daybook, { Handovers } from './pages/Daybook';
import Funds from './pages/Funds';
import Investors, { InvestorDetail } from './pages/Investors';
import Loans, { Approvals, LoanDetail } from './pages/Loans';
import Login from './pages/Login';
import Products from './pages/Products';
import ProfitLoss from './pages/ProfitLoss';
import Reports from './pages/Reports';
import Routes, { RouteDetail } from './pages/Routes';
import Settings, { Audit } from './pages/Settings';
import Staff, { Roles } from './pages/Staff';
import Tenants from './pages/Tenants';

function Home() {
  const { profile, can } = useAuth();
  if (profile?.role === 'SUPER_ADMIN' && !profile.tenant) return <Navigate to="/tenants" replace />;
  if (can('report.view')) return <Dashboard />;
  return <Navigate to={can('customer.view') ? '/customers' : '/loans'} replace />;
}

/** Shows the page only when the user has one of the rights; the API enforces the same rules. */
function Need({ perms, superOnly, children }: { perms?: Permission[]; superOnly?: boolean; children: ReactNode }) {
  const { t } = useTranslation();
  const { profile, can } = useAuth();
  const ok = superOnly ? profile?.role === 'SUPER_ADMIN' : !perms || can(...perms);
  return ok ? <>{children}</> : <div className="error-box">{t('errors.forbidden')}</div>;
}

function Guarded() {
  const { profile, loading } = useAuth();
  if (loading) return <Loading />;
  if (!profile) return <Login />;
  return (
    <Switch>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="tenants" element={<Need superOnly><Tenants /></Need>} />
        <Route path="branches" element={<Need perms={['branch.manage', 'route.manage']}><Branches /></Need>} />
        <Route path="routes" element={<Need perms={['route.manage', 'report.view']}><Routes /></Need>} />
        <Route path="routes/:id" element={<Need perms={['route.manage', 'report.view']}><RouteDetail /></Need>} />
        <Route path="staff" element={<Need perms={['staff.manage']}><Staff /></Need>} />
        <Route path="roles" element={<Need perms={['staff.manage']}><Roles /></Need>} />
        <Route path="customers" element={<Need perms={['customer.view']}><Customers /></Need>} />
        <Route path="customers/:id" element={<Need perms={['customer.view']}><CustomerDetail /></Need>} />
        <Route path="products" element={<Need perms={['settings.manage']}><Products /></Need>} />
        <Route path="loans" element={<Need perms={['customer.view', 'loan.request', 'loan.approve', 'report.view']}><Loans /></Need>} />
        <Route path="loans/:id" element={<Need perms={['customer.view', 'loan.request', 'loan.approve', 'collection.record']}><LoanDetail /></Need>} />
        <Route path="approvals" element={<Need perms={['loan.approve']}><Approvals /></Need>} />
        <Route path="collections" element={<Need perms={['collection.record', 'report.view']}><Collections /></Need>} />
        <Route path="collections/summary" element={<Need perms={['collection.record', 'report.view']}><CollectionSummary /></Need>} />
        <Route path="collections/desk" element={<Need perms={['collection.reverse']}><DeskEntry /></Need>} />
        <Route path="reports/line-abstract" element={<Need perms={['report.view']}><LineAbstract /></Need>} />
        <Route path="reports/line-list" element={<Need perms={['report.view']}><LineList /></Need>} />
        <Route path="funds" element={<Need perms={['fund.manage']}><Funds /></Need>} />
        <Route path="investors" element={<Need perms={['investor.manage']}><Investors /></Need>} />
        <Route path="investors/:id" element={<Need perms={['investor.manage']}><InvestorDetail /></Need>} />
        <Route path="daybook" element={<Need perms={['daybook.view', 'daybook.manage']}><Daybook /></Need>} />
        <Route path="handovers" element={<Need perms={['handover.verify']}><Handovers /></Need>} />
        <Route path="reports" element={<Need perms={['report.view']}><Reports /></Need>} />
        <Route path="profit-loss" element={<Need perms={['pl.view']}><ProfitLoss /></Need>} />
        <Route path="audit" element={<Need perms={['audit.view', 'staff.manage']}><Audit /></Need>} />
        <Route path="settings" element={<Need perms={['settings.manage']}><Settings /></Need>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <Guarded />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
