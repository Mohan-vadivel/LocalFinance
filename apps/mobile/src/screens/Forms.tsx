import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Text, View } from 'react-native';
import { LANGUAGES } from '@localfinance/shared';
import { ApiError, get, newRef, post } from '../api';
import { getPosition } from '../session';
import { myRoutes, type MyRoute } from '../store';
import { Amount, Avatar, Badge, Btn, C, Card, Chevron, Chips, ErrorText, Field, Loading, Notice, Row, SP, Screen, dateIN, money, s, toPaise, useNav } from '../ui';

// =====================================================================
// Add customer (with GPS pin)
// =====================================================================
export function AddCustomer({ routes: given }: { routes: MyRoute[] }) {
  const { t } = useTranslation();
  const nav = useNav();
  // Opened from the side menu there is no route list passed in, so read this agent's routes (cached offline).
  const [routes, setRoutes] = useState<MyRoute[]>(given);
  const [routeId, setRouteId] = useState(given[0]?.id ?? '');
  useEffect(() => {
    if (given.length) return;
    void myRoutes().then((r) => {
      setRoutes(r.data ?? []);
      setRouteId((cur) => cur || (r.data?.[0]?.id ?? ''));
    });
  }, [given.length]);
  const [f, setF] = useState({ name: '', phone: '', altPhone: '', address: '', landmark: '', idType: 'AADHAAR', idNumber: '', occupation: '', monthlyIncome: '', language: 'ta', guarantorName: '', guarantorPhone: '' });
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [ref] = useState(newRef);
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const route = routes.find((r) => r.id === routeId);

  const capture = async () => {
    setLocating(true);
    setGps(await getPosition());
    setLocating(false);
  };
  useEffect(() => {
    void capture();
  }, []);

  const save = async () => {
    setError(null);
    if (!route) return setError(new Error(t('mobile.chooseRoute')));
    if (!gps) return setError(new Error(t('mobile.locationNeeded')));
    setBusy(true);
    try {
      const c = await post<{ id: string; name: string }>(`/customers${duplicate ? '?allowDuplicate=true' : ''}`, {
        name: f.name,
        phone: f.phone,
        altPhone: f.altPhone || null,
        address: f.address,
        landmark: f.landmark || null,
        lat: gps.lat,
        lng: gps.lng,
        idType: f.idType,
        idNumber: f.idNumber || null,
        occupation: f.occupation || null,
        monthlyIncome: f.monthlyIncome ? toPaise(f.monthlyIncome) : null,
        language: f.language,
        locationId: route.locationId,
        routeId: route.id,
        guarantorName: f.guarantorName || null,
        guarantorPhone: f.guarantorPhone || null,
        clientRef: ref,
      });
      nav.replace('Customer', { customerId: c.id });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'customerMod.duplicate') setDuplicate(true);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title={t('mobile.addCustomer')}>
      <Card>
        <Text style={s.h2}>{t('common.route')}</Text>
        <Chips value={routeId} onChange={setRouteId} items={routes.map((r) => ({ key: r.id, label: r.name }))} />
        <View style={{ height: 1, backgroundColor: C.line, marginBottom: SP.lg }} />
        <Field label={t('common.name')} value={f.name} onChangeText={set('name')} />
        <Field label={t('common.phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
        <Field label={t('customerMod.altPhone')} value={f.altPhone} onChangeText={set('altPhone')} keyboardType="phone-pad" />
        <Field label={t('common.address')} value={f.address} onChangeText={set('address')} multiline />
        <Field label={t('customerMod.landmark')} value={f.landmark} onChangeText={set('landmark')} />
        <Text style={s.label}>{t('customerMod.idType')}</Text>
        <Chips value={f.idType} onChange={set('idType')} items={['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'OTHER'].map((x) => ({ key: x, label: t(`customerMod.idTypes.${x}`) }))} />
        <Field label={t('customerMod.idNumber')} value={f.idNumber} onChangeText={set('idNumber')} />
        <Field label={t('customerMod.occupation')} value={f.occupation} onChangeText={set('occupation')} />
        <Field label={t('customerMod.monthlyIncome')} value={f.monthlyIncome} onChangeText={set('monthlyIncome')} keyboardType="numeric" />
        <Field label={t('customerMod.guarantorName')} value={f.guarantorName} onChangeText={set('guarantorName')} />
        <Field label={t('customerMod.guarantorPhone')} value={f.guarantorPhone} onChangeText={set('guarantorPhone')} keyboardType="phone-pad" />
        <Text style={s.label}>{t('common.language')}</Text>
        <Chips value={f.language} onChange={set('language')} items={LANGUAGES.map((l) => ({ key: l.code, label: l.nativeName }))} />
      </Card>
      <Card>
        <Text style={s.h2}>{t('customerMod.gps')}</Text>
        {gps ? (
          <Notice text={`${gps.lat}, ${gps.lng}${gps.accuracy ? ` (±${Math.round(gps.accuracy)} m)` : ''}`} />
        ) : (
          <Notice tone="warn" text={locating ? t('common.loading') : t('mobile.locationNeeded')} />
        )}
        <Btn kind="tonal" title={t('customerMod.captureLocation')} onPress={() => void capture()} busy={locating} />
        <Text style={s.muted}>{t('mobile.gpsHelp')}</Text>
      </Card>
      <ErrorText error={error} />
      <Btn big title={duplicate ? t('customerMod.saveAnyway') : t('common.save')} onPress={() => void save()} busy={busy} disabled={!f.name || !f.phone || !f.address} />
    </Screen>
  );
}

// =====================================================================
// Customer search
// =====================================================================
export function Search({ forLoan }: { forLoan?: boolean }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ id: string; name: string; code: string; phone: string; status: string; routeName?: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (q.trim().length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setRows((await get<{ rows: NonNullable<typeof rows> }>('/customers', { q: q.trim() })).rows);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Screen title={forLoan ? t('mobile.requestLoan') : t('mobile.searchCustomer')}>
      <Card>
        <Field label={t('customerMod.searchHint')} value={q} onChangeText={setQ} onSubmitEditing={() => void run()} returnKeyType="search" autoFocus />
        <Btn title={t('common.search')} onPress={() => void run()} busy={busy} style={{ marginBottom: 0 }} />
      </Card>
      <ErrorText error={error} />
      {rows?.length === 0 && <Notice tone="warn" text={t('common.noData')} />}
      {(rows ?? []).map((r) => (
        <Card key={r.id} onPress={() => (forLoan ? nav.push('LoanRequest', { customerId: r.id, customerName: r.name }) : nav.push('Customer', { customerId: r.id }))} accessibilityLabel={r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
          <Avatar name={r.name} size={44} color={r.status !== 'ACTIVE' ? C.danger : C.brand} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{r.name}</Text>
            <Text style={s.muted}>{r.code} · {r.phone}{r.routeName ? ` · ${r.routeName}` : ''}</Text>
            {r.status !== 'ACTIVE' && <View style={{ marginTop: 4 }}><Badge text={t(`customerMod.statuses.${r.status}`)} color={C.danger} /></View>}
          </View>
          <Chevron />
        </Card>
      ))}
    </Screen>
  );
}

// =====================================================================
// Loan request with schedule preview and history check
// =====================================================================
interface Product { id: string; name: string; frequency: string; minAmount: number; maxAmount: number; tenure: number }
interface Preview { summary: { netDisbursed: number; fee: number; upfrontInterest: number; totalRepayable: number }; schedule: { dueDate: string; totalDue: number }[] }

export function LoanRequest({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [productId, setProductId] = useState('');
  const [amount, setAmount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [grade, setGrade] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ref] = useState(newRef);
  useEffect(() => {
    get<Product[]>('/products').then((p) => {
      setProducts(p);
      if (p[0]) setProductId(p[0].id);
    }).catch(setError);
    get<{ summary: { grade: string } }>(`/customers/${customerId}/history`).then((h) => setGrade(h.summary.grade)).catch(() => undefined);
  }, [customerId]);
  useEffect(() => {
    setPreview(null);
    if (!productId || !toPaise(amount)) return;
    const h = setTimeout(() => {
      post<Preview>('/loans/preview', { productId, principal: toPaise(amount) }).then(setPreview).catch(() => setPreview(null));
    }, 400);
    return () => clearTimeout(h);
  }, [productId, amount]);
  const product = products?.find((p) => p.id === productId);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/loans', { customerId, productId, principal: toPaise(amount), purpose: purpose || null, clientRef: ref });
      nav.replace('MyRequests');
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  if (!products) return <Screen title={t('mobile.requestLoan')}>{error ? <ErrorText error={error} /> : <Loading />}</Screen>;
  return (
    <Screen title={t('mobile.requestLoan')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
        <Avatar name={customerName} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.h2, { marginBottom: grade ? SP.xs : 0 }]}>{customerName}</Text>
          {grade && <Row label={t('customerMod.riskGrade')} value={t(`history.grades.${grade}`)} strong />}
        </View>
      </Card>
      <Card>
        <Text style={s.label}>{t('common.product')}</Text>
        <Chips value={productId} onChange={setProductId} items={products.map((p) => ({ key: p.id, label: p.name }))} />
        {product && <Text style={[s.muted, { marginTop: -SP.sm, marginBottom: SP.lg }]}>{money(product.minAmount)} – {money(product.maxAmount)} · {t(`product.frequencies.${product.frequency}`)} × {product.tenure}</Text>}
        <Field label={t('loanMod.principal')} value={amount} onChangeText={setAmount} keyboardType="numeric" prefix="₹" large />
        <Field label={t('loanMod.purpose')} value={purpose} onChangeText={setPurpose} />
      </Card>
      {preview && (
        <Card tone="soft">
          <Amount label={t('loanMod.netDisbursed')} value={money(preview.summary.netDisbursed)} />
          <View style={{ height: SP.sm }} />
          <Row label={t('loanMod.fee')} value={money(preview.summary.fee)} />
          {preview.summary.upfrontInterest > 0 && <Row label={t('loanMod.upfrontInterest')} value={money(preview.summary.upfrontInterest)} />}
          <Row label={t('loanMod.instalment')} value={`${money(preview.schedule[0]?.totalDue)} × ${preview.schedule.length}`} strong />
          <Row label={t('loanMod.totalRepayable')} value={money(preview.summary.totalRepayable)} />
          <Row label={t('loanMod.lastDue')} value={dateIN(preview.schedule[preview.schedule.length - 1]?.dueDate)} />
        </Card>
      )}
      <ErrorText error={error} />
      <Btn big title={t('common.submit')} onPress={() => void submit()} busy={busy} disabled={!preview} />
    </Screen>
  );
}

// =====================================================================
// My loan requests
// =====================================================================
export function MyRequests() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<{ id: string; number: string; principal: number; status: string; stage: string; createdAt: string; customer: { name: string } }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    get<{ rows: NonNullable<typeof rows> }>('/loans', { queue: 'mine' }).then((r) => setRows(r.rows)).catch(setError);
  }, []);
  const tone: Record<string, string> = { REQUESTED: C.warn, SENT_BACK: C.warn, APPROVED: C.brand, ACTIVE: C.ok, REJECTED: C.danger };
  return (
    <Screen title={t('mobile.myRequests')}>
      <ErrorText error={error} />
      {!rows && !error && <Loading />}
      {rows?.length === 0 && <Notice tone="warn" text={t('common.noData')} />}
      {(rows ?? []).map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.sm }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flex: 1, minWidth: 0 }}>{l.customer.name}</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{money(l.principal)}</Text>
          </View>
          <Text style={[s.muted, { marginTop: 2, marginBottom: SP.sm }]}>{l.number} · {dateIN(l.createdAt.slice(0, 10))}</Text>
          <Badge text={t(`loanMod.statuses.${l.status}`)} color={tone[l.status] ?? C.grey} />
          {l.status === 'REQUESTED' && l.stage === 'ADMIN' && <Text style={{ color: C.warn, fontWeight: '600', marginTop: SP.sm }}>{t('loanMod.atAdmin')}</Text>}
        </Card>
      ))}
    </Screen>
  );
}
