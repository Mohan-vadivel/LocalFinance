import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Animated, Easing, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useDialog } from '../Dialog';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appbar, Text } from 'react-native-paper';
import { get } from '../api';
import { useSession } from '../session';
import { areaText, cachedRouteDay, getFailed, getLastSync, getQueue, myRoutes, subscribe, sync, type MyRoute } from '../store';
import { AmountPair, Avatar, Badge, Btn, C, Card, Chevron, Icon, MAX_W, MAX_W_WIDE, MenuCtx, Notice, Progress, R, SP, SearchBar, Section, dateIN, money, s, todayIST, useLayout, useNav, useScreenEdges, type IconName } from '../ui';
import { EmptyState, FailureState, SkeletonList } from '../states';

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

/**
 * Sync now, as a round button for the top bar. A badge shows how many entries wait on the phone (orange) or were
 * refused by the office (red); the arrows turn while it runs. With refused entries and nothing waiting, it opens the
 * day summary where they are retried or removed.
 */
export function SyncButton({ onBrand }: { onBrand?: boolean }) {
  const { t } = useTranslation();
  const nav = useNav();
  const dialog = useDialog();
  const st = useSyncState();
  const [busy, setBusy] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!busy) return;
    const loop = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => {
      loop.stop();
      spin.setValue(0);
    };
  }, [busy, spin]);
  const run = async () => {
    if (st.failed > 0 && !st.pending) return nav.push('Summary');
    setBusy(true);
    const r = await sync();
    setBusy(false);
    if (r.offline) void dialog.alert({ tone: 'warning', icon: 'cloud-offline-outline', title: t('states.offline.title'), text: t('states.offline.safe') });
    else if (r.failed > 0) void dialog.alert({ tone: 'danger', icon: 'alert', title: t('mobile.failedTitle'), text: t('mobile.failedItems', { count: r.failed }) });
    else if (r.sent > 0) void dialog.alert({ tone: 'success', title: t('mobile.allSynced'), timer: 1600 });
  };
  const count = st.pending || st.failed;
  const badge = st.failed > 0 && !st.pending ? C.danger : C.warn;
  const fg = onBrand ? C.onBrand : C.brandInk;
  const time = st.lastSync ? new Date(st.lastSync).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-';
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Pressable
      onPress={() => void run()}
      disabled={busy}
      hitSlop={4}
      accessibilityRole="button"
      accessibilityLabel={`${busy ? t('mobile.syncing') : t('mobile.syncNow')}. ${count ? `${t('mobile.pendingSync')}: ${count}` : t('mobile.allSynced')}. ${t('mobile.lastSync')}: ${time}`}
      style={({ pressed }) => [{ width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: onBrand ? 'rgba(255,255,255,0.16)' : C.brandSoft }, pressed && { opacity: 0.75 }]}
    >
      <Animated.View style={{ transform: [{ rotate }] }}>
        <Icon name="sync" size={23} color={fg} />
      </Animated.View>
      {count ? (
        <View style={{ position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: badge, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.panel }}>
          <Text style={{ color: '#fff', fontSize: 11, fontWeight: '800', lineHeight: 13 }}>{count > 99 ? '99+' : count}</Text>
        </View>
      ) : (
        <View style={{ position: 'absolute', top: 2, right: 2, width: 12, height: 12, borderRadius: 6, backgroundColor: C.ok, borderWidth: 2, borderColor: C.panel }} />
      )}
    </Pressable>
  );
}

/** A slim warning under the header while the office has refused entries; opens the day summary to fix them. */
export function FailedNotice() {
  const { t } = useTranslation();
  const nav = useNav();
  const st = useSyncState();
  if (!st.failed) return null;
  return (
    <Pressable onPress={() => nav.push('Summary')} accessibilityRole="button" style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, backgroundColor: C.dangerSoft, borderRadius: R.md, paddingHorizontal: SP.md, minHeight: 48, marginBottom: SP.md }, pressed && { opacity: 0.85 }]}>
      <Icon name="alert-circle" size={20} color={C.danger} />
      <Text style={{ flex: 1, color: C.danger, fontWeight: '700' }}>{t('mobile.failedItems', { count: st.failed })}</Text>
      <Chevron color={C.danger} />
    </Pressable>
  );
}

/** Progress of a route today, from the copy last downloaded on this phone. */
interface DayProgress { visited: number; total: number; collected: number; due: number }

