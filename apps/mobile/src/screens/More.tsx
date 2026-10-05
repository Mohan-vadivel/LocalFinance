import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { LANGUAGES } from '@localfinance/shared';
import { BASE, get, post } from '../api';
import { setLanguage } from '../i18n';
import { MapPins } from '../MapPins';
import { useSession } from '../session';
import { dismissFailed, getFailed, getQueue, getSynced, subscribe, sync, type FailedItem, type QueueItem, type SyncedItem } from '../store';
import { Amount, AmountPair, Avatar, Btn, C, Card, Chevron, Chips, ErrorText, Field, Loading, Notice, Progress, Row, SP, Screen, Section, Stat, StatRow, money, s, useNav } from '../ui';

// =====================================================================
// Day summary: today's totals from the server plus what is still on the phone
// =====================================================================
interface MyDay { date: string; collections: number; total: number; cash: number; upi: number; float: number; cashInHand: number; customersVisited: number; customersPaid: number; missed: number; handover: { received: number; difference: number } | null }

export function Summary() {
  const { t } = useTranslation();
  const [day, setDay] = useState<MyDay | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [failed, setFailed] = useState<FailedItem[]>([]);
  const [synced, setSynced] = useState<SyncedItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    await sync();
    setQueue(await getQueue());
    setFailed(await getFailed());
    setSynced(await getSynced());
    try {
      setDay(await get<MyDay>('/me/day'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void load();
    return subscribe(() => {
      void getQueue().then(setQueue);
      void getFailed().then(setFailed);
      void getSynced().then(setSynced);
    });
  }, [load]);
  const pendingCash = queue.filter((q) => q.kind === 'collection' && q.mode === 'CASH').reduce((sum, q) => sum + (q.kind === 'collection' ? q.amount : 0), 0);

  return (
    <Screen title={t('mobile.daySummary')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {day && (
          <>
            <Card tone="brand" style={{ padding: SP.xl - 4 }}>
              <Amount onBrand size="xl" label={t('report.collected')} value={money(day.total)} />
              <View style={{ flexDirection: 'row', columnGap: SP.xl, rowGap: SP.sm, marginTop: SP.md, flexWrap: 'wrap' }}>
                <Amount onBrand size="md" label={t('common.modes.CASH')} value={money(day.cash)} />
                <Amount onBrand size="md" label={t('common.modes.UPI')} value={money(day.upi)} />
              </View>
            </Card>
            <Card>
              <Amount label={t('dashboard.cashInHand')} value={money(day.cashInHand + pendingCash)} tone={C.brandInk} />
              <View style={{ height: SP.sm }} />
              <Row label={t('handover.float')} value={money(day.float)} divider />
              <Row label={t('handover.title')} value={day.handover ? `${money(day.handover.received)}${day.handover.difference ? ` (${money(day.handover.difference)})` : ''}` : t('handover.pending')} />
            </Card>
            <StatRow>
              <Stat label={t('mobile.customersVisited')} value={String(day.customersVisited)} />
              <Stat label={t('mobile.pins.PAID')} value={String(day.customersPaid)} tone={C.ok} />
              <Stat label={t('report.missed')} value={String(day.missed)} tone={day.missed ? C.danger : undefined} />
            </StatRow>
          </>
        )}
        {!day && !error && <Loading />}
        {queue.length > 0 && <Notice tone="warn" text={`${t('mobile.pendingSync')}: ${queue.length} · ${t('mobile.submitDayHelp')}`} />}
        {failed.length > 0 && (
          <Card>
            <Text style={[s.h2, { color: C.danger }]}>{t('mobile.failedTitle')}</Text>
            {failed.map((f) => (
              <View key={f.item.clientRef} style={{ borderTopWidth: 1, borderColor: C.line, paddingVertical: SP.md }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, flexShrink: 1 }}>{f.item.customerName}{f.item.kind === 'collection' ? ` · ${money(f.item.amount)}` : ''}</Text>
                <Text style={{ color: C.danger }}>{f.error}</Text>
                <Btn small kind="outline" title={t('mobile.dismiss')} onPress={() => void dismissFailed(f.item.clientRef)} style={{ alignSelf: 'flex-start', marginTop: SP.sm }} />
              </View>
            ))}
          </Card>
        )}
        {synced.length > 0 && (
          <Card>
            <Text style={s.h2}>{t('collection.receipt')}</Text>
            {synced.slice(0, 30).map((x, i) => (
              <Row key={x.clientRef} divider={i > 0} label={`${x.receiptNo ?? '-'} · ${x.customerName}`} value={x.amount ? money(x.amount) : t('collection.noPayment')} tone={x.amount ? C.ink : C.muted} />
            ))}
          </Card>
        )}
      </ScrollView>
    </Screen>
  );
}

// =====================================================================
// Manager view: agents now and route progress for the day
// =====================================================================
interface Dash {
  dueToday: number;
  collectedToday: number;
  collectionRate: number | null;
  agents: { agentId: string; name?: string; collected: number; cashInHand: number; handedOver: boolean; lastLat: number | null; lastLng: number | null; lastSeenAt: string | null }[];
  routes: { routeId: string; name: string; agents: (string | undefined)[]; customers: number; visited: number }[];
}

export function Manager() {
  const { t } = useTranslation();
  const nav = useNav();
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      setD(await get<Dash>('/dashboard'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return (
    <Screen title={t('mobile.managerView')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        {!d && !error && <Loading />}
        {d && (
          <>
            <Card tone="brand" style={{ padding: SP.xl - 4 }}>
              <AmountPair onBrand main={{ label: t('dashboard.collectedToday'), value: money(d.collectedToday) }} side={{ label: t('dashboard.dueToday'), value: money(d.dueToday) }} />
              <View style={{ marginTop: SP.lg }}>
                <Progress value={(d.collectionRate ?? 0) / 100} color="#ffffff" track="rgba(255,255,255,0.25)" />
                <Text style={{ color: C.onBrandMuted, marginTop: SP.sm, fontWeight: '600' }}>{t('dashboard.collectionRate')}: {d.collectionRate == null ? '-' : `${d.collectionRate}%`}</Text>
              </View>
            </Card>
            <Section title={t('mobile.liveAgents')} />
            {d.agents.some((a) => a.lastLat != null) && (
              <View style={{ marginBottom: SP.md }}>
                <MapPins height={260} pins={d.agents.filter((a) => a.lastLat != null && a.lastLng != null).map((a) => ({ id: a.agentId, lat: a.lastLat!, lng: a.lastLng!, label: (a.name ?? '?').slice(0, 1), title: `${a.name} · ${money(a.collected)}`, color: '#2563eb' }))} />
              </View>
            )}
            {d.agents.map((a) => (
              <Card key={a.agentId}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.sm }}>
                  <Avatar name={a.name ?? '?'} size={40} />
                  <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink, flex: 1, minWidth: 0 }}>{a.name}</Text>
                </View>
                <Row label={t('report.collected')} value={money(a.collected)} strong />
                <Row label={t('dashboard.cashInHand')} value={a.handedOver ? t('handover.done') : money(a.cashInHand)} />
                <Row label={t('staff.lastSeen')} value={a.lastSeenAt ? new Date(a.lastSeenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '-'} />
              </Card>
            ))}
            <Section title={t('dashboard.routeProgress')} />
            {d.routes.map((r) => (
              <Card key={r.routeId} onPress={() => nav.push('RouteDay', { routeId: r.routeId, name: r.name })} accessibilityLabel={r.name}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm }}>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={{ fontWeight: '800', fontSize: 17, color: C.ink }}>{r.name}</Text>
                    <Text style={s.muted}>{r.agents.filter(Boolean).join(', ')}</Text>
                  </View>
                  <Chevron />
                </View>
                <Row label={t('dashboard.visited')} value={`${r.visited} / ${r.customers}`} strong />
                <Progress value={r.customers ? r.visited / r.customers : 0} />
              </Card>
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// =====================================================================
// Settings: language, password, log out
// =====================================================================
export function Settings() {
  const { t, i18n } = useTranslation();
  const { profile, logout } = useSession();
  const [pending, setPending] = useState(0);
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void getQueue().then((q) => setPending(q.length));
    return subscribe(() => void getQueue().then((q) => setPending(q.length)));
  }, []);
  const changeLang = async (code: string) => {
    await setLanguage(code);
    await post('/auth/language', { language: code }).catch(() => undefined);
  };
  const changePassword = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/auth/password', pw);
      setMsg(t('common.saved'));
      // The server ends all sessions after a password change.
      await logout();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={t('common.settings')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
        <Avatar name={profile?.name ?? '?'} size={52} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{profile?.name ?? ''}</Text>
          <Text style={s.muted}>{profile?.roleName ?? ''}</Text>
        </View>
      </Card>
      <Card>
        <Text style={s.h2}>{t('common.language')}</Text>
        <Chips segmented value={i18n.language} onChange={(v) => void changeLang(v)} items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))} />
      </Card>
      <Card>
        <Text style={s.h2}>{t('auth.changePassword')}</Text>
        <Field label={t('auth.currentPassword')} value={pw.currentPassword} onChangeText={(v) => setPw({ ...pw, currentPassword: v })} secureTextEntry />
        <Field label={t('auth.newPassword')} value={pw.newPassword} onChangeText={(v) => setPw({ ...pw, newPassword: v })} secureTextEntry />
        <ErrorText error={error} />
        {msg ? <Notice text={msg} /> : null}
        <Btn kind="tonal" title={t('common.save')} onPress={() => void changePassword()} busy={busy} disabled={pw.newPassword.length < 8 || pw.currentPassword.length < 6} />
      </Card>
      <Card>
        <Row label={t('common.name')} value={profile?.name ?? ''} />
        <Row label={t('staff.role')} value={profile?.roleName ?? ''} divider />
        <Row label="API" value={BASE} divider />
      </Card>
      {pending > 0 && <Notice tone="danger" text={t('mobile.logoutPending', { count: pending })} />}
      <Btn kind="danger" title={t('common.logout')} onPress={() => void logout()} disabled={pending > 0} />
    </Screen>
  );
}
