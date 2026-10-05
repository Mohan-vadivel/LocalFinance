import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text, View } from 'react-native';
import { get, newRef } from '../api';
import { getPosition, useSession } from '../session';
import { enqueue, routeDay, subscribe, type DayCustomer, type DayLoan } from '../store';
import { Amount, Avatar, Badge, Btn, C, Card, Chips, ErrorText, Field, Loading, Notice, PIN_COLORS, R, Row, SP, Screen, dateIN, money, s, toPaise, todayIST, useNav } from '../ui';
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

export default function Customer({ customer: initial, customerId, routeId }: { customer?: DayCustomer; customerId?: string; routeId?: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { can } = useSession();
  const [c, setC] = useState<DayCustomer | null>(initial ?? null);
  const [error, setError] = useState<unknown>(null);
  const [mode, setMode] = useState<'none' | 'collect' | 'visit'>('none');

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
      {mode === 'collect' && <CollectForm customer={c} routeId={routeId} onDone={() => setMode('none')} />}
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

function CollectForm({ customer, routeId, onDone }: { customer: DayCustomer; routeId?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [loanId, setLoanId] = useState(customer.loans.find((l) => l.dueNow > 0)?.id ?? customer.loans[0].id);
  const loan = customer.loans.find((l) => l.id === loanId)!;
  const [amount, setAmount] = useState(String((loan.dueNow || loan.instalmentAmount) / 100));
  const [payMode, setPayMode] = useState<'CASH' | 'UPI'>('CASH');
  const [upiRef, setUpiRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const paise = toPaise(amount);

  const save = async () => {
    setError(null);
    if (paise <= 0) return setError(t('mobile.enterAmount'));
    if (paise > loan.outstanding) return setError(t('collection.tooMuch'));
    setBusy(true);
    const pos = await getPosition();
    const r = await enqueue({
      kind: 'collection',
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
    });
    setBusy(false);
    setResult(r.offline || r.sent === 0 ? t('collection.savedOffline') : t('collection.saved'));
  };

  if (result) {
    return (
      <Card style={{ borderColor: C.ok, borderWidth: 1.5 }}>
        <Text style={[s.h2, { color: C.ok }]}>{result}</Text>
        <Text style={[s.big, { fontSize: 34, marginBottom: SP.lg }]} numberOfLines={1} adjustsFontSizeToFit>{money(paise)}</Text>
        <Btn big title={t('common.close')} onPress={onDone} style={{ marginBottom: 0 }} />
      </Card>
    );
  }
  return (
    <Card style={{ borderColor: C.brand, borderWidth: 1.5 }}>
      <Text style={s.h2}>{t('collection.record')}</Text>
      {customer.loans.length > 1 && <Chips value={loanId} onChange={(v) => { setLoanId(v); const l = customer.loans.find((x) => x.id === v)!; setAmount(String((l.dueNow || l.instalmentAmount) / 100)); }} items={customer.loans.map((l) => ({ key: l.id, label: l.number }))} />}
      <Field label={t('collection.amountCollected')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" prefix="₹" large />
      <Chips segmented value={payMode} onChange={setPayMode} items={[{ key: 'CASH', label: t('common.modes.CASH') }, { key: 'UPI', label: t('common.modes.UPI') }]} />
      {payMode === 'UPI' && (
        <>
          <Field label={t('collection.upiRef')} value={upiRef} onChangeText={setUpiRef} autoCapitalize="characters" />
          <Text style={[s.muted, { marginTop: -SP.sm, marginBottom: SP.lg }]}>{t('collection.upiNote')}</Text>
        </>
      )}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Notice tone="danger" text={error} />}
      <Btn big title={`${t('common.save')} ${money(paise)}`} onPress={() => void save()} busy={busy} />
      <Btn kind="ghost" title={t('common.cancel')} onPress={onDone} style={{ marginBottom: 0 }} />
    </Card>
  );
}

function VisitForm({ customer, routeId, onDone }: { customer: DayCustomer; routeId?: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [outcome, setOutcome] = useState<'NOT_HOME' | 'REFUSED' | 'PROMISED'>('NOT_HOME');
  const [promiseDate, setPromiseDate] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setError(null);
    if (outcome === 'PROMISED' && !/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) return setError(t('mobile.dateFormat'));
    if (outcome === 'PROMISED' && promiseDate < todayIST()) return setError(t('mobile.dateFormat'));
    setBusy(true);
    const pos = await getPosition();
    await enqueue({
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
    onDone();
  };
  return (
    <Card style={{ borderColor: C.lineStrong, borderWidth: 1.5 }}>
      <Text style={s.h2}>{t('collection.noPayment')}</Text>
      <Chips value={outcome} onChange={setOutcome} items={(['NOT_HOME', 'REFUSED', 'PROMISED'] as const).map((o) => ({ key: o, label: t(`collection.outcomes.${o}`) }))} />
      {outcome === 'PROMISED' && <Field label={`${t('collection.promiseDate')} (YYYY-MM-DD)`} value={promiseDate} onChangeText={setPromiseDate} placeholder={todayIST()} />}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Notice tone="danger" text={error} />}
      <Btn big title={t('common.save')} onPress={() => void save()} busy={busy} />
      <Btn kind="ghost" title={t('common.cancel')} onPress={onDone} style={{ marginBottom: 0 }} />
    </Card>
  );
}
