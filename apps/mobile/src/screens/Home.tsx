import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../session';
import { getFailed, getLastSync, getQueue, myRoutes, subscribe, sync, type MyRoute } from '../store';
import { Badge, Btn, C, Card, ErrorText, Notice, s, useNav } from '../ui';

/** Pending, failed and last-sync state, kept current as the queue changes. */
export function useSyncState() {
  const [state, setState] = useState({ pending: 0, failed: 0, lastSync: null as string | null });
  const load = useCallback(async () => {
    const [q, f, l] = await Promise.all([getQueue(), getFailed(), getLastSync()]);
    setState({ pending: q.length, failed: f.length, lastSync: l });
  }, []);
  useEffect(() => {
    void load();
    return subscribe(() => void load());
  }, [load]);
  return state;
}

export function SyncBar() {
  const { t } = useTranslation();
  const nav = useNav();
  const st = useSyncState();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    const r = await sync();
    setMsg(r.offline ? t('common.offline') : '');
    setBusy(false);
  };
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ fontWeight: '700', color: st.pending ? C.warn : C.ok }}>
          {st.pending ? `${t('mobile.pendingSync')}: ${st.pending}` : t('mobile.allSynced')}
        </Text>
        <Text style={s.muted}>
          {t('mobile.lastSync')}: {st.lastSync ? new Date(st.lastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'} {msg ? `· ${msg}` : ''}
        </Text>
        {st.failed > 0 && (
          <Pressable onPress={() => nav.push('Summary')}>
            <Text style={{ color: C.danger, fontWeight: '600' }}>{t('mobile.failedItems', { count: st.failed })}</Text>
          </Pressable>
        )}
      </View>
      <Btn small kind="plain" title={t('mobile.syncNow')} onPress={() => void run()} busy={busy} />
    </Card>
  );
}

export default function Home() {
  const { t } = useTranslation();
  const nav = useNav();
  const { profile, can } = useSession();
  const [routes, setRoutes] = useState<MyRoute[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await myRoutes();
    setRoutes(r.data ?? []);
    setOffline(r.offline);
    setError(r.error ?? null);
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const isManager = can('report.view', 'route.manage');

  return (
    <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title} numberOfLines={1}>{profile?.tenant?.name ?? t('common.appName')}</Text>
          <Text style={{ color: '#cfe6e2' }} numberOfLines={1}>{profile?.name} · {t(`roles.${profile?.role}`)}</Text>
        </View>
        <Btn small kind="plain" title={t('common.settings')} onPress={() => nav.push('Settings')} />
      </View>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}>
        <SyncBar />
        {offline && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
        <ErrorText error={error} />
        <Text style={s.h2}>{t('mobile.myRoutes')}</Text>
        {routes && routes.length === 0 && <Notice tone="warn" text={t('mobile.noRoutes')} />}
        {(routes ?? []).map((r) => (
          <Pressable key={r.id} onPress={() => nav.push('RouteDay', { routeId: r.id, name: r.name })} accessibilityRole="button">
            <Card style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ fontSize: 17, fontWeight: '700', color: C.ink }}>{r.name}</Text>
                <Text style={s.muted}>{r.location} · {r.customerCount} {t('nav.customers')}</Text>
              </View>
              {r.collectsToday ? <Badge text={t('common.today')} color={C.brand} /> : <Badge text={t('mobile.notToday')} color="#8a96a3" />}
            </Card>
          </Pressable>
        ))}
        <View style={{ height: 8 }} />
        <Btn kind="plain" title={t('mobile.daySummary')} onPress={() => nav.push('Summary')} />
        <Btn kind="plain" title={t('collSummary.title')} onPress={() => nav.push('CollectionReport')} />
        {can('customer.view', 'collection.record') && <Btn kind="plain" title={t('mobile.searchCustomer')} onPress={() => nav.push('Search')} />}
        {can('customer.create') && <Btn kind="plain" title={t('mobile.addCustomer')} onPress={() => nav.push('AddCustomer', { routes: routes ?? [] })} />}
        {can('loan.request') && <Btn kind="plain" title={t('mobile.requestLoan')} onPress={() => nav.push('Search', { forLoan: true })} />}
        {can('loan.request') && <Btn kind="plain" title={t('mobile.myRequests')} onPress={() => nav.push('MyRequests')} />}
        {isManager && <Btn kind="plain" title={t('mobile.managerView')} onPress={() => nav.push('Manager')} />}
      </ScrollView>
    </SafeAreaView>
  );
}
