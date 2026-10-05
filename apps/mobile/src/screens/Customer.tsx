import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Share, Text, View } from 'react-native';
import { addDays } from '@localfinance/shared';
import { get, newRef } from '../api';
import { getPosition, useSession } from '../session';
import { getVisitOrder, nextInOrder } from '../smart';
import { cachedRouteDay, enqueue, getSynced, isUnsent, removeQueued, routeDay, subscribe, type DayCustomer, type DayLoan } from '../store';
import { Amount, Avatar, Badge, Btn, C, Card, Chips, ErrorText, Field, Loading, Notice, PIN_COLORS, R, Row, SP, Screen, dateIN, money, s, toPaise, todayIST, useNav } from '../ui';
import { Reminder } from './Reminder';
import { navigateTo } from './RouteDay';

interface ApiCustomer {
  id: string;
  code: string;
  name: string;
  phone: string;
  address: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  routeSeq: number | null;
  status: string;
  loans: { id: string; number: string; principal: number; frequency: string; status: string; position: { totalOutstanding: number; overdue: number; dueToday: number; penaltyOutstanding: number; daysPastDue: number } | null }[];
}

/** A customer opened from search has the same shape as one from a route day (without payment history). */
function fromApi(c: ApiCustomer): DayCustomer {
  const loans: DayLoan[] = c.loans
    .filter((l) => l.status === 'ACTIVE' && l.position)
    .map((l) => ({
      id: l.id,
      number: l.number,
      principal: l.principal,
      frequency: l.frequency,
      instalmentAmount: 0,
      dueNow: l.position!.overdue + l.position!.dueToday + l.position!.penaltyOutstanding,
      dueToday: l.position!.dueToday,
      arrears: l.position!.overdue,
      penalty: l.position!.penaltyOutstanding,
      outstanding: l.position!.totalOutstanding,
      daysPastDue: l.position!.daysPastDue,
      lastPayments: [],
    }));
  const dueNow = loans.reduce((sum, l) => sum + l.dueNow, 0);
  return { ...c, dueNow, paidToday: 0, pin: dueNow === 0 ? 'NOTHING_DUE' : 'PENDING', lastVisit: null, loans };
}

