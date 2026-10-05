import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MapPins } from '../MapPins';
import { getPosition, useSession } from '../session';
import { getVisitOrder, lastKnownHere, onVisitOrder, orderDay, setVisitOrder, type VisitOrder } from '../smart';
import { routeDay, subscribe, type DayCustomer, type RouteDay as Day } from '../store';
import { AmountPair, Badge, Btn, C, Card, Chevron, Chips, ErrorText, Field, Icon, IconButton, Loading, Notice, PIN_COLORS, Progress, R, SP, Screen, dateIN, money, s, useLayout, useNav } from '../ui';
import { SyncBar } from './Home';
import { VoiceSheet } from './Voice';

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
  const { compact, height } = useLayout();
  const [day, setDay] = useState<Day | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [view, setView] = useState<'map' | 'list'>('list');
  const [refreshing, setRefreshing] = useState(false);
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [show, setShow] = useState<'all' | 'pending'>('all');
  const [q, setQ] = useState('');
  const { can } = useSession();
  // Route order or smart order (remembered on the phone); smart order needs no connection and never waits for GPS.
  const [order, setOrder] = useState<VisitOrder>('route');
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  useEffect(() => {
    void getVisitOrder().then(setOrder);
    void lastKnownHere().then(setHere);
    return onVisitOrder(setOrder);
  }, []);

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
  const ordered = orderDay(day, order, here);
  const next = ordered.list.find((c) => c.pin === 'PENDING') ?? null;
  const done = list.filter((c) => c.pin !== 'PENDING').length;
  const collected = list.reduce((sum, c) => sum + c.paidToday, 0);
  const due = list.reduce((sum, c) => sum + c.dueNow + c.paidToday, 0);
  const open = (c: DayCustomer) => nav.push('Customer', { customer: c, routeId });
  const label = (c: DayCustomer, i: number) => String(c.routeSeq ?? i + 1);
  // Name or phone search and "not visited only", over the list and the map.
  const needle = q.trim().toLowerCase();
  const digits = needle.replace(/\D/g, '');
  const shown = ordered.list.filter(
    (c) => (show === 'all' || c.pin === 'PENDING') && (!needle || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))),
  );

  return (
    <Screen
      title={name}
      subtitle={day.route.location ? `${day.route.location} · ${dateIN(day.date)}` : dateIN(day.date)}
      scroll={false}
      right={
        can('collection.record') ? (
          <Pressable
            onPress={() => setSpeaking(true)}
            accessibilityRole="button"
            accessibilityLabel={t('ai.voice.button')}
            style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 14, borderRadius: R.pill, backgroundColor: pressed ? '#c9e8e1' : C.brandSoft }]}
          >
            <Icon name="mic" size={20} color={C.brandInk} />
            <Text style={{ color: C.brandInk, fontWeight: '800', fontSize: 15 }}>{t('ai.voice.button')}</Text>
          </Pressable>
        ) : undefined
      }
    >
      <VoiceSheet visible={speaking} customers={list} onClose={() => setSpeaking(false)} onCollect={(c, amount) => { setSpeaking(false); nav.push('Customer', { customer: c, routeId, amount }); }} />
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        {offline && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
        <ErrorText error={error} />
        <Card tone="brand" style={{ padding: SP.xl - 4 }}>
          <AmountPair onBrand main={{ label: t('report.collected'), value: money(collected) }} side={{ label: t('report.due'), value: money(due) }} />
          <View style={{ marginTop: SP.lg }}>
            <Progress value={list.length ? done / list.length : 0} color="#ffffff" track="rgba(255,255,255,0.25)" />
            <Text style={{ color: C.onBrandMuted, marginTop: SP.sm, fontWeight: '600' }}>{t('dashboard.visited')}: {done} / {list.length}</Text>
          </View>
        </Card>
        {next && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md }}>
            <Btn big title={`${t('mobile.nextCustomer')}: ${label(next, list.indexOf(next))}. ${next.name}`} onPress={() => open(next)} style={{ flex: 1, marginBottom: 0 }} />
            {next.lat != null && next.lng != null && (
              <View style={{ backgroundColor: C.brandSoft, borderRadius: 30 }}>
                <IconButton icon="navigate" label={t('mobile.navigate')} color={C.brandInk} onPress={() => navigateTo(next.lat!, next.lng!)} />
              </View>
            )}
          </View>
        )}
        <SyncBar />
        <Chips segmented value={view} onChange={setView} items={[{ key: 'list', label: t('mobile.listView') }, { key: 'map', label: t('mobile.mapView') }]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SP.lg, rowGap: SP.sm, marginBottom: SP.md, paddingHorizontal: SP.xs }}>
          {(['PENDING', 'PAID', 'PARTIAL', 'MISSED', 'NOTHING_DUE'] as const).map((p) => (
            <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: PIN_COLORS[p] }} />
              <Text style={[s.muted, { fontSize: 13 }]}>{t(`mobile.pins.${p}`)}</Text>
            </View>
          ))}
        </View>
        <Chips segmented value={order} onChange={(o) => void setVisitOrder(o)} items={[{ key: 'route', label: t('ai.visit.normal') }, { key: 'smart', label: t('ai.visit.smart') }]} />
        {order === 'smart' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -SP.sm, marginBottom: SP.md, paddingHorizontal: SP.xs }}>
            <Icon name="sparkles" size={16} color={C.brand} />
            <Text style={{ color: C.brandInk, fontWeight: '600', fontSize: 14, flexShrink: 1 }}>{t('ai.visit.smartOn')}</Text>
          </View>
        )}
        <Field label={t('mobile.filterRoute')} value={q} onChangeText={setQ} returnKeyType="search" />
        <Chips value={show} onChange={setShow} items={[{ key: 'all', label: `${t('common.all')} (${list.length})` }, { key: 'pending', label: `${t('mobile.pendingOnly')} (${list.filter((c) => c.pin === 'PENDING').length})` }]} />
        {shown.length === 0 && <Notice tone="info" text={t('mobile.noMatch')} />}
        {view === 'map' ? (
          <MapPins
            me={me}
            pins={shown.filter((c) => c.lat != null && c.lng != null).map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, label: label(c, list.indexOf(c)), title: `${c.name} · ${money(c.dueNow)}`, color: PIN_COLORS[c.pin] }))}
            onOpen={(id) => {
              const c = list.find((x) => x.id === id);
              if (c) open(c);
            }}
            // Most of the screen, but never so tall that the legend and switch scroll away (small phones, landscape tablets).
            height={Math.round(Math.min(560, Math.max(300, height * 0.6)))}
          />
        ) : (
          shown.map((c) => (
            <Card key={c.id} onPress={() => open(c)} accessibilityLabel={c.name} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, paddingVertical: 14 }}>
              <View style={[s.seq, { backgroundColor: PIN_COLORS[c.pin] }]}>
                <Text style={s.seqText}>{label(c, list.indexOf(c))}</Text>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                {/* On a phone under 400dp the amount sits beside the name, leaving the full width for the badges. */}
                {compact ? (
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.sm }}>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flexShrink: 1 }}>{c.name}</Text>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: c.dueNow ? C.ink : C.muted }}>{money(c.dueNow)}</Text>
                  </View>
                ) : (
                  <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{c.name}</Text>
                )}
                <Text style={s.muted} numberOfLines={1}>{c.landmark ?? c.address}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                  <Badge text={t(`mobile.pins.${c.pin}`)} color={PIN_COLORS[c.pin]} />
                  {c.paidToday ? <Text style={{ color: C.ok, fontWeight: '700' }}>{money(c.paidToday)}</Text> : null}
                  {c.lastVisit?.outcome === 'PROMISED' && c.lastVisit.promiseDate ? <Text style={{ color: C.warn, fontWeight: '600' }}>{c.lastVisit.promiseDate}</Text> : null}
                  {c.lat == null && <Text style={{ color: C.warn, fontSize: 13, fontWeight: '600' }}>{t('mobile.noGps')}</Text>}
                </View>
                {order === 'smart' && ordered.reasons[c.id]?.[0] && <ReasonChip reason={ordered.reasons[c.id][0]} />}
              </View>
              {!compact && (
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ fontSize: 18, fontWeight: '800', color: c.dueNow ? C.ink : C.muted }}>{money(c.dueNow)}</Text>
                </View>
              )}
              <Chevron />
            </Card>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

/** Why smart order put a customer here, as a small chip under the name. */
function ReasonChip({ reason }: { reason: { key: string; values?: Record<string, number> } }) {
  const { t } = useTranslation();
  const tone = reason.key === 'done' ? C.muted : reason.key === 'promiseMissed' || reason.key === 'late' ? C.danger : reason.key === 'promiseToday' || reason.key === 'usualTime' ? C.warn : C.brandInk;
  const bg = reason.key === 'done' ? C.surface : tone === C.danger ? C.dangerSoft : tone === C.warn ? C.warnSoft : C.brandSoft;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 5, marginTop: 6, backgroundColor: bg, borderRadius: R.pill, paddingHorizontal: 10, paddingVertical: 4, maxWidth: '100%' }}>
      <Icon name={reason.key === 'done' ? 'checkmark' : 'sparkles'} size={13} color={tone} />
      <Text style={{ color: tone, fontSize: 13, fontWeight: '700', flexShrink: 1 }} numberOfLines={1}>{t(`ai.visit.reasons.${reason.key}`, reason.values)}</Text>
    </View>
  );
}
