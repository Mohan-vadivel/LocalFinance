import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { MapPins } from '../MapPins';
import { getPosition, useSession } from '../session';
import { getVisitOrder, lastKnownHere, onVisitOrder, orderDay, setVisitOrder, type VisitOrder } from '../smart';
import { areaText, routeDay, subscribe, type DayCustomer, type PinStatus, type RouteDay as Day } from '../store';
import { AmountPair, Badge, Btn, C, Card, Chevron, Icon, IconButton, Notice, PIN_COLORS, Progress, R, SP, Screen, SearchFilter, Sheet, SheetOption, ToolButton, dateIN, money, s, useLayout, useNav, type IconName } from '../ui';
import { EmptyState, FailureState, LoadingState, NoSearchResults, useSlowLoad } from '../states';
import { FailedNotice, SyncButton } from './Home';
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
  const [show, setShow] = useState<'all' | PinStatus>('all');
  const [q, setQ] = useState('');
  const { can } = useSession();
  // Route order or smart order (remembered on the phone); smart order needs no connection and never waits for GPS.
  const [order, setOrder] = useState<VisitOrder>('route');
  const [here, setHere] = useState<{ lat: number; lng: number } | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [filtering, setFiltering] = useState(false);
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
  // Waiting for the day's list: after 8 seconds the screen says it is taking longer than usual.
  const slow = useSlowLoad(!day && !error && !offline);

  if (!day) return <Screen title={name}>{error || offline ? <FailureState error={error} offline={offline} onRetry={() => void load()} onBack={() => nav.pop()} /> : <LoadingState slow={slow.slow} onKeepWaiting={slow.keepWaiting} onCancel={() => nav.pop()} />}</Screen>;
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
    (c) => (show === 'all' || c.pin === show) && (!needle || c.name.toLowerCase().includes(needle) || (digits.length >= 3 && c.phone.replace(/\D/g, '').includes(digits))),
  );

  const filtered = show !== 'all' || order === 'smart';
  const counts = (k: 'all' | PinStatus) => (k === 'all' ? list.length : list.filter((c) => c.pin === k).length);
  const statusKeys = ['all', 'PENDING', 'PARTIAL', 'MISSED', 'PAID'] as const;

  return (
    <Screen
      title={name}
      subtitle={areaText(day.route) ? `${areaText(day.route)} · ${dateIN(day.date)}` : dateIN(day.date)}
      scroll={false}
      right={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: compact ? 2 : SP.xs }}>
          <IconButton icon="document-text-outline" label={t('mobile.sheet.button')} color={C.brandInk} onPress={() => nav.push('LineSheet', { routeId })} />
          {can('collection.record') && <IconButton icon="mic-outline" label={t('ai.voice.button')} color={C.brandInk} onPress={() => setSpeaking(true)} />}
          <SyncButton />
        </View>
      }
    >
      <VoiceSheet visible={speaking} customers={list} onClose={() => setSpeaking(false)} onCollect={(c, amount) => { setSpeaking(false); nav.push('Customer', { customer: c, routeId, amount }); }} />
      <FilterSheet
        visible={filtering}
        onClose={() => setFiltering(false)}
        show={show}
        setShow={setShow}
        order={order}
        statusKeys={statusKeys}
        counts={counts}
        shownCount={shown.length}
      />
      <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        {offline && <Notice tone="warn" text={t('mobile.offlineCopy')} />}
        {error ? <FailureState error={error} onRetry={() => void load()} onBack={() => nav.pop()} /> : null}
        <FailedNotice />
        <Card tone="brand" style={{ padding: SP.lg }}>
          <AmountPair onBrand main={{ label: t('report.collected'), value: money(collected) }} side={{ label: t('report.due'), value: money(due) }} />
          <View style={{ marginTop: SP.md }}>
            <Progress value={list.length ? done / list.length : 0} color="#ffffff" track="rgba(255,255,255,0.25)" />
            <Text style={{ color: C.onBrandMuted, marginTop: SP.sm, fontWeight: '600' }}>{t('dashboard.visited')}: {done} / {list.length}</Text>
          </View>
        </Card>
        {next && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.md }}>
            <Btn big icon="person" title={`${t('mobile.nextCustomer')}: ${label(next, list.indexOf(next))}. ${next.name}`} onPress={() => open(next)} style={{ flex: 1, marginBottom: 0 }} />
            {next.lat != null && next.lng != null && (
              <View style={{ backgroundColor: C.brandSoft, borderRadius: 30 }}>
                <IconButton icon="navigate" label={t('mobile.navigate')} color={C.brandInk} onPress={() => navigateTo(next.lat!, next.lng!)} />
              </View>
            )}
          </View>
        )}
        {/* Search, filter and list or map in one row, above the list where the thumb is. */}
        <SearchFilter
          value={q}
          onChangeText={setQ}
          placeholder={compact ? t('common.search') : t('mobile.filterRoute')}
          label={t('mobile.filterRoute')}
          onFilter={() => setFiltering(true)}
          filtered={filtered}
          extra={<ToolButton icon={view === 'map' ? 'list-outline' : 'map-outline'} label={view === 'map' ? t('mobile.listView') : t('mobile.mapView')} onPress={() => setView(view === 'map' ? 'list' : 'map')} on={view === 'map'} />}
        />
        {/* The filters in use, each with a cross to take it off. */}
        {filtered && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: -SP.xs, marginBottom: SP.md }}>
            {show !== 'all' && <FilterTag icon="funnel" text={`${t(`mobile.pins.${show}`)} (${counts(show)})`} onClear={() => setShow('all')} label={t('mobile.filters.clear')} />}
            {order === 'smart' && <FilterTag icon="sparkles" text={t('ai.visit.smart')} onClear={() => void setVisitOrder('route')} label={t('mobile.filters.clear')} />}
          </View>
        )}
        {/* The colour key is for the map pins; list rows carry their status in words. */}
        {view === 'map' && (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: SP.lg, rowGap: SP.sm, marginBottom: SP.md, paddingHorizontal: SP.xs }}>
            {(['PENDING', 'PAID', 'PARTIAL', 'MISSED', 'NOTHING_DUE'] as const).map((p) => (
              <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: PIN_COLORS[p] }} />
                <Text style={{ color: C.ink2, fontSize: 14 }}>{t(`mobile.pins.${p}`)}</Text>
              </View>
            ))}
          </View>
        )}
        {shown.length === 0 &&
          (needle ? (
            <NoSearchResults query={q.trim()} onClear={() => setQ('')} />
          ) : show === 'PENDING' ? (
            <EmptyState icon="checkmark-done" title={t('mobile.routeDone')} />
          ) : (
            <EmptyState icon="people-outline" title={t('common.noData')} help={t('states.empty.help')} />
          ))}
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
          shown.map((c) => {
            // The loan the collect form opens on (the first with something due) and its amount.
            const dueLoan = c.loans.find((l) => l.dueNow > 0);
            const quick = can('collection.record') && c.status === 'ACTIVE' && (c.pin === 'PENDING' || c.pin === 'PARTIAL') && dueLoan;
            return (
              <Card key={c.id} onPress={() => open(c)} accessibilityLabel={c.name} style={{ paddingVertical: 14, paddingLeft: SP.md, borderLeftWidth: 5, borderLeftColor: PIN_COLORS[c.pin] }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
                  <View style={[s.seq, { backgroundColor: PIN_COLORS[c.pin] }]}>
                    <Text style={s.seqText}>{label(c, list.indexOf(c))}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: SP.sm }}>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink, flexShrink: 1 }}>{c.name}</Text>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: c.dueNow ? C.ink : C.muted, fontVariant: ['tabular-nums'] }}>{money(c.dueNow)}</Text>
                    </View>
                    <Text style={[s.muted, { fontSize: 15 }]} numberOfLines={1}>{c.landmark ?? c.address}</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <Badge text={t(`mobile.pins.${c.pin}`)} color={PIN_COLORS[c.pin]} />
                      {c.paidToday ? <Text style={{ color: C.ok, fontWeight: '800' }}>{money(c.paidToday)}</Text> : null}
                      {c.lastVisit?.outcome === 'PROMISED' && c.lastVisit.promiseDate ? <Text style={{ color: C.warn, fontWeight: '700' }}>{dateIN(c.lastVisit.promiseDate)}</Text> : null}
                      {c.lat == null && <Text style={{ color: C.warn, fontSize: 13, fontWeight: '600' }}>{t('mobile.noGps')}</Text>}
                    </View>
                    {order === 'smart' && ordered.reasons[c.id]?.[0] && <ReasonChip reason={ordered.reasons[c.id][0]} />}
                  </View>
                  <Chevron />
                </View>
                {/* Straight to the collect form with the amount due filled in (the agent still checks and confirms). */}
                {quick && (
                  <Btn small kind="tonal" icon="cash-outline" title={t('mobile.collectNow', { amount: money(dueLoan.dueNow) })} onPress={() => nav.push('Customer', { customer: c, routeId, amount: dueLoan.dueNow })} style={{ marginTop: SP.md, marginLeft: 40 + SP.md }} />
                )}
              </Card>
            );
          })
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