export default function Home() {
  const { t } = useTranslation();
  const nav = useNav();
  const insets = useSafeAreaInsets();
  const edges = useScreenEdges();
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
  // Managers and owners: the branch's figures for today on the home card (the same figures as "Team today").
  const [team, setTeam] = useState<{ dueToday: number; collectedToday: number; collectionRate: number | null } | null>(null);
  useEffect(() => {
    if (isManager && refreshing) void get<{ dueToday: number; collectedToday: number; collectionRate: number | null }>('/dashboard').then(setTeam).catch(() => setTeam(null));
  }, [isManager, refreshing]);
  const canSearch = can('customer.view', 'collection.record');

  const todays = (routes ?? []).filter((r) => r.collectsToday);
  const known = Object.values(progress);
  const totals = known.reduce((a, p) => ({ visited: a.visited + p.visited, total: a.total + p.total, collected: a.collected + p.collected, due: a.due + p.due }), { visited: 0, total: 0, collected: 0, due: 0 });
  const customersToday = todays.reduce((sum, r) => sum + r.customerCount, 0);

  // The most used places, as tiles. Everything else (and settings) is in the side menu.
  const actions: { title: string; icon: IconName; color: string; onPress: () => void; show: boolean }[] = [
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
  // The route to open from "Start collecting": the first of today's routes with someone not visited yet.
  const startRoute = todays.find((r) => !progress[r.id] || progress[r.id].visited < progress[r.id].total) ?? null;
  const tileArea = wide ? ((contentW - SP.lg) * 2) / 5 : contentW;
  const tileW = Math.floor((tileArea - SP.md * (tileCols - 1)) / tileCols);

  const todayCard = (
    <Card tone="brand" style={{ padding: SP.xl - 4 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP.md, gap: SP.sm, flexWrap: 'wrap' }}>
        <Text style={{ color: C.onBrand, fontWeight: '800', fontSize: 16, flexShrink: 1 }}>{team && todays.length === 0 ? t('mobile.branchToday') : t('common.today')}</Text>
        <Text style={{ color: C.onBrandMuted, fontWeight: '600' }}>{dateIN(todayIST())}</Text>
      </View>
      {team && todays.length === 0 ? (
        <>
          <AmountPair onBrand main={{ label: t('dashboard.collectedToday'), value: money(team.collectedToday) }} side={{ label: t('dashboard.dueToday'), value: money(team.dueToday) }} />
          <View style={{ marginTop: SP.lg }}>
            <Progress value={(team.collectionRate ?? 0) / 100} color="#ffffff" track="rgba(255,255,255,0.25)" />
            <Text style={{ color: C.onBrandMuted, marginTop: SP.sm, fontWeight: '600' }}>{t('dashboard.collectionRate')}: {team.collectionRate == null ? '-' : `${team.collectionRate}%`}</Text>
          </View>
        </>
      ) : known.length > 0 ? (
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
      {/* The main job of the day, one tap from home: open today's route at the next customer. */}
      {startRoute && can('collection.record') ? (
        <Btn big icon="play" kind="light" title={t('mobile.startRoute')} onPress={() => nav.push('RouteDay', { routeId: startRoute.id, name: startRoute.name })} style={{ marginTop: SP.lg, marginBottom: 0 }} />
      ) : team && todays.length === 0 ? (
        <Btn icon="people" kind="light" title={t('mobile.managerView')} onPress={() => nav.push('Manager')} style={{ marginTop: SP.lg, marginBottom: 0 }} />
      ) : null}
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
                <Text style={[s.muted, { marginTop: 2 }]}>{areaText(r)} · {r.customerCount} {t('nav.customers')}</Text>
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
          <Card key={a.title} onPress={a.onPress} accessibilityLabel={a.title} style={{ width: tileW, minHeight: 92, marginBottom: 0, padding: 14, justifyContent: 'flex-start', gap: SP.sm }}>
            <View style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: a.color + '1f', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={a.icon} size={22} color={a.color} />
            </View>
            <Text style={{ fontSize: 15, fontWeight: '700', color: C.ink, lineHeight: 20 }}>{a.title}</Text>
          </Card>
        ))}
      </View>
    </>
  );

  const main = (
    <>
      {canSearch && <SearchBar placeholder={t('mobile.search')} onPress={() => nav.push('Search')} />}
      <FailedNotice />
      {todayCard}
      {/* No connection and nothing downloaded yet, or a failed load: say so in place of the route list. */}
      {error || (offline && !routes?.length) ? <FailureState error={error} offline={offline} onRetry={() => void load()} /> : null}
      {offline && !!routes?.length && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
      {/* A manager or owner without routes of their own sees no empty "My routes" section. */}
      {!(isManager && routes?.length === 0) && <Section title={t('mobile.myRoutes')} />}
      {routes === null && !error ? <SkeletonList rows={2} /> : null}
      {routes && routes.length === 0 && !isManager && !error && !offline && <EmptyState icon="map-outline" title={t('mobile.noRoutes')} help={t('states.empty.routesHelp')} />}
      {routeCards}
    </>
  );

  return (
    <SafeAreaView style={s.safe} edges={edges}>
      {/* Paper app bar: menu, the business and greeting, and the user's initial (also opens the menu). */}
      <Appbar.Header mode="small" elevated={false} statusBarHeight={insets.top + SP.sm} style={s.header}>
        <View style={[s.headerInner, { maxWidth: maxW }]}>
          <Appbar.Action icon="menu" onPress={menu.open} color={C.ink} size={24} accessibilityLabel={t('mobile.openMenu')} style={s.appbarAction} />
          <View style={s.titleBlock}>
            <Text variant="labelMedium" style={s.eyebrow}>{profile?.tenant?.name ?? t('common.appName')}</Text>
            <Text variant="titleLarge" style={[s.title, { fontSize: 20, lineHeight: 26 }]}>{t('mobile.hello', { name: profile?.name?.split(' (')[0] ?? '' })}</Text>
          </View>
          <SyncButton />
          <Pressable onPress={() => nav.open('Settings')} accessibilityRole="button" accessibilityLabel={t('mobile.settings.title')} hitSlop={6}>
            <Avatar name={profile?.name ?? '?'} size={44} />
          </Pressable>
        </View>
      </Appbar.Header>
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
        {/* Development builds only: a preview of the standard screen states (not in the menu or tabs). */}
        {__DEV__ && <Btn kind="ghost" title={t('states.gallery.open')} onPress={() => nav.push('StatesGallery')} style={{ marginTop: SP.md }} />}
      </ScrollView>
    </SafeAreaView>
  );
}
