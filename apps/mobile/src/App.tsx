import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadLanguage } from './i18n';
import Customer from './screens/Customer';
import Daybook from './screens/Daybook';
import { AddCustomer, LoanRequest, MyRequests, Search } from './screens/Forms';
import Home from './screens/Home';
import { MenuProvider } from './Menu';
import Login from './screens/Login';
import { AppLock } from './Lock';
import { Manager, Summary } from './screens/More';
import LineSheet from './screens/LineSheet';
import Plan from './screens/Plan';
import CollectionReport from './screens/Report';
import RouteDay from './screens/RouteDay';
import Settings, { Legal } from './screens/Settings';
import Support from './screens/Support';
import { SessionProvider, useSession } from './session';
import { TabBar } from './Tabs';
import type { DayCustomer, MyRoute } from './store';
import { Loading, NavProvider, TabBarCtx, type Route } from './ui';
import { View } from 'react-native';

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
    case 'Daybook':
      return <Daybook />;
    case 'Summary':
      return <Summary />;
    case 'CollectionReport':
      return <CollectionReport />;
    case 'Manager':
      return <Manager />;
    case 'Settings':
      return <Settings />;
    case 'Terms':
      return <Legal page="terms" />;
    case 'Privacy':
      return <Legal page="privacy" />;
    case 'LineSheet':
      return <LineSheet routeId={p.routeId as string | undefined} />;
    // Opened from Settings; not in the side menu or tabs.
    case 'Support':
      return <Support />;
    case 'Plan':
      return <Plan />;
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
    <AppLock>
    <NavProvider key={profile.id} initial="Home">
      {(top, depth) => (
        <MenuProvider>
          {/* The bottom bar sits under top-level screens; detail screens opened from them have a back button instead. */}
          <TabBarCtx.Provider value={depth === 1}>
            <View style={{ flex: 1 }}>
              <Screens key={JSON.stringify(top.params ?? {}) + top.name} route={top} />
            </View>
            {depth === 1 && <TabBar />}
          </TabBarCtx.Provider>
        </MenuProvider>
      )}
    </NavProvider>
    </AppLock>
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