/** `amount` (paise) opens the collect form with that amount filled in, e.g. from voice entry; the agent still confirms. */
export default function Customer({ customer: initial, customerId, routeId, amount: given }: { customer?: DayCustomer; customerId?: string; routeId?: string; amount?: number | null }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { can } = useSession();
  const [c, setC] = useState<DayCustomer | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'none' | 'collect' | 'visit' | 'reminder'>(given && initial?.loans.length ? 'collect' : 'none');

  useEffect(() => {
    if (!initial && customerId) {
      get<ApiCustomer>(`/customers/${customerId}`).then((x) => setC(fromApi(x))).catch(setError);
    }
  }, [initial, customerId]);
  useEffect(() => {
    if (!routeId || !initial) return;
    // Keep the screen in step with the route copy after a save or sync.
    return subscribe(() => void routeDay(routeId).then((r) => {
      const fresh = r.data?.customers.find((x) => x.id === initial.id);
      if (fresh) setC(fresh);
    }));
  }, [routeId, initial]);

  if (!c) return <Screen title={t('common.customer')}>{error ? <ErrorText error={error} /> : <Loading />}</Screen>;

  const actions = mode === 'none' && can('collection.record') && c.loans.length > 0;
  return (
    <Screen title={c.name} subtitle={`${c.code}${c.routeSeq ? ` · #${c.routeSeq}` : ''}`}>
      <ErrorText error={error} />
      <Card>
        <View style={{ flexDirection: 'row', gap: SP.md, alignItems: 'flex-start' }}>
          <Avatar name={c.name} color={PIN_COLORS[c.pin]} size={52} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Badge text={t(`mobile.pins.${c.pin}`)} color={PIN_COLORS[c.pin]} />
            <Text style={{ color: C.ink, fontSize: 16, fontWeight: '600', marginTop: SP.xs }}>{c.address}</Text>
            {c.landmark && <Text style={s.muted}>{c.landmark}</Text>}
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginTop: SP.lg }}>
          <Btn small kind="tonal" title={c.phone} onPress={() => void Linking.openURL(`tel:${c.phone}`)} style={{ flexGrow: 1, flexBasis: 120 }} />
          {c.lat != null && c.lng != null && <Btn small kind="tonal" title={t('mobile.navigate')} onPress={() => navigateTo(c.lat!, c.lng!)} style={{ flexGrow: 1, flexBasis: 120 }} />}
          {can('collection.record', 'report.view', 'customer.view') && mode !== 'reminder' && <Btn small kind="tonal" title={t('ai.reminder.button')} onPress={() => setMode('reminder')} style={{ flexGrow: 1, flexBasis: 120 }} />}
        </View>
      </Card>
      {c.status !== 'ACTIVE' && <Notice tone="danger" text={t(`customerMod.statuses.${c.status}`)} />}
      <Card>
        <Amount size="xl" label={t('collection.dueNow')} value={money(c.dueNow)} tone={c.dueNow > 0 ? C.ink : C.ok} />
        {(c.paidToday > 0 || c.lastVisit) && <View style={{ height: SP.sm }} />}
        {c.paidToday > 0 && <Row label={t('mobile.paidToday')} value={money(c.paidToday)} tone={C.ok} strong divider />}
        {c.lastVisit && <Row label={t('mobile.lastVisit')} value={`${t(`collection.outcomes.${c.lastVisit.outcome}`)}${c.lastVisit.promiseDate ? ` ${dateIN(c.lastVisit.promiseDate)}` : ''}`} divider={!(c.paidToday > 0)} />}
      </Card>
      {actions && (
        <View style={{ marginBottom: SP.sm }}>
          <Btn big title={t('collection.record')} onPress={() => setMode('collect')} />
          <Btn kind="outline" title={t('collection.noPayment')} onPress={() => setMode('visit')} />
        </View>
      )}
      {mode === 'reminder' && <Reminder customer={c} onDone={() => setMode('none')} />}
      {mode === 'collect' && <CollectForm customer={c} routeId={routeId} initialAmount={given ?? undefined} onDone={() => setMode('none')} />}
      {mode === 'visit' && <VisitForm customer={c} routeId={routeId} onDone={() => setMode('none')} />}
      {c.loans.map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: SP.sm, marginBottom: SP.sm, flexWrap: 'wrap' }}>
            <Text style={[s.h2, { marginBottom: 0, flexShrink: 1 }]}>{l.number}</Text>
            <Badge text={t(`product.frequencies.${l.frequency}`)} color={C.brand} />
          </View>
          {l.instalmentAmount > 0 && <Row label={t('loanMod.instalment')} value={money(l.instalmentAmount)} />}
          <Row label={t('collection.dueNow')} value={money(l.dueNow)} strong />
          <Row label={t('collection.arrears')} value={`${money(l.arrears)}${l.daysPastDue ? ` · ${l.daysPastDue} ${t('mobile.days')}` : ''}`} tone={l.arrears > 0 ? C.danger : undefined} />
          {l.penalty > 0 && <Row label={t('loanMod.penalty')} value={money(l.penalty)} tone={C.danger} />}
          <Row label={t('loanMod.outstanding')} value={money(l.outstanding)} />
          {l.lastPayments.length > 0 && (
            <View style={{ marginTop: SP.md, backgroundColor: C.bg, borderRadius: R.md, paddingHorizontal: SP.md, paddingVertical: SP.sm }}>
              <Text style={[s.label, { marginTop: SP.xs }]}>{t('collection.lastPayments')}</Text>
              {l.lastPayments.map((p, i) => (
                <Row key={i} label={`${dateIN(p.date)} · ${t(`common.modes.${p.mode}`)}`} value={money(p.amount)} />
              ))}
            </View>
          )}
        </Card>
      ))}
      {c.loans.length === 0 && <Notice tone="warn" text={t('mobile.noActiveLoan')} />}
      {mode === 'none' && can('loan.request') && c.status === 'ACTIVE' && (
        <Btn kind="tonal" title={t('mobile.requestLoan')} onPress={() => nav.push('LoanRequest', { customerId: c.id, customerName: c.name })} />
      )}
    </Screen>
  );
}

/** How long "Undo" stays after saving a collection (only while it is still on the phone). */
const UNDO_MS = 30_000;

