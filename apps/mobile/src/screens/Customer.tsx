import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, Text, View } from 'react-native';
import { get, newRef } from '../api';
import { getPosition, useSession } from '../session';
import { enqueue, routeDay, subscribe, type DayCustomer, type DayLoan } from '../store';
import { Badge, Btn, C, Card, Chips, ErrorText, Field, Loading, Notice, PIN_COLORS, Row, Screen, dateIN, money, s, toPaise, todayIST, useNav } from '../ui';
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

  return (
    <Screen title={c.name}>
      <ErrorText error={error} />
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <Text style={s.muted}>{c.code}{c.routeSeq ? ` · #${c.routeSeq}` : ''}</Text>
          <Badge text={t(`mobile.pins.${c.pin}`)} color={PIN_COLORS[c.pin]} />
        </View>
        <Text style={{ color: C.ink, fontSize: 15 }}>{c.address}</Text>
        {c.landmark && <Text style={s.muted}>{c.landmark}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
          <Btn small kind="plain" title={`📞 ${c.phone}`} onPress={() => void Linking.openURL(`tel:${c.phone}`)} />
          {c.lat != null && c.lng != null && <Btn small kind="plain" title={t('mobile.navigate')} onPress={() => navigateTo(c.lat!, c.lng!)} />}
        </View>
      </Card>
      {c.status !== 'ACTIVE' && <Notice tone="danger" text={t(`customerMod.statuses.${c.status}`)} />}
      <Card>
        <Row label={t('collection.dueNow')} value={money(c.dueNow)} strong />
        {c.paidToday > 0 && <Row label={t('mobile.paidToday')} value={money(c.paidToday)} />}
        {c.lastVisit && <Row label={t('mobile.lastVisit')} value={`${t(`collection.outcomes.${c.lastVisit.outcome}`)}${c.lastVisit.promiseDate ? ` ${dateIN(c.lastVisit.promiseDate)}` : ''}`} />}
      </Card>
      {c.loans.map((l) => (
        <Card key={l.id}>
          <Text style={s.h2}>{l.number} · {t(`product.frequencies.${l.frequency}`)}</Text>
          {l.instalmentAmount > 0 && <Row label={t('loanMod.instalment')} value={money(l.instalmentAmount)} />}
          <Row label={t('collection.dueNow')} value={money(l.dueNow)} strong />
          <Row label={t('collection.arrears')} value={`${money(l.arrears)}${l.daysPastDue ? ` · ${l.daysPastDue} ${t('mobile.days')}` : ''}`} />
          {l.penalty > 0 && <Row label={t('loanMod.penalty')} value={money(l.penalty)} />}
          <Row label={t('loanMod.outstanding')} value={money(l.outstanding)} />
          {l.lastPayments.length > 0 && (
            <View style={{ marginTop: 8 }}>
              <Text style={s.label}>{t('collection.lastPayments')}</Text>
              {l.lastPayments.map((p, i) => (
                <Row key={i} label={`${dateIN(p.date)} · ${t(`common.modes.${p.mode}`)}`} value={money(p.amount)} />
              ))}
            </View>
          )}
        </Card>
      ))}
      {c.loans.length === 0 && <Notice tone="warn" text={t('mobile.noActiveLoan')} />}
      {mode === 'none' && can('collection.record') && c.loans.length > 0 && (
        <>
          <Btn title={t('collection.record')} onPress={() => setMode('collect')} />
          <Btn kind="plain" title={t('collection.noPayment')} onPress={() => setMode('visit')} />
        </>
      )}
      {mode === 'collect' && <CollectForm customer={c} routeId={routeId} onDone={() => setMode('none')} />}
      {mode === 'visit' && <VisitForm customer={c} routeId={routeId} onDone={() => setMode('none')} />}
      {mode === 'none' && can('loan.request') && c.status === 'ACTIVE' && (
        <Btn kind="plain" title={t('mobile.requestLoan')} onPress={() => nav.push('LoanRequest', { customerId: c.id, customerName: c.name })} />
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
      <Card>
        <Notice text={`${result}: ${money(paise)}`} />
        <Btn title={t('common.close')} onPress={onDone} />
      </Card>
    );
  }
  return (
    <Card>
      <Text style={s.h2}>{t('collection.record')}</Text>
      {customer.loans.length > 1 && <Chips value={loanId} onChange={(v) => { setLoanId(v); const l = customer.loans.find((x) => x.id === v)!; setAmount(String((l.dueNow || l.instalmentAmount) / 100)); }} items={customer.loans.map((l) => ({ key: l.id, label: l.number }))} />}
      <Field label={t('collection.amountCollected')} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
      <Chips value={payMode} onChange={setPayMode} items={[{ key: 'CASH', label: t('common.modes.CASH') }, { key: 'UPI', label: t('common.modes.UPI') }]} />
      {payMode === 'UPI' && (
        <>
          <Field label={t('collection.upiRef')} value={upiRef} onChangeText={setUpiRef} autoCapitalize="characters" />
          <Text style={[s.muted, { marginBottom: 10 }]}>{t('collection.upiNote')}</Text>
        </>
      )}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Text style={s.error}>{error}</Text>}
      <Btn title={`${t('common.save')} ${money(paise)}`} onPress={() => void save()} busy={busy} />
      <Btn kind="plain" title={t('common.cancel')} onPress={onDone} />
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
    <Card>
      <Text style={s.h2}>{t('collection.noPayment')}</Text>
      <Chips value={outcome} onChange={setOutcome} items={(['NOT_HOME', 'REFUSED', 'PROMISED'] as const).map((o) => ({ key: o, label: t(`collection.outcomes.${o}`) }))} />
      {outcome === 'PROMISED' && <Field label={`${t('collection.promiseDate')} (YYYY-MM-DD)`} value={promiseDate} onChangeText={setPromiseDate} placeholder={todayIST()} />}
      <Field label={t('common.notes')} value={note} onChangeText={setNote} />
      {error && <Text style={s.error}>{error}</Text>}
      <Btn title={t('common.save')} onPress={() => void save()} busy={busy} />
      <Btn kind="plain" title={t('common.cancel')} onPress={onDone} />
    </Card>
  );
}
