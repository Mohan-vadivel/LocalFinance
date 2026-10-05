import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadLanguage } from './i18n';
import Customer from './screens/Customer';
import { AddCustomer, LoanRequest, MyRequests, Search } from './screens/Forms';
import Home from './screens/Home';
import { MenuProvider } from './Menu';
import Login from './screens/Login';
import { Manager, Settings, Summary } from './screens/More';
import CollectionReport from './screens/Report';
import RouteDay from './screens/RouteDay';
import { SessionProvider, useSession } from './session';
import type { DayCustomer, MyRoute } from './store';
import { Loading, NavProvider, type Route } from './ui';

function Screens({ route }: { route: Route }) {
  const p = (route.params ?? {}) as Record<string, unknown>;
  switch (route.name) {
    case 'RouteDay':
      return <RouteDay routeId={p.routeId as string} name={p.name as string} />;
    case 'Customer':
      return <Customer customer={p.customer as DayCustomer | undefined} customerId={p.customerId as string | undefined} routeId={p.routeId as string | undefined} amount={p.amount as number | null | undefined} />;
    case 'AddCustomer':
      return <AddCustomer routes={(p.routes as MyRoute[]) ?? []} />;
    case 'Search':
      return <Search forLoan={!!p.forLoan} />;
    case 'LoanRequest':
      return <LoanRequest customerId={p.customerId as string} customerName={p.customerName as string} />;
    case 'MyRequests':
      return <MyRequests />;
    case 'Summary':
      return <Summary />;
    case 'CollectionReport':
      return <CollectionReport />;
    case 'Manager':
      return <Manager />;
    case 'Settings':
      return <Settings />;
    default:
      return <Home />;
  }
}

function Root() {
  const { profile, ready } = useSession();
  if (!ready) return <Loading />;
  if (!profile) return <Login />;
  // Keyed by user so a new login starts on a fresh home screen.
  return (
    <NavProvider key={profile.id} initial="Home">
      {(top) => (
        <MenuProvider>
          <Screens key={JSON.stringify(top.params ?? {}) + top.name} route={top} />
        </MenuProvider>
      )}
    </NavProvider>
  );
}

export default function App() {
  const [langReady, setLangReady] = useState(false);
  useEffect(() => {
    void loadLanguage().finally(() => setLangReady(true));
  }, []);
  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      {langReady ? (
        <SessionProvider>
          <Root />
        </SessionProvider>
      ) : (
        <Loading />
      )}
    </SafeAreaProvider>
  );
}
