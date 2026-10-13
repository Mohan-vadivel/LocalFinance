import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import { Text, View } from 'react-native';
import { LANGUAGES } from '@localfinance/shared';
import { ApiError, get, newRef, post, put } from '../api';
import { getPosition, useSession } from '../session';
import { cachedRouteDay, cachedRoutes, myRoutes, type DayCustomer, type MyRoute } from '../store';
import { Amount, Avatar, Badge, Btn, C, Card, Chevron, Chips, ErrorText, Field, Icon, Notice, Row, SP, Screen, SearchBar, dateIN, money, s, toPaise, useLayout, useNav } from '../ui';
import { ActionError, EmptyState, FailureState, FormProblems, LoadingState, NoSearchResults, SkeletonList, SuccessState, fieldError, useRequired, useSlowLoad, type Problem } from '../states';

// =====================================================================
// Add customer (with GPS pin)
// =====================================================================
/** An area the agent can put a customer in, and a route that covers it (the route's own areas are listed too). */
interface PickArea { id: string; name: string; active?: boolean }
interface PickRoute { id: string; name: string; active?: boolean; locations?: { id: string; name: string }[] }
/** The areas the given routes cover, for when the server cannot be reached. */
const areasOf = (rs: MyRoute[]): PickArea[] => {
  const seen = new Map<string, PickArea>();
  for (const r of rs) for (const l of r.locations?.length ? r.locations : [{ id: r.locationId, name: r.location }]) seen.set(l.id, { id: l.id, name: l.name, active: true });
  return [...seen.values()];
};

/**
 * Branch, then area, then route. The area starts as the agent's own route's area and the route list is only the
 * chosen area's routes. Opened with the routes already on screen, those are used first; the lists come from the
 * server and, offline, from the routes the phone kept.
 */
