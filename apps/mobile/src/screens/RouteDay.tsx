import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MapPins } from '../MapPins';
import { getPosition } from '../session';
import { routeDay, subscribe, type DayCustomer, type RouteDay as Day } from '../store';
import { Btn, C, Card, Chips, ErrorText, Loading, Notice, PIN_COLORS, Screen, money, s, useNav } from '../ui';
import { SyncBar } from './Home';

/** Opens turn-by-turn directions in Google Maps (or any maps app). */
export function navigateTo(lat: number, lng: number) {
  const google = `google.navigation:q=${lat},${lng}`;
  void Linking.canOpenURL(google)
    .then((ok) => Linking.openURL(ok ? google : `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`))
    .catch(() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`));
}

export default function RouteDay({ routeId, name }: { routeId: string; name: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [day, setDay] = useState<Day | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<'map' | 'list'>('list');
  const [refreshing, setRefreshing] = useState(false);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);

  const load = useCallback(async () => {
    setRefreshing(true);
    const r = await routeDay(routeId);
    setDay(r.data);
    setOffline(r.offline);
    setError(r.error ?? null);
    setRefreshing(false);
  }, [routeId]);
  useEffect(() => {
    void load();
    void getPosition().then((p) => p && setMe(p));
    // Re-read after each saved collection or sync.
    return subscribe(() => void routeDay(routeId).then((r) => r.data && setDay(r.data)));
  }, [load, routeId]);

  if (!day) return <Screen title={name}>{error ? <ErrorText error={error} /> : <Loading />}</Screen>;
  const list = day.customers;
  const next = list.find((c) => c.pin === 'PENDING');
  const done = list.filter((c) => c.pin !== 'PENDING').length;
  const collected = list.reduce((sum, c) => sum + c.paidToday, 0);
  const due = list.reduce((sum, c) => sum + c.dueNow + c.paidToday, 0);
  const open = (c: DayCustomer) => nav.push('Customer', { customer: c, routeId });
  const label = (c: DayCustomer, i: number) => String(c.routeSeq ?? i + 1);

  return (
    <Screen title={name} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} />}>
        {offline && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
        <ErrorText error={error} />
        <Card>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View>
              <Text style={s.muted}>{t('report.collected')}</Text>
              <Text style={s.big}>{money(collected)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={s.muted}>{t('report.due')}</Text>
              <Text style={s.big}>{money(due)}</Text>
            </View>
          </View>
          <Text style={[s.muted, { marginTop: 6 }]}>{t('dashboard.visited')}: {done} / {list.length}</Text>
        </Card>
        {next && next.lat != null && next.lng != null && (
          <Btn title={`${t('mobile.nextCustomer')}: ${label(next, list.indexOf(next))}. ${next.name}`} onPress={() => navigateTo(next.lat!, next.lng!)} />
        )}
        <SyncBar />
        <Chips value={view} onChange={setView} items={[{ key: 'list', label: t('mobile.listView') }, { key: 'map', label: t('mobile.mapView') }]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
          {(['PENDING', 'PAID', 'PARTIAL', 'MISSED', 'NOTHING_DUE'] as const).map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PIN_COLORS[p] }} />
              <Text style={s.muted}>{t(`mobile.pins.${p}`)}</Text>
            </View>
          ))}
        </View>
        {view === 'map' ? (
          <MapPins
            me={me}
            pins={list.filter((c) => c.lat != null && c.lng != null).map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, label: label(c, list.indexOf(c)), title: `${c.name} · ${money(c.dueNow)}`, color: PIN_COLORS[c.pin] }))}
            onOpen={(id) => {
              const c = list.find((x) => x.id === id);
              if (c) open(c);
            }}
            height={460}
          />
        ) : (
          list.map((c, i) => (
            <Pressable key={c.id} onPress={() => open(c)} accessibilityRole="button">
              <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={[s.seq, { backgroundColor: PIN_COLORS[c.pin] }]}>
                  <Text style={s.seqText}>{label(c, i)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{c.name}</Text>
                  <Text style={s.muted} numberOfLines={1}>{c.landmark ?? c.address}</Text>
                  <Text style={{ color: PIN_COLORS[c.pin], fontWeight: '600' }}>
                    {t(`mobile.pins.${c.pin}`)}
                    {c.paidToday ? ` · ${money(c.paidToday)}` : ''}
                    {c.lastVisit?.outcome === 'PROMISED' && c.lastVisit.promiseDate ? ` · ${c.lastVisit.promiseDate}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: C.ink }}>{money(c.dueNow)}</Text>
                  {c.lat == null && <Text style={{ color: C.warn, fontSize: 12 }}>{t('mobile.noGps')}</Text>}
                </View>
              </Card>
            </Pressable>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
