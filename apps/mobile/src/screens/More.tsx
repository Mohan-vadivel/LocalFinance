import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { BASE, get, post } from '../api';
import { MapPins } from '../MapPins';
import { useSession } from '../session';
import { alertValues } from '../smart';
import { dismissFailed, getFailed, getQueue, getSynced, retryFailed, subscribe, sync, todaysCachedDays, type FailedItem, type QueueItem, type SyncedItem } from '../store';
import { Amount, AmountPair, Avatar, Badge, Btn, C, Card, Chevron, ErrorText, Field, Icon, Loading, Notice, Progress, Row, SP, Screen, Section, Stat, StatRow, money, s, todayIST, useNav } from '../ui';

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
  const [confirmDismiss, setConfirmDismiss] = useState<string | null>(null);
  const [retrying, setRetrying] = useState<string | null>(null);
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
  const retry = async (ref: string) => {
    setRetrying(ref);
    await retryFailed(ref);
    setRetrying(null);
  };

  return (
    <Screen title={t('mobile.daySummary')} scroll={false}>
      <ScrollView contentContainerStyle={s.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load()} colors={[C.brand]} />}>
        <ErrorText error={error} />
        <EndDay queued={queue.length} failed={failed.length} cash={day ? day.cashInHand + pendingCash : null} handedOver={!!day?.handover} />
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
        {failed.length > 0 && (
          <Card>
            <Text style={[s.h2, { color: C.danger }]}>{t('mobile.failedTitle')}</Text>
            {failed.map((f) => (
              <View key={f.item.clientRef} style={{ borderTopWidth: 1, borderColor: C.line, paddingVertical: SP.md }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink, flexShrink: 1 }}>{f.item.customerName}{f.item.kind === 'collection' ? ` · ${money(f.item.amount)}` : ''}</Text>
                <Text style={{ color: C.danger }}>{f.error}</Text>
                {/* Dismiss asks first, inline (Alert does nothing on the web build). */}
                {confirmDismiss === f.item.clientRef ? (
                  <View style={{ marginTop: SP.sm }}>
                    <Notice tone="warn" text={f.item.kind === 'collection' ? t('mobile.dismissConfirm', { amount: money(f.item.amount), name: f.item.customerName }) : t('mobile.dismissConfirmVisit', { name: f.item.customerName })} />
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm }}>
                      <Btn small kind="danger" title={t('mobile.dismissYes')} onPress={() => { setConfirmDismiss(null); void dismissFailed(f.item.clientRef); }} style={{ flexGrow: 1 }} />
                      <Btn small kind="outline" title={t('mobile.keep')} onPress={() => setConfirmDismiss(null)} style={{ flexGrow: 1 }} />
                    </View>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.sm }}>
                    <Btn small kind="tonal" title={t('mobile.retry')} onPress={() => void retry(f.item.clientRef)} busy={retrying === f.item.clientRef} />
                    <Btn small kind="outline" title={t('mobile.dismiss')} onPress={() => setConfirmDismiss(f.item.clientRef)} />
                  </View>
                )}
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

/**
 * "End my day": what must be true before handing over cash. Not-visited counts come from today's route copies on
 * the phone, so this works offline too.
 */
function EndDay({ queued, failed, cash, handedOver }: { queued: number; failed: number; cash: number | null; handedOver: boolean }) {
  const { t } = useTranslation();
  const [notVisited, setNotVisited] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const read = () =>
      void todaysCachedDays(todayIST()).then(({ days }) => setNotVisited(days.length ? days.reduce((sum, d) => sum + d.customers.filter((c) => c.pin === 'PENDING').length, 0) : null));
    read();
    return subscribe(read);
  }, []);
  const run = async () => {
    setBusy(true);
    const r = await sync();
    setMsg(r.offline ? t('common.offline') : '');
    setBusy(false);
  };
  const synced = queued === 0 && failed === 0;
  return (
    <Card>
      <Text style={s.h2}>{t('mobile.endDay')}</Text>
      <Check ok={synced} title={synced ? t('mobile.allSynced') : t('mobile.notSynced', { queued, failed })} detail={msg || (synced ? undefined : t('mobile.submitDayHelp'))}>
        {!synced && <Btn small kind="tonal" title={t('mobile.syncNow')} onPress={() => void run()} busy={busy} style={{ alignSelf: 'flex-start', marginTop: SP.sm }} />}
      </Check>
      <Check
        ok={notVisited === 0}
        warn
        title={notVisited == null ? t('mobile.routesNotDownloaded') : notVisited === 0 ? t('mobile.allVisited') : t('mobile.notVisitedCount', { count: notVisited })}
      />
      <Check ok={handedOver} warn title={handedOver ? t('handover.done') : `${t('mobile.cashToHandOver')}: ${money(cash)}`} detail={handedOver ? undefined : t('handover.pending')} />
      {synced && !handedOver && cash != null && <Notice text={t('mobile.readyHandover', { amount: money(cash) })} />}
    </Card>
  );
}