export function AddCustomer({ routes: given }: { routes: MyRoute[] }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { profile } = useSession();
  const [branchId, setBranchId] = useState(given[0]?.branchId ?? profile?.branches[0]?.id ?? '');
  const [areaId, setAreaId] = useState(given[0]?.locationId ?? '');
  const [routeId, setRouteId] = useState(given[0]?.id ?? '');
  const [areas, setAreas] = useState<PickArea[]>([]);
  const [routes, setRoutes] = useState<PickRoute[]>(given);
  // Opened from the side menu there is no route list passed in: the agent's own route gives the default branch and area.
  useEffect(() => {
    if (given.length) return;
    void myRoutes().then((r) => {
      const first = r.data?.[0];
      if (!first) return;
      setBranchId((cur) => cur || first.branchId);
      setAreaId((cur) => cur || first.locationId);
      setRouteId((cur) => cur || first.id);
    });
  }, [given.length]);
  // Areas of the chosen branch. Offline, the areas the phone's own routes cover.
  useEffect(() => {
    if (!branchId) return;
    let live = true;
    get<PickArea[]>('/locations', { branchId })
      .then((list) => {
        if (live) setAreas(list.filter((a) => a.active !== false));
      })
      .catch(() =>
        myRoutes().then((r) => {
          if (live) setAreas(areasOf(r.data ?? []));
        }),
      );
    return () => {
      live = false;
    };
  }, [branchId]);
  // Once the branch's areas are known, the chosen area must be one of them; otherwise the first one is used.
  useEffect(() => {
    if (areas.length && !areas.some((a) => a.id === areaId)) setAreaId(areas[0].id);
  }, [areas, areaId]);
  // Routes of the chosen area only. Offline, the phone's own routes that cover it.
  useEffect(() => {
    if (!areaId) return;
    let live = true;
    const apply = (list: PickRoute[]) => {
      if (!live) return;
      setRoutes(list);
      setRouteId((cur) => (list.some((r) => r.id === cur) ? cur : (list[0]?.id ?? '')));
    };
    get<PickRoute[]>('/routes', { branchId, locationId: areaId })
      .then((list) => apply(list.filter((r) => r.active !== false)))
      .catch(() =>
        myRoutes().then((r) => apply((r.data ?? []).filter((x) => x.locations?.some((l) => l.id === areaId) || x.locationId === areaId))),
      );
    return () => {
      live = false;
    };
  }, [areaId, branchId]);
  const chooseBranch = (id: string) => {
    setBranchId(id);
    setAreaId('');
    setRouteId('');
    setRoutes([]);
  };
  const chooseArea = (id: string) => {
    setAreaId(id);
    setRouteId('');
  };
  const areaName = areas.find((a) => a.id === areaId)?.name;
  const [f, setF] = useState({ name: '', phone: '', altPhone: '', address: '', landmark: '', idType: 'AADHAAR', idNumber: '', occupation: '', monthlyIncome: '', language: 'ta', guarantorName: '', guarantorPhone: '' });
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy: number | null } | null>(null);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [duplicate, setDuplicate] = useState(false);
  const [ref] = useState(newRef);
  // The customer just added, shown on the full-screen success state.
  const [added, setAdded] = useState<{ id: string; name: string } | null>(null);
  // Problems are listed once Save has been tried, then update as the boxes change.
  const [tried, setTried] = useState(false);
  const req = useRequired();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const route = routes.find((r) => r.id === routeId);
  const problems: Problem[] = [];
  if (!areaId) problems.push({ text: t('mobile.chooseArea') });
  if (!route) problems.push({ text: t('mobile.chooseRoute') });
  if (!f.name) problems.push({ field: 'name', text: req(t('common.name')) });
  if (!f.phone) problems.push({ field: 'phone', text: req(t('common.phone')) });
  if (!f.address) problems.push({ field: 'address', text: req(t('common.address')) });
  if (!gps) problems.push({ text: t('mobile.locationNeeded') });
  const shownProblems = tried ? problems : [];

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
    setTried(true);
    if (problems.length || !route || !gps) return;
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
        // The area the agent picked; it is one of the route's areas (the server checks).
        locationId: areaId,
        routeId: route.id,
        guarantorName: f.guarantorName || null,
        guarantorPhone: f.guarantorPhone || null,
        clientRef: ref,
      });
      setAdded({ id: c.id, name: c.name });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'customerMod.duplicate') setDuplicate(true);
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (added) {
    return (
      <Screen title={t('mobile.addCustomer')} scroll={false}>
        <SuccessState title={t('states.success.customerTitle')} text={<Text style={[s.muted, { textAlign: 'center', fontSize: 16 }]}>{t('states.success.customerHelp', { name: added.name })}</Text>}>
          <Btn big title={t('states.actions.openCustomer')} onPress={() => nav.replace('Customer', { customerId: added.id })} />
          <Btn kind="outline" title={t('states.actions.backToRoute')} onPress={() => nav.pop()} style={{ marginBottom: 0 }} />
        </SuccessState>
      </Screen>
    );
  }

  return (
    <Screen title={t('mobile.addCustomer')}>
      <FormProblems problems={shownProblems} />
      <ReadIdCard onRead={(x) => setF((cur) => ({ ...cur, name: x.name || cur.name, idType: x.idType && ID_TYPES.includes(x.idType) ? x.idType : cur.idType, idNumber: x.idNumber || cur.idNumber, address: x.address || cur.address }))} />
      <Card>
        {(profile?.branches.length ?? 0) > 1 && (
          <>
            <Text style={s.h2}>{t('common.branch')}</Text>
            <Chips value={branchId} onChange={chooseBranch} items={(profile?.branches ?? []).map((b) => ({ key: b.id, label: b.name }))} />
          </>
        )}
        <Text style={s.h2}>{t('areas.area')}</Text>
        {areas.length ? <Chips value={areaId} onChange={chooseArea} items={areas.map((a) => ({ key: a.id, label: a.name }))} /> : <Notice tone="warn" text={t('areas.none')} />}
        <Text style={s.h2}>{t('common.route')}</Text>
        {routes.length ? <Chips value={routeId} onChange={setRouteId} items={routes.map((r) => ({ key: r.id, label: r.name }))} /> : <Notice tone="warn" text={t('mobile.noRouteInArea')} />}
        <View style={{ height: 1, backgroundColor: C.line, marginBottom: SP.lg }} />
        <Field label={t('common.name')} value={f.name} onChangeText={set('name')} error={fieldError(shownProblems, 'name')} />
        <Field label={t('common.phone')} value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" error={fieldError(shownProblems, 'phone')} />
        <Field label={t('customerMod.altPhone')} value={f.altPhone} onChangeText={set('altPhone')} keyboardType="phone-pad" />
        <Field label={t('common.address')} value={f.address} onChangeText={set('address')} multiline error={fieldError(shownProblems, 'address')} />
        <Field label={t('customerMod.landmark')} value={f.landmark} onChangeText={set('landmark')} />
        <Text style={s.label}>{t('customerMod.idType')}</Text>
        <Chips value={f.idType} onChange={set('idType')} items={ID_TYPES.map((x) => ({ key: x, label: t(`customerMod.idTypes.${x}`) }))} />
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
      <ActionError error={error} />
      <Btn big title={duplicate ? t('customerMod.saveAnyway') : t('common.save')} onPress={() => void save()} busy={busy} />
    </Screen>
  );
}