/** `2026-10-05T04:30:00Z` → `05-10-2026 10:00` (IST). */
const istStamp = (iso: string) => {
  const d = new Date(Date.parse(iso) + 330 * 60_000).toISOString();
  return `${dateIN(d.slice(0, 10))} ${d.slice(11, 16)}`;
};

/** Opens the next customer on the route not visited yet (from the copy on the phone), in place of this one. */
function NextCustomer({ routeId, currentId }: { routeId: string; currentId: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [next, setNext] = useState<DayCustomer | null | undefined>(undefined);
  useEffect(() => {
    // In the order the agent chose on the route list (route order or smart order).
    const read = () => void Promise.all([cachedRouteDay(routeId), getVisitOrder()]).then(([d, order]) => setNext(d ? nextInOrder(d, order, currentId) : null));
    read();
    return subscribe(read);
  }, [routeId, currentId]);
  if (next === undefined) return null;
  if (!next) return <Notice tone="info" text={t('mobile.routeDone')} />;
  return <Btn big title={`${t('mobile.nextCustomer')}: ${next.routeSeq ? `${next.routeSeq}. ` : ''}${next.name}`} onPress={() => nav.replace('Customer', { customer: next, routeId })} />;
}

interface Saved { clientRef: string; at: string; amount: number; mode: 'CASH' | 'UPI'; upiRef: string | null; loanNumber: string; message: string }

function CollectForm({ customer, routeId, initialAmount, onDone }: { customer: DayCustomer; routeId?: string; initialAmount?: number; onDone: () => void }) {
  const { t } = useTranslation();
  const { profile } = useSession();
  const [loanId, setLoanId] = useState(customer.loans.find((l) => l.dueNow > 0)?.id ?? customer.loans[0].id);
  const loan = customer.loans.find((l) => l.id === loanId)!;
  const [amount, setAmount] = useState(String((initialAmount || loan.dueNow || loan.instalmentAmount) / 100));
  const [payMode, setPayMode] = useState<'CASH' | 'UPI'>('CASH');
  const [upiRef, setUpiRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const paise = toPaise(amount);

  // After saving: is it still only on the phone (so it can be undone), and its receipt number once the office has it.
  const [unsent, setUnsent] = useState(false);
  const [receiptNo, setReceiptNo] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!saved) return;
    const check = () => {
      void isUnsent(saved.clientRef).then(setUnsent);
      void getSynced().then((list) => setReceiptNo(list.find((x) => x.clientRef === saved.clientRef)?.receiptNo ?? null));
    };
    check();
    const unsub = subscribe(check);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const stop = setTimeout(() => clearInterval(tick), UNDO_MS + 1000);
    return () => {
      unsub();
      clearInterval(tick);
      clearTimeout(stop);
    };
  }, [saved]);

  // Quick amounts for the chosen loan; the chip whose amount is in the box shows as selected.
  const quick = [
    { key: 'due', label: t('collection.dueNow'), value: loan.dueNow },
    { key: 'inst', label: t('loanMod.instalment'), value: loan.instalmentAmount },
    { key: 'arrears', label: t('collection.arrears'), value: loan.arrears },
  ].filter((q) => q.value > 0);
  const quickOn = quick.find((q) => q.value === paise)?.key ?? '';

  const review = () => {
    setError(null);
    setInfo(null);
    if (paise <= 0) return setError(t('mobile.enterAmount'));
    if (paise > loan.outstanding) return setError(t('collection.tooMuch'));
    setConfirming(true);
  };

  const save = async () => {
    setBusy(true);
    const pos = await getPosition();
    const item = {
      kind: 'collection' as const,
      clientRef: newRef(),
      loanId,
      amount: paise,
      mode: payMode,
      upiRef: payMode === 'UPI' ? upiRef || null : null,
      note: note || null,
      collectedAt: new Date().toISOString(),
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      customerId: customer.id,
      customerName: customer.name,
      routeId,
    };
    const r = await enqueue(item);
    setBusy(false);
    setConfirming(false);
    setNow(Date.now());
    setSaved({ clientRef: item.clientRef, at: item.collectedAt, amount: paise, mode: payMode, upiRef: item.upiRef, loanNumber: loan.number, message: r.offline || r.sent === 0 ? t('collection.savedOffline') : t('collection.saved') });
  };

  const undo = async () => {
    if (!saved) return;
    if (!(await removeQueued(saved.clientRef))) {
      setUnsent(false);
      return setError(t('mobile.undoTooLate'));
    }
    setSaved(null);
    setError(null);
    setInfo(t('mobile.undone'));
  };

  const share = () => {
    if (!saved) return;
    const lines = [
      profile?.tenant?.name ?? t('common.appName'),
      t('receipt.title'),
      `${t('common.customer')}: ${customer.name} (${customer.code})`,
      `${t('common.loan')}: ${saved.loanNumber}`,
      `${t('common.amount')}: ${money(saved.amount)}`,
      `${t('common.mode')}: ${t(`common.modes.${saved.mode}`)}${saved.upiRef ? ` · ${saved.upiRef}` : ''}`,
      `${t('common.date')}: ${istStamp(saved.at)}`,
      `${t('collection.receiptNo')}: ${receiptNo ?? t('mobile.receiptPending')}`,
      t('receipt.thanks'),
    ];
    void Share.share({ message: lines.join('\n') }).catch(() => undefined);
  };

  if (saved) {
    const left = Math.max(0, Math.ceil((Date.parse(saved.at) + UNDO_MS - now) / 1000));
    return (
      <Card style={{ borderColor: C.ok, borderWidth: 1.5 }}>
        <Text style={[s.h2, { color: C.ok }]}>{receiptNo ? t('collection.saved') : saved.message}</Text>
        <Text style={[s.big, { fontSize: 34, marginBottom: SP.xs }]} numberOfLines={1} adjustsFontSizeToFit>{money(saved.amount)}</Text>
        <Text style={[s.muted, { marginBottom: SP.lg }]}>{saved.loanNumber} · {t(`common.modes.${saved.mode}`)} · {t('collection.receiptNo')}: {receiptNo ?? t('mobile.receiptPending')}</Text>
        {error && <Notice tone="danger" text={error} />}
        {routeId && <NextCustomer routeId={routeId} currentId={customer.id} />}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm }}>
          <Btn small kind="tonal" title={t('mobile.shareReceipt')} onPress={share} style={{ flexGrow: 1, flexBasis: 140 }} />
          {unsent && left > 0 && <Btn small kind="outline" title={`${t('mobile.undo')} (${left})`} onPress={() => void undo()} style={{ flexGrow: 1, flexBasis: 140 }} />}
        </View>
        <Btn kind="ghost" title={t('common.close')} onPress={onDone} style={{ marginBottom: 0 }} />
      </Card>
    );
  }
  if (confirming) {
    return (
      <Card style={{ borderColor: C.brand, borderWidth: 1.5 }}>
        <Text style={s.h2}>{t('mobile.confirmCollection')}</Text>
        <Amount size="xl" label={t('collection.amountCollected')} value={money(paise)} />
        <View style={{ height: SP.sm }} />
        <Row label={t('common.customer')} value={customer.name} divider />
        <Row label={t('common.loan')} value={loan.number} />
        <Row label={t('common.mode')} value={`${t(`common.modes.${payMode}`)}${payMode === 'UPI' && upiRef ? ` · ${upiRef}` : ''}`} />
        {paise > loan.dueNow && <Notice tone="warn" text={t('mobile.moreThanDue', { due: money(loan.dueNow) })} />}
        <View style={{ height: SP.md }} />
        <Btn big title={`${t('common.confirm')} ${money(paise)}`} onPress={() => void save()} busy={busy} />
        <Btn kind="outline" title={t('common.edit')} onPress={() => setConfirming(false)} disabled={busy} style={{ marginBottom: 0 }} />
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: C.brand, borderWidth: 1.5 }}>
      <Text style={s.h2}>{t('collection.record')}</Text>
      {info && <Notice tone="info" text={info} />}
      {customer.loans.length > 1 && <Chips value={loanId} onChange={(v) => { setLoanId(v); const l = customer.loans.find((x) => x.id === v)!; setAmount(String((l.dueNow || l.instalmentAmount) / 100)); }} items={customer.loans.map((l) => ({ key: l.id, label: l.number }))} />}
      <Field label={t('collection.amountCollected')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" prefix="₹" large />
      {quick.length > 0 && (
        <Chips value={quickOn} onChange={(k) => setAmount(String(quick.find((q) => q.key === k)!.value / 100))} items={quick.map((q) => ({ key: q.key, label: `${q.label} ${money(q.value)}` }))} />
      )}
      {paise > 0 && paise > loan.dueNow && <Notice tone="warn" text={t('mobile.moreThanDue', { due: money(loan.dueNow) })} />}
      <Chips segmented value={payMode} onChange={setPayMode} items={[{ key: 'CASH', label: t('common.modes.CASH') }, { key: 'UPI', label: t('common.modes.UPI') }]} />
      {payMode === 'UPI' && (
        <>
          <Field label={t('collection.upiRef')} value={upiRef} onChangeText={setUpiRef} autoCapitalize="characters" />
          <Text style={[s.muted, { marginTop: -SP.sm, marginBottom: SP.lg }]}>{t('collection.upiNote')}</Text>
        </>
      )}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Notice tone="danger" text={error} />}
      <Btn big title={`${t('common.save')} ${money(paise)}`} onPress={review} />
      <Btn kind="ghost" title={t('common.cancel')} onPress={onDone} style={{ marginBottom: 0 }} />
    </Card>
  );
}