/** One line of the end-of-day checklist: a tick or a cross, a title and an optional detail or action. */
function Check({ ok, warn, title, detail, children }: { ok: boolean; warn?: boolean; title: string; detail?: string; children?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', gap: SP.md, alignItems: 'flex-start', borderTopWidth: 1, borderColor: C.line, paddingVertical: SP.md }}>
      <Icon name={ok ? 'checkmark-circle' : 'close-circle'} size={26} color={ok ? C.ok : warn ? C.warn : C.danger} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>{title}</Text>
        {detail ? <Text style={[s.muted, { marginTop: 2 }]}>{detail}</Text> : null}
        {children}
      </View>
    </View>
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

interface Brief { bullets: string[]; source: 'ai' | 'rules' }
interface Alert { kind: string; severity: 'high' | 'medium'; values: Record<string, string | number> }

export function Manager() {
  const { t, i18n } = useTranslation();
  const nav = useNav();
  const { can } = useSession();
  const [d, setD] = useState<Dash | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  // Morning briefing and unusual activity: only for staff who can see reports (agents never call these).
  const reports = can('report.view');
  const [brief, setBrief] = useState<Brief | null>(null);
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const lang = i18n.language;
  const load = useCallback(async () => {
    setRefreshing(true);
    if (reports) {
      void get<Brief>('/ai/briefing', { language: lang }).then(setBrief).catch(() => setBrief(null));
      void get<Alert[]>('/ai/alerts').then(setAlerts).catch(() => setAlerts(null));
    }
    try {
      setD(await get<Dash>('/dashboard'));
      setError(null);
    } catch (e) {
      setError(e);
    }
    setRefreshing(false);
  }, [reports, lang]);
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
            {reports && <Briefing brief={brief} alerts={alerts} />}
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

/** Morning briefing bullets and the top unusual-activity alerts, compact, above the agents. */
function Briefing({ brief, alerts }: { brief: Brief | null; alerts: Alert[] | null }) {
  const { t } = useTranslation();
  if (!brief && !alerts) return null;
  const top = [...(alerts ?? [])].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)).slice(0, 2);
  return (
    <Card>
      {brief && (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
            <Icon name="sunny" size={22} color={C.warn} />
            <Text style={[s.h2, { marginBottom: 0, flex: 1, minWidth: 0 }]}>{t('ai.brief.title')}</Text>
          </View>
          {brief.bullets.map((b, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: SP.sm, marginBottom: 6 }}>
              <Text style={{ color: C.brand, fontWeight: '800', fontSize: 15, lineHeight: 21 }}>•</Text>
              <Text style={{ flex: 1, color: C.ink, fontSize: 15, lineHeight: 21 }}>{b}</Text>
            </View>
          ))}
          <Text style={[s.muted, { fontSize: 12, marginTop: 2 }]}>{brief.source === 'ai' ? t('ai.brief.byAi') : t('ai.brief.byRules')}</Text>
        </>
      )}
      {alerts && (
        <View style={brief ? { borderTopWidth: 1, borderColor: C.line, marginTop: SP.md, paddingTop: SP.md } : undefined}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.sm, marginBottom: SP.sm }}>
            <Icon name="alert-circle" size={22} color={alerts.length ? C.danger : C.ok} />
            <Text style={{ fontSize: 16, fontWeight: '800', color: C.ink, flex: 1, minWidth: 0 }}>{t('ai.alerts.title')}</Text>
            {alerts.length > 0 && <Badge text={String(alerts.length)} color={C.danger} solid />}
          </View>
          {alerts.length === 0 && <Text style={s.muted}>{t('ai.alerts.none')}</Text>}
          {top.map((a, i) => (
            <View key={i} style={{ marginBottom: SP.sm, gap: 4 }}>
              <Badge text={t(`ai.alerts.${a.severity}`)} color={a.severity === 'high' ? C.danger : C.warn} />
              <Text style={{ color: C.ink, fontSize: 15, lineHeight: 21 }}>{t(`ai.alerts.${a.kind}`, alertValues(a.values))}</Text>
            </View>
          ))}
          {alerts.length > 2 && <Text style={[s.muted, { fontSize: 13 }]}>{t('ai.mobile.moreAlerts', { count: alerts.length - 2 })}</Text>}
        </View>
      )}
    </Card>
  );
}

// =====================================================================
// Settings: language, password, log out
// =====================================================================
export function Settings() {
  const { t } = useTranslation();
  const { profile, logout } = useSession();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [msg, setMsg] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
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
    <Screen title={t('mobile.accountSettings')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
        <Avatar name={profile?.name ?? '?'} size={52} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{profile?.name ?? ''}</Text>
          <Text style={s.muted}>{profile?.roleName ?? ''}</Text>
        </View>
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
    </Screen>
  );
}