const ID_TYPES = ['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'OTHER'];

interface IdRead {
  documentType: string;
  readable: boolean;
  fields: { name: string; idType: string | null; idNumber: string; address: string; dateOfBirth: string; guardian: string };
  duplicates: { id: string; code: string; name: string; phone: string; status: string; sameId: boolean; otherBranch: boolean }[];
}

/**
 * "Read ID card": a photo of the customer's ID is read by Claude on the server and fills name, ID and address.
 * Shown only with a connection and AI features on; the agent checks every field before saving.
 */
function ReadIdCard({ onRead }: { onRead: (f: IdRead['fields']) => void }) {
  const { t } = useTranslation();
  const nav = useNav();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<IdRead | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    // Offline or AI off: the button stays hidden.
    get<{ enabled: boolean }>('/ai/status').then((st) => setEnabled(!!st.enabled)).catch(() => setEnabled(false));
  }, []);
  if (!enabled) return null;

  const read = async (from: 'camera' | 'library') => {
    setError(null);
    const perm = from === 'camera' ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setError(new Error(t('ai.mobile.cameraDenied')));
    const opts: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 0.5, base64: true, exif: false };
    const pick = from === 'camera' ? await ImagePicker.launchCameraAsync(opts) : await ImagePicker.launchImageLibraryAsync(opts);
    const photo = pick.canceled ? null : pick.assets[0];
    if (!photo?.base64) return;
    // The server takes about 3.5 MB of picture; a bigger one is asked again rather than sent.
    if (photo.base64.length > 4_700_000) return setError(new Error(t('ai.readId.notReadable')));
    setBusy(true);
    setRes(null);
    try {
      const r = await post<IdRead>('/ai/read-id', { mediaType: photo.mimeType === 'image/png' ? 'image/png' : 'image/jpeg', image: photo.base64 });
      setRes(r);
      if (r.readable) onRead(r.fields);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, marginBottom: SP.md }}>
        <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: C.brandSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="id-card" size={24} color={C.brand} />
        </View>
        <Text style={[s.h2, { marginBottom: 0, flex: 1, minWidth: 0 }]}>{t('ai.readId.button')}</Text>
        <View style={{ alignSelf: 'center' }}>
          <Badge text={t('ai.badge')} color={C.brand} />
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: SP.sm, marginBottom: SP.sm }}>
        <Btn title={busy ? t('ai.readId.reading') : t('ai.readId.take')} onPress={() => void read('camera')} busy={busy} style={{ flexGrow: 2, flexBasis: 180, marginBottom: 0 }} />
        <Btn kind="outline" title={t('ai.readId.choose')} onPress={() => void read('library')} disabled={busy} style={{ flexGrow: 1, flexBasis: 120, marginBottom: 0 }} />
      </View>
      {busy && <Text style={[s.muted, { marginBottom: SP.sm }]}>{t('ai.readId.reading')}</Text>}
      <ErrorText error={error} />
      {res && !res.readable && <Notice tone="warn" text={t('ai.readId.notReadable')} />}
      {res?.readable && (
        <>
          <Notice text={t('ai.readId.filled')} />
          {(res.fields.dateOfBirth || res.fields.guardian) && (
            <View style={{ marginBottom: SP.md, gap: 2 }}>
              {res.fields.dateOfBirth ? <Text style={{ color: C.ink2, fontWeight: '600' }}>{t('ai.readId.dob', { value: /^\d{4}-\d{2}-\d{2}$/.test(res.fields.dateOfBirth) ? dateIN(res.fields.dateOfBirth) : res.fields.dateOfBirth })}</Text> : null}
              {res.fields.guardian ? <Text style={{ color: C.ink2, fontWeight: '600' }}>{t('ai.readId.guardian', { value: res.fields.guardian })}</Text> : null}
            </View>
          )}
        </>
      )}
      {res && res.duplicates.length > 0 && (
        <View style={{ marginBottom: SP.md }}>
          <Text style={[s.label, { color: C.danger }]}>{t('ai.readId.duplicates')}</Text>
          {res.duplicates.map((d) => (
            <Card
              key={d.id}
              onPress={d.otherBranch ? undefined : () => nav.push('Customer', { customerId: d.id })}
              accessibilityLabel={d.name}
              tone="soft"
              style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md, padding: SP.md, marginBottom: SP.sm, backgroundColor: C.dangerSoft, borderColor: C.line }}
            >
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Text style={{ fontWeight: '800', fontSize: 16, color: C.ink }}>{d.name}</Text>
                <Text style={s.muted}>{d.code} · {d.phone}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                  <Badge text={d.sameId ? t('ai.readId.sameId') : t('ai.readId.sameName')} color={d.sameId ? C.danger : C.warn} />
                  {d.otherBranch && <Badge text={t('ai.readId.otherBranch')} color={C.grey} />}
                  {d.status !== 'ACTIVE' && <Badge text={t(`customerMod.statuses.${d.status}`)} color={C.grey} />}
                </View>
              </View>
              {!d.otherBranch && <Chevron />}
            </Card>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="lock-closed-outline" size={14} color={C.muted} />
        <Text style={[s.muted, { fontSize: 13, flex: 1 }]}>{t('ai.readId.privacy')}</Text>
      </View>
    </Card>
  );
}

// =====================================================================
// Customer search
// =====================================================================
interface Found { id: string; name: string; code: string; phone: string; status: string; routeName?: string; local?: { customer: DayCustomer; routeId: string } }

export function Search({ forLoan }: { forLoan?: boolean }) {
  const { t } = useTranslation();
  const nav = useNav();
  const { compact } = useLayout();
  const [q, setQ] = useState('');
  // Customers on the agent's route copies on the phone: searched as you type, with or without a connection.
  const [onPhone, setOnPhone] = useState<Found[]>([]);
  const [server, setServer] = useState<{ q: string; rows: Found[] } | null>(null);
  const [offline, setOffline] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void cachedRoutes().then(async (routes) => {
      const days = await Promise.all(routes.map((r) => cachedRouteDay(r.id)));
      const seen = new Set<string>();
      const out: Found[] = [];
      days.forEach((d, i) => {
        for (const c of d?.customers ?? []) {
          if (seen.has(c.id)) continue;
          seen.add(c.id);
          out.push({ id: c.id, name: c.name, code: c.code, phone: c.phone, status: c.status, routeName: routes[i].name, local: { customer: c, routeId: routes[i].id } });
        }
      });
      setOnPhone(out);
    });
  }, []);
  const term = q.trim().toLowerCase();
  const digits = term.replace(/\D/g, '');
  const local =
    term.length < 2
      ? []
      : onPhone.filter(
          (r) =>
            r.name.toLowerCase().includes(term) ||
            r.code.toLowerCase().includes(term) ||
            (digits.length >= 3 && r.phone.replace(/\D/g, '').includes(digits)) ||
            !!r.local?.customer.loans.some((l) => l.number.toLowerCase().includes(term)),
        );
  // Phone matches first (they open with the full route copy), then anything more the office found.
  const rows = [...local, ...(server && server.q === term ? server.rows.filter((r) => !local.some((x) => x.id === r.id)) : [])];

  const run = async () => {
    if (term.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setServer({ q: term, rows: (await get<{ rows: Found[] }>('/customers', { q: q.trim() })).rows });
      setOffline(false);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOffline(true);
      else setError(e);
      setServer({ q: term, rows: [] });
    } finally {
      setBusy(false);
    }
  };
  const searched = server?.q === term && !busy;
  const open = (r: Found) => {
    if (forLoan) nav.push('LoanRequest', { customerId: r.id, customerName: r.name });
    else if (r.local) nav.push('Customer', { customer: r.local.customer, routeId: r.local.routeId });
    else nav.push('Customer', { customerId: r.id });
  };
  return (
    <Screen title={forLoan ? t('mobile.requestLoan') : t('mobile.search')}>
      {/* Customers on this phone show as you type; the button also asks the office. */}
      <SearchBar value={q} onChangeText={setQ} onSubmit={() => void run()} placeholder={compact ? t('common.search') : t('customerMod.searchHint')} label={t('customerMod.searchHint')} autoFocus />
      <Btn icon="search" title={t('common.search')} onPress={() => void run()} busy={busy} disabled={term.length < 2} style={{ marginBottom: SP.md }} />
      {error ? <FailureState error={error} onRetry={() => void run()} /> : null}
      {offline && searched && <Notice tone="warn" text={t('mobile.searchOffline')} />}
      {term.length < 2 && <EmptyState icon="people-outline" title={forLoan ? t('mobile.requestLoan') : t('mobile.search')} help={t('mobile.searchStart')} />}
      {term.length >= 2 && rows.length === 0 && !busy &&
        (searched && !offline ? <NoSearchResults query={q.trim()} onClear={() => { setQ(''); setServer(null); }} /> : <Notice tone="warn" text={t('mobile.noMatchOnPhone')} />)}
      {rows.map((r) => (
        <Card key={r.id} onPress={() => open(r)} accessibilityLabel={r.name} style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
          <Avatar name={r.name} size={44} color={r.status !== 'ACTIVE' ? C.danger : C.brand} />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink }}>{r.name}</Text>
            <Text style={s.muted}>{r.code} · {r.phone}{r.routeName ? ` · ${r.routeName}` : ''}</Text>
            {(r.status !== 'ACTIVE' || r.local) && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {r.status !== 'ACTIVE' && <Badge text={t(`customerMod.statuses.${r.status}`)} color={C.danger} />}
                {r.local && <Badge text={t('mobile.onPhone')} color={C.grey} />}
              </View>
            )}
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
interface Risk { score: number | null; grade: string; reasons: { key: string; tone: 'good' | 'bad'; values?: Record<string, number> }[] }
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
  const [risk, setRisk] = useState<Risk | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [ref] = useState(newRef);
  const slow = useSlowLoad(!products && !error);
  const loadProducts = () => {
    setError(null);
    get<Product[]>('/products').then((p) => {
      setProducts(p);
      if (p[0]) setProductId(p[0].id);
    }).catch(setError);
  };
  useEffect(() => {
    loadProducts();
  }, [customerId]);
  // Risk score from the customer's own history; with the amount typed, it also compares it with past loans.
  const asked = toPaise(amount);
  useEffect(() => {
    const h = setTimeout(() => {
      get<{ summary: Risk }>(`/customers/${customerId}/history`, { amount: asked > 0 ? asked : undefined }).then((x) => setRisk(x.summary)).catch(() => undefined);
    }, asked > 0 ? 500 : 0);
    return () => clearTimeout(h);
  }, [customerId, asked]);
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
  if (!products) return <Screen title={t('mobile.requestLoan')}>{error ? <FailureState error={error} onRetry={loadProducts} onBack={() => nav.pop()} /> : <LoadingState slow={slow.slow} onKeepWaiting={slow.keepWaiting} onCancel={() => nav.pop()} />}</Screen>;
  return (
    <Screen title={t('mobile.requestLoan')}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: SP.md }}>
        <Avatar name={customerName} size={48} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[s.h2, { marginBottom: risk ? SP.xs : 0 }]}>{customerName}</Text>
          {risk && <Row label={t('customerMod.riskGrade')} value={t(`history.grades.${risk.grade}`)} strong />}
          {risk?.score != null && <Row label={t('ai.risk.score')} value={t('ai.risk.outOf', { score: risk.score })} strong tone={risk.score >= 70 ? C.ok : risk.score >= 45 ? C.warn : C.danger} />}
        </View>
      </Card>
      {risk && risk.reasons.length > 0 && (
        <Card tone="soft" style={{ marginTop: -SP.xs }}>
          <Text style={[s.label, { marginBottom: SP.xs }]}>{t('ai.risk.why')}</Text>
          {risk.reasons.slice(0, 2).map((r) => (
            <View key={r.key} style={{ flexDirection: 'row', gap: SP.sm, alignItems: 'flex-start', marginBottom: 4 }}>
              <Icon name={r.tone === 'good' ? 'arrow-up-circle' : 'arrow-down-circle'} size={18} color={r.tone === 'good' ? C.ok : C.danger} />
              <Text style={{ flex: 1, color: r.tone === 'good' ? C.ok : C.danger, fontWeight: '700', fontSize: 15 }}>{t(`ai.risk.reasons.${r.key}`, r.values)}</Text>
            </View>
          ))}
          <Text style={[s.muted, { fontSize: 13, marginTop: SP.xs }]}>{t('ai.risk.advisory')}</Text>
        </Card>
      )}
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
      <ActionError error={error} />
      <Btn big title={t('common.submit')} onPress={() => void submit()} busy={busy} disabled={!preview} />
    </Screen>
  );
}