/** A filter in use, shown under the search row with a cross that takes it off. */
function FilterTag({ icon, text, onClear, label }: { icon: IconName; text: string; onClear: () => void; label: string }) {
  return (
    <Pressable onPress={onClear} accessibilityRole="button" accessibilityLabel={`${label}: ${text}`} style={({ pressed }) => [{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.brandSoft, borderRadius: R.pill, paddingLeft: 12, paddingRight: 8, minHeight: 36 }, pressed && { opacity: 0.8 }]}>
      <Icon name={icon} size={15} color={C.brandInk} />
      <Text style={{ color: C.brandInk, fontWeight: '700', fontSize: 14 }}>{text}</Text>
      <Icon name="close-circle" size={18} color={C.brandInk} />
    </Pressable>
  );
}

/** Which customers to show (by today's status) and in what order, in one panel from the filter button. */
function FilterSheet({ visible, onClose, show, setShow, order, statusKeys, counts, shownCount }: { visible: boolean; onClose: () => void; show: 'all' | PinStatus; setShow: (v: 'all' | PinStatus) => void; order: VisitOrder; statusKeys: readonly ('all' | PinStatus)[]; counts: (k: 'all' | PinStatus) => number; shownCount: number }) {
  const { t } = useTranslation();
  const icons: Record<string, IconName> = { all: 'people-outline', PENDING: 'time-outline', PARTIAL: 'pie-chart-outline', MISSED: 'close-circle-outline', PAID: 'checkmark-circle-outline' };
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={t('mobile.filters.title')}
      footer={
        <View style={{ flexDirection: 'row', gap: SP.sm }}>
          <Btn kind="outline" title={t('mobile.filters.clear')} onPress={() => { setShow('all'); void setVisitOrder('route'); }} style={{ flexGrow: 1, flexBasis: 100, marginBottom: 0 }} />
          <Btn title={t('mobile.filters.show', { count: shownCount })} onPress={onClose} style={{ flexGrow: 2, flexBasis: 160, marginBottom: 0 }} />
        </View>
      }
    >
      <Text style={[s.label, { marginBottom: SP.sm }]}>{t('mobile.filters.status')}</Text>
      {statusKeys.map((k) => (
        <SheetOption key={k} icon={icons[k]} label={`${k === 'all' ? t('common.all') : t(`mobile.pins.${k}`)} (${counts(k)})`} on={show === k} onPress={() => setShow(k)} />
      ))}
      <Text style={[s.label, { marginTop: SP.md, marginBottom: SP.sm }]}>{t('mobile.filters.order')}</Text>
      <SheetOption icon="list-outline" label={t('ai.visit.normal')} sub={t('ai.visit.normalHelp')} on={order === 'route'} onPress={() => void setVisitOrder('route')} />
      <SheetOption icon="sparkles-outline" label={t('ai.visit.smart')} sub={t('ai.visit.smartHelp')} on={order === 'smart'} onPress={() => void setVisitOrder('smart')} />
    </Sheet>
  );
}