function VisitForm({ customer, routeId, onDone }: { customer: DayCustomer; routeId?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<'NOT_HOME' | 'REFUSED' | 'PROMISED'>('NOT_HOME');
  // A promise date is picked from chips; "Other date" opens the typed box.
  const [when, setWhen] = useState<'1' | '2' | '7' | 'other'>('1');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const promiseDate = when === 'other' ? typed.trim() : addDays(todayIST(), Number(when));
  const save = async () => {
    setError(null);
    if (outcome === 'PROMISED' && !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) return setError(t('mobile.dateFormat'));
    if (outcome === 'PROMISED' && promiseDate < todayIST()) return setError(t('mobile.dateFormat'));
    setBusy(true);
    const pos = await getPosition();
    const r = await enqueue({
      kind: 'visit',
      clientRef: newRef(),
      customerId: customer.id,
      loanId: customer.loans[0]?.id ?? null,
      outcome,
      promiseDate: outcome === 'PROMISED' ? promiseDate : null,
      note: note || null,
      visitedAt: new Date().toISOString(),
      lat: pos?.lat ?? null,
      lng: pos?.lng ?? null,
      customerName: customer.name,
      routeId,
    });
    setBusy(false);
    setDone(r.offline || r.sent === 0 ? t('mobile.visitSavedOffline') : t('mobile.visitSaved'));
  };
  if (done) {
    return (
      <Card style={{ borderColor: C.ok, borderWidth: 1.5 }}>
        <Notice text={done} />
        {routeId && <NextCustomer routeId={routeId} currentId={customer.id} />}
        <Btn kind="ghost" title={t('common.close')} onPress={onDone} style={{ marginBottom: 0 }} />
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: C.lineStrong, borderWidth: 1.5 }}>
      <Text style={s.h2}>{t('collection.noPayment')}</Text>
      <Chips value={outcome} onChange={setOutcome} items={(['NOT_HOME', 'REFUSED', 'PROMISED'] as const).map((o) => ({ key: o, label: t(`collection.outcomes.${o}`) }))} />
      {outcome === 'PROMISED' && (
        <>
          <Text style={s.label}>{t('collection.promiseDate')}</Text>
          <Chips
            value={when}
            onChange={setWhen}
            items={[
              { key: '1', label: t('mobile.tomorrow') },
              { key: '2', label: t('mobile.inDays', { count: 2 }) },
              { key: '7', label: t('mobile.inAWeek') },
              { key: 'other', label: t('mobile.otherDate') },
            ]}
          />
          {when === 'other' ? (
            <Field label={`${t('mobile.otherDate')} (YYYY-MM-DD)`} value={typed} onChangeText={setTyped} placeholder={addDays(todayIST(), 3)} />
          ) : (
            <Text style={[s.muted, { marginTop: -SP.sm, marginBottom: SP.lg }]}>{t('collection.promiseDate')}: {dateIN(promiseDate)}</Text>
          )}
        </>
      )}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Notice tone="danger" text={error} />}
      <Btn big title={t('common.save')} onPress={() => void save()} busy={busy} />
      <Btn kind="ghost" title={t('common.cancel')} onPress={onDone} style={{ marginBottom: 0 }} />
    </Card>
  );
}