// =====================================================================
// My loan requests
// =====================================================================
interface MyLoanRow { id: string; number: string; customerId: string; productId: string; principal: number; purpose: string | null; notes: string | null; status: string; stage: string; createdAt: string; customer: { name: string } }
interface Approval { decision: string; reason: string | null; createdAt: string; userName?: string }

export function MyRequests() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<MyLoanRow[] | null>(null);
  // The latest note from whoever decided, for requests that were sent back, rejected or approved.
  const [notes, setNotes] = useState<Record<string, Approval>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const load = useCallback(() => {
    get<{ rows: MyLoanRow[] }>('/loans', { queue: 'mine' })
      .then((r) => {
        setError(null);
        setRows(r.rows);
        for (const l of r.rows.filter((x) => ['SENT_BACK', 'REJECTED', 'APPROVED'].includes(x.status) || (x.status === 'REQUESTED' && x.stage === 'ADMIN'))) {
          get<{ approvals: Approval[] }>(`/loans/${l.id}`)
            .then((d) => {
              const last = [...d.approvals].reverse().find((a) => a.reason && a.decision !== 'REQUEST' && a.decision !== 'RESUBMIT');
              if (last) setNotes((n) => ({ ...n, [l.id]: last }));
            })
            .catch(() => undefined);
        }
      })
      .catch(setError);
  }, []);
  useEffect(() => {
    load();
  }, [load]);
  const tone: Record<string, string> = { REQUESTED: C.warn, SENT_BACK: C.warn, APPROVED: C.brand, ACTIVE: C.ok, REJECTED: C.danger };
  return (
    <Screen title={t('mobile.myRequests')}>
      {error ? <FailureState error={error} onRetry={load} /> : null}
      {!rows && !error && <SkeletonList rows={3} />}
      {rows?.length === 0 && <EmptyState icon="document-text-outline" title={t('common.noData')} help={t('states.empty.requestsHelp')} />}
      {(rows ?? []).map((l) => (
        <Card key={l.id}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: SP.sm }}>
            <Text style={{ fontSize: 17, fontWeight: '800', color: C.ink, flex: 1, minWidth: 0 }}>{l.customer.name}</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: C.ink }}>{money(l.principal)}</Text>
          </View>
          <Text style={[s.muted, { marginTop: 2, marginBottom: SP.sm }]}>{l.number} · {dateIN(l.createdAt.slice(0, 10))}</Text>
          <Badge text={t(`loanMod.statuses.${l.status}`)} color={tone[l.status] ?? C.grey} />
          {l.status === 'REQUESTED' && l.stage === 'ADMIN' && <Text style={{ color: C.warn, fontWeight: '600', marginTop: SP.sm }}>{t('loanMod.atAdmin')}</Text>}
          {notes[l.id] && (
            <View style={{ marginTop: SP.md }}>
              <Notice tone={l.status === 'REJECTED' ? 'danger' : l.status === 'SENT_BACK' ? 'warn' : 'info'} text={`${t('mobile.noteFrom', { name: notes[l.id].userName ?? '-' })}: ${notes[l.id].reason}`} />
            </View>
          )}
          {l.status === 'SENT_BACK' &&
            (editing === l.id ? (
              <Resubmit
                loan={l}
                onCancel={() => setEditing(null)}
                onDone={() => {
                  setEditing(null);
                  load();
                }}
              />
            ) : (
              <Btn small kind="tonal" title={t('mobile.editResubmit')} onPress={() => setEditing(l.id)} style={{ alignSelf: 'flex-start', marginTop: notes[l.id] ? 0 : SP.md }} />
            ))}
        </Card>
      ))}
    </Screen>
  );
}

/** Corrects a sent-back request (amount and purpose) and sends it for approval again, as the web app does. */
function Resubmit({ loan, onCancel, onDone }: { loan: MyLoanRow; onCancel: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const [principal, setPrincipal] = useState(String(loan.principal / 100));
  const [purpose, setPurpose] = useState(loan.purpose ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await put(`/loans/${loan.id}`, { customerId: loan.customerId, productId: loan.productId, principal: toPaise(principal), purpose: purpose || null, notes: loan.notes || null });
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ marginTop: SP.md, borderTopWidth: 1, borderColor: C.line, paddingTop: SP.md }}>
      <Field label={t('loanMod.principal')} value={principal} onChangeText={setPrincipal} keyboardType="numeric" prefix="₹" large />
      <Field label={t('loanMod.purpose')} value={purpose} onChangeText={setPurpose} />
      <ActionError error={error} />
      <Btn title={t('loanMod.resubmit')} onPress={() => void submit()} busy={busy} disabled={toPaise(principal) <= 0} />
      <Btn kind="ghost" title={t('common.cancel')} onPress={onCancel} style={{ marginBottom: 0 }} />
    </View>
  );
}
