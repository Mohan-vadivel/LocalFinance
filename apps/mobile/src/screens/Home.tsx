import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../session';
import { cachedRouteDay, getFailed, getLastSync, getQueue, myRoutes, subscribe, sync, type MyRoute } from '../store';
import { AmountPair, Avatar, Badge, Btn, C, Card, Chevron, ErrorText, Icon, IconButton, MAX_W, MAX_W_WIDE, MenuCtx, Notice, Progress, R, SP, Section, dateIN, money, s, todayIST, useLayout, useNav, type IconName } from '../ui';

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
  const { compact } = useLayout();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const run = async () => {
    setBusy(true);
    const r = await sync();
    setMsg(r.offline ? t('common.offline') : '');
    setBusy(false);
  };
  const tone = st.failed > 0 ? C.danger : st.pending ? C.warn : C.ok;
  return (
    <Card style={[{ flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: SP.md }, compact && { flexWrap: 'wrap', rowGap: SP.sm }]}>
      <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: tone, boxShadow: `0px 0px 0px 4px ${tone}22` }} />
      {/* On a small phone the button drops under the text (full width) instead of squeezing it. */}
      <View style={{ flex: 1, minWidth: compact ? 150 : 0 }}>
        <Text style={{ fontWeight: '800', fontSize: 15, color: st.pending ? C.warn : C.ok }}>
          {st.pending ? `${t('mobile.pendingSync')}: ${st.pending}` : t('mobile.allSynced')}
        </Text>
        <Text style={[s.muted, { fontSize: 13 }]}>
          {t('mobile.lastSync')}: {st.lastSync ? new Date(st.lastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'} {msg ? `· ${msg}` : ''}
        </Text>
        {st.failed > 0 && (
          <Pressable onPress={() => nav.push('Summary')} hitSlop={8} style={{ paddingVertical: 4 }}>
            <Text style={{ color: C.danger, fontWeight: '700' }}>{t('mobile.failedItems', { count: st.failed })}</Text>
          </Pressable>
        )}
      </View>
      <Btn small kind="tonal" title={t('mobile.syncNow')} onPress={() => void run()} busy={busy} style={compact ? { flexGrow: 1 } : undefined} />
    </Card>
  );
}

/** Progress of a route today, from the copy last downloaded on this phone. */
interface DayProgress { visited: number; total: number; collected: number; due: number }

export default function Home() {
  const { t } = useTranslation();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const { width, tablet, wide } = useLayout();
  const { profile, can } = useSession();
  const menu = useContext(MenuCtx);
  const [routes, setRoutes] = useState<MyRoute[] | null>(null);
  const [progress, setProgress] = useState<Record<string, DayProgress>>({});
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
  // Read today's route copies already on the phone (no network) to show progress on the cards.
  useEffect(() => {
    if (!routes?.length) return;
    const today = todayIST();
    const read = () =>
      void Promise.all(routes.map((r) => cachedRouteDay(r.id))).then((days) => {
        const out: Record<string, DayProgress> = {};
        days.forEach((d, i) => {
          if (!d || d.date !== today) return;
          const list = d.customers;
          out[routes[i].id] = {
            visited: list.filter((c) => c.pin !== 'PENDING').length,
            total: list.length,
            collected: list.reduce((sum, c) => sum + c.paidToday, 0),
            due: list.reduce((sum, c) => sum + c.dueNow + c.paidToday, 0),
          };
        });
        setProgress(out);
      });
    read();
    return subscribe(read);
  }, [routes]);
  const isManager = can('report.view', 'route.manage');

  const todays = (routes ?? []).filter((r) => r.collectsToday);
  const known = Object.values(progress);
  const totals = known.reduce((a, p) => ({ visited: a.visited + p.visited, total: a.total + p.total, collected: a.collected + p.collected, due: a.due + p.due }), { visited: 0, total: 0, collected: 0, due: 0 });
  const customersToday = todays.reduce((sum, r) => sum + r.customerCount, 0);

  // The most used places, as tiles. Everything else (and settings) is in the side menu.
  const actions: { title: string; icon: IconName; color: string; onPress: () => void; show: boolean }[] = [
    { title: t('mobile.search'), icon: 'search', color: '#0f766e', onPress: () => nav.push('Search'), show: can('customer.view', 'collection.record') },
    { title: t('mobile.addCustomer'), icon: 'person-add', color: '#2563eb', onPress: () => nav.push('AddCustomer', { routes: routes ?? [] }), show: can('customer.create') },
    { title: t('mobile.daySummary'), icon: 'today', color: '#7c3aed', onPress: () => nav.push('Summary'), show: true },
    { title: t('collSummary.title'), icon: 'bar-chart', color: '#c2410c', onPress: () => nav.push('CollectionReport'), show: true },
    { title: t('mobile.requestLoan'), icon: 'cash', color: '#047857', onPress: () => nav.push('Search', { forLoan: true }), show: can('loan.request') },
    { title: t('mobile.managerView'), icon: 'people', color: '#be185d', onPress: () => nav.push('Manager'), show: isManager },
  ];


  // Tablets: route cards in two columns; a landscape tablet also puts the actions in a column of their own.
  const maxW = wide ? MAX_W_WIDE : MAX_W;
  const contentW = Math.min(width - insets.left - insets.right, maxW + SP.lg * 2) - SP.lg * 2;
  const routeCols = tablet && !wide && (routes?.length ?? 0) > 1 ? 2 : 1;
  const routeW = routeCols === 2 ? (contentW - SP.md) / 2 : undefined;
  // Equal-width action tiles: 2 on a phone, 3 on a tablet; a landscape tablet shows them in a 2/5 side column.
  const tileCols = tablet && !wide ? 3 : 2;
  const tileArea = wide ? ((contentW - SP.lg) * 2) / 5 : contentW;
  const tileW = Math.floor((tileArea - SP.md * (tileCols - 1)) / tileCols);

  const todayCard = (
    <Card tone="brand" style={{ padding: SP.xl - 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.md, gap: SP.sm, flexWrap: 'wrap' }}>
        <Text style={{ color: C.onBrand, fontWeight: '800', fontSize: 16, flexShrink: 1 }}>{t('common.today')}</Text>
        <Text style={{ color: C.onBrandMuted, fontWeight: '600' }}>{dateIN(todayIST())}</Text>
      </View>
      {known.length > 0 ? (
        <>
          <AmountPair onBrand main={{ label: t('report.collected'), value: money(totals.collected) }} side={{ label: t('report.due'), value: money(totals.due) }} />
          <View style={{ marginTop: SP.lg }}>
            <Progress value={totals.total ? totals.visited / totals.total : 0} color="#ffffff" track="rgba(255,255,255,0.25)" />
            <Text style={{ color: C.onBrandMuted, marginTop: SP.sm, fontWeight: '600' }}>{t('dashboard.visited')}: {totals.visited} / {totals.total}</Text>
          </View>
        </>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SP.xl, rowGap: SP.sm }}>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: C.onBrand, fontSize: 34, fontWeight: '800' }}>{todays.length}</Text>
            <Text style={{ color: C.onBrandMuted, fontWeight: '600' }}>{t('mobile.myRoutes')}</Text>
          </View>
          <View style={{ flexShrink: 1 }}>
            <Text style={{ color: C.onBrand, fontSize: 34, fontWeight: '800' }}>{customersToday}</Text>
            <Text style={{ color: C.onBrandMuted, fontWeight: '600' }}>{t('nav.customers')}</Text>
          </View>
        </View>
      )}
    </Card>
  );

  const routeCards = (
    <View style={routeCols === 2 ? { flexDirection: 'row', flexWrap: 'wrap', columnGap: SP.md } : undefined}>
      {(routes ?? []).map((r) => {
        const p = progress[r.id];
        return (
          <Card key={r.id} onPress={() => nav.push('RouteDay', { routeId: r.id, name: r.name })} accessibilityLabel={r.name} style={routeW ? { width: routeW } : undefined}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
              <Avatar name={r.name} label={r.name.trim().slice(0, 1).toUpperCase()} color={r.collectsToday ? C.brand : C.grey} size={48} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{r.name}</Text>
                <Text style={[s.muted, { marginTop: 2 }]}>{r.location} · {r.customerCount} {t('nav.customers')}</Text>
              </View>
              <Chevron />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: SP.md, gap: SP.sm, flexWrap: 'wrap' }}>
              {r.collectsToday ? <Badge text={t('common.today')} color={C.brand} /> : <Badge text={t('mobile.notToday')} color={C.grey} />}
              {p && <Text style={{ fontWeight: '800', color: C.ok, fontSize: 16 }}>{money(p.collected)}</Text>}
            </View>
            {p && (
              <View style={{ marginTop: SP.md }}>
                <Progress value={p.total ? p.visited / p.total : 0} />
                <Text style={[s.muted, { marginTop: 6, fontSize: 13 }]}>{t('dashboard.visited')}: {p.visited} / {p.total}</Text>
              </View>
            )}
          </Card>
        );
      })}
    </View>
  );

  const shownActions = actions.filter((a) => a.show);
  const actionList = (
    <>
      <Section title={t('mobile.quickActions')} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.md, marginBottom: SP.md }}>
        {shownActions.map((a) => (
          <Pressable
            key={a.title}
            onPress={a.onPress}
            accessibilityRole="button"
            android_ripple={{ color: C.surface }}
            style={({ pressed }) => [
              { width: tileW, minHeight: 112, backgroundColor: C.panel, borderRadius: R.lg, borderWidth: 1, borderColor: C.line, padding: SP.lg, justifyContent: 'space-between', gap: SP.md, boxShadow: '0px 1px 2px rgba(16, 40, 36, 0.06), 0px 2px 8px rgba(16, 40, 36, 0.05)' },
              pressed && { backgroundColor: '#f6f9f8', transform: [{ scale: 0.98 }] },
            ]}
          >
            <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: a.color + '1f', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={a.icon} size={24} color={a.color} />
            </View>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 20 }} numberOfLines={3}>{a.title}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );

  const main = (
    <>
      {todayCard}
      <SyncBar />
      {offline && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
      <ErrorText error={error} />
      <Section title={t('mobile.myRoutes')} />
      {routes && routes.length === 0 && <Notice tone="warn" text={t('mobile.noRoutes')} />}
      {routeCards}
    </>
  );

  return (
    <SafeAreaView style={s.safe} edges={['bottom', 'left', 'right']}>
      <View style={[s.header, { paddingTop: insets.top + SP.sm, paddingHorizontal: SP.md, paddingBottom: SP.md }]}>
        <View style={[s.headerInner, { gap: SP.sm, maxWidth: maxW }]}>
          <IconButton icon="menu" label={t('mobile.openMenu')} onPress={menu.open} />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.eyebrow} numberOfLines={1}>{profile?.tenant?.name ?? t('common.appName')}</Text>
            <Text style={[s.title, { fontSize: 20, lineHeight: 26 }]} numberOfLines={2}>{t('mobile.hello', { name: profile?.name?.split(' (')[0] ?? '' })}</Text>
          </View>
          <Pressable onPress={menu.open} accessibilityRole="button" accessibilityLabel={t('mobile.openMenu')} hitSlop={6}>
            <Avatar name={profile?.name ?? '?'} size={44} />
          </Pressable>
        </View>
      </View>
      <ScrollView contentContainerStyle={[s.body, { maxWidth: maxW + SP.lg * 2 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        {wide ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: SP.lg }}>
            <View style={{ flex: 3, minWidth: 0 }}>{main}</View>
            <View style={{ flex: 2, minWidth: 0 }}>{actionList}</View>
          </View>
        ) : (
          <>
            {main}
            {actionList}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
