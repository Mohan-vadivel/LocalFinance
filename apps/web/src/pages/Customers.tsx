import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { LANGUAGES } from '@localfinance/shared';
import { MapView } from '../components/MapView';
import { BranchPicker, LocationPicker, RoutePicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Loading, Stat, Tabs, statusTone, useToast } from '../components/ui';
import { ApiError, get, openFile, post, put, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, money, toPaise, toRupeesInput } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { LoanRequestForm } from './Loans';

export interface Customer {
  id: string;
  code: string;
  name: string;
  phone: string;
  altPhone: string | null;
  address: string;
  landmark: string | null;
  lat: number | null;
  lng: number | null;
  idType: string | null;
  idNumber: string | null;
  occupation: string | null;
  monthlyIncome: number | null;
  language: string;
  branchId: string;
  locationId: string;
  routeId: string | null;
  routeSeq: number | null;
  guarantorName: string | null;
  guarantorPhone: string | null;
  guarantorRelation: string | null;
  status: string;
  statusReason: string | null;
  createdAt: string;
  locationName?: string;
  routeName?: string;
}

interface Position { principalOutstanding: number; interestOutstanding: number; penaltyOutstanding: number; totalOutstanding: number; overdue: number; dueToday: number; daysPastDue: number }
interface CustomerLoan { id: string; number: string; principal: number; status: string; frequency: string; disbursedOn: string | null; closedOn: string | null; createdAt: string; position: Position | null }
interface CustomerDetail extends Customer {
  documents: { id: string; kind: string; fileName: string; createdAt: string }[];
  loans: CustomerLoan[];
}
interface History {
  matches: { id: string; code: string; name: string; phone: string; status: string; statusReason: string | null }[];
  blacklisted: boolean;
  summary: { pastLoans: number; currentLoans: number; instalmentsDue: number; onTimeRatio: number; missed: number; maxDaysLate: number; writtenOff: number; grade: string };
  loans: (CustomerLoan & { customerId: string; maxDaysLate: number })[];
}
interface LedgerRow { id: string; date: string; loanNumber?: string; type: string; description: string; debit: number; credit: number; balance: number }

const ID_TYPES = ['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'OTHER'];
const gradeTone = (g: string) => ({ A: 'ok', B: 'ok', C: 'warn', D: 'danger' } as const)[g as 'A'] ?? 'brand';

export function CustomerForm({ customer, onClose, onSaved }: { customer: Partial<Customer>; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { t } = useTranslation();
  const [branchId, setBranchId] = useState(customer.branchId ?? '');
  const [allowDuplicate, setAllowDuplicate] = useState(false);
  const [f, setF] = useState({
    name: customer.name ?? '',
    phone: customer.phone ?? '',
    altPhone: customer.altPhone ?? '',
    address: customer.address ?? '',
    landmark: customer.landmark ?? '',
    lat: customer.lat ?? null,
    lng: customer.lng ?? null,
    idType: customer.idType ?? 'AADHAAR',
    idNumber: customer.idNumber ?? '',
    occupation: customer.occupation ?? '',
    monthlyIncome: toRupeesInput(customer.monthlyIncome),
    language: customer.language ?? 'en',
    locationId: customer.locationId ?? '',
    routeId: customer.routeId ?? '',
    routeSeq: customer.routeSeq ? String(customer.routeSeq) : '',
    guarantorName: customer.guarantorName ?? '',
    guarantorPhone: customer.guarantorPhone ?? '',
    guarantorRelation: customer.guarantorRelation ?? '',
  });
  const [gpsError, setGpsError] = useState('');
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const capture = () => {
    setGpsError('');
    if (!navigator.geolocation) return setGpsError(t('customerMod.gpsDenied'));
    navigator.geolocation.getCurrentPosition(
      (p) => setF((x) => ({ ...x, lat: Number(p.coords.latitude.toFixed(6)), lng: Number(p.coords.longitude.toFixed(6)) })),
      () => setGpsError(t('customerMod.gpsDenied')),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };
  return (
    <FormModal
      wide
      title={customer.id ? `${t('common.edit')}: ${customer.name}` : t('customerMod.new')}
      onClose={onClose}
      onSubmit={async () => {
        if (!f.locationId) throw new Error(t('customerMod.chooseLocation'));
        const body = {
          name: f.name,
          phone: f.phone,
          altPhone: f.altPhone || null,
          address: f.address,
          landmark: f.landmark || null,
          lat: f.lat,
          lng: f.lng,
          idType: f.idType || null,
          idNumber: f.idNumber || null,
          occupation: f.occupation || null,
          monthlyIncome: f.monthlyIncome ? toPaise(f.monthlyIncome) : null,
          language: f.language,
          locationId: f.locationId,
          routeId: f.routeId || null,
          routeSeq: f.routeSeq ? Number(f.routeSeq) : null,
          guarantorName: f.guarantorName || null,
          guarantorPhone: f.guarantorPhone || null,
          guarantorRelation: f.guarantorRelation || null,
        };
        try {
          const c = customer.id ? await put<Customer>(`/customers/${customer.id}`, body) : await post<Customer>(`/customers${allowDuplicate ? '?allowDuplicate=true' : ''}`, body);
          onSaved(c);
        } catch (e) {
          if (e instanceof ApiError && e.code === 'customerMod.duplicate' && !customer.id) setAllowDuplicate(true);
          throw e;
        }
      }}
      submitLabel={allowDuplicate ? t('customerMod.saveAnyway') : undefined}
    >
      <Field label={t('common.name')}><input value={f.name} onChange={set('name')} /></Field>
      <Field label={t('common.phone')}><input value={f.phone} onChange={set('phone')} inputMode="tel" /></Field>
      <Field label={t('customerMod.altPhone')}><input value={f.altPhone} onChange={set('altPhone')} inputMode="tel" /></Field>
      <Field label={t('common.language')}>
        <select value={f.language} onChange={set('language')}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
        </select>
      </Field>
      <Field label={t('common.address')} full><textarea rows={2} value={f.address} onChange={set('address')} /></Field>
      <Field label={t('customerMod.landmark')}><input value={f.landmark} onChange={set('landmark')} /></Field>
      <Field label={t('customerMod.idType')}>
        <select value={f.idType} onChange={set('idType')}>
          {ID_TYPES.map((x) => <option key={x} value={x}>{t(`customerMod.idTypes.${x}`)}</option>)}
        </select>
      </Field>
      <Field label={t('customerMod.idNumber')}><input value={f.idNumber} onChange={set('idNumber')} /></Field>
      <Field label={t('customerMod.occupation')}><input value={f.occupation} onChange={set('occupation')} /></Field>
      <Field label={t('customerMod.monthlyIncome')}><input type="number" min="0" value={f.monthlyIncome} onChange={set('monthlyIncome')} /></Field>
      <Field label={t('common.branch')}><BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setF({ ...f, locationId: '', routeId: '' }); }} /></Field>
      <Field label={t('common.location')}><LocationPicker branchId={branchId || undefined} value={f.locationId} onChange={(v) => setF({ ...f, locationId: v, routeId: '' })} /></Field>
      <Field label={t('common.route')}>
        <RoutePicker
          branchId={branchId || undefined}
          locationId={f.locationId || undefined}
          value={f.routeId}
          onChange={(v) => setF((x) => ({ ...x, routeId: v }))}
          onPickRoute={(r) => {
            // Choosing a route fills in its area and branch, so the two can never disagree.
            if (!r) return;
            setF((x) => ({ ...x, routeId: r.id, locationId: r.locationId }));
            setBranchId(r.location.branchId);
          }}
        />
      </Field>
      <Field label={t('customerMod.routeSeq')}><input type="number" min="1" value={f.routeSeq} onChange={set('routeSeq')} /></Field>
      <Field label={t('customerMod.guarantorName')}><input value={f.guarantorName} onChange={set('guarantorName')} /></Field>
      <Field label={t('customerMod.guarantorPhone')}><input value={f.guarantorPhone} onChange={set('guarantorPhone')} inputMode="tel" /></Field>
      <Field label={t('customerMod.relation')}><input value={f.guarantorRelation} onChange={set('guarantorRelation')} /></Field>
      <div className="full">
        <div className="row" style={{ marginBottom: 8 }}>
          <strong>{t('customerMod.gps')}:</strong>
          <span className="muted">{f.lat != null && f.lng != null ? `${f.lat}, ${f.lng}` : '-'}</span>
          <button type="button" className="btn small" onClick={capture}>{t('customerMod.captureLocation')}</button>
          <span className="muted">{t('customerMod.pickOnMap')}</span>
        </div>
        {gpsError && <div className="error-box">{gpsError}</div>}
        <MapView height={260} pins={f.lat != null && f.lng != null ? [{ id: 'c', lat: f.lat, lng: f.lng, label: '•', title: f.name }] : []} onPick={(lat, lng) => { setGpsError(''); setF((x) => ({ ...x, lat, lng })); }} />
      </div>
    </FormModal>
  );
}

export default function Customers() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(
    () => get<{ total: number; page: number; pageSize: number; rows: Customer[] }>('/customers', { q: search, branchId, locationId, routeId, status, page }),
    [search, branchId, locationId, routeId, status, page],
  );
  const [creating, setCreating] = useState(false);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div>
      <div className="page-head">
        <h1>{t('customerMod.title')}</h1>
        {can('customer.create') && <button className="btn primary" onClick={() => setCreating(true)}>{t('customerMod.new')}</button>}
      </div>
      <div className="card no-print">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}>
          <input placeholder={t('customerMod.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
          <button className="btn">{t('common.search')}</button>
          <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setLocationId(''); setRouteId(''); setPage(1); }} allowAll />
          <LocationPicker branchId={branchId || undefined} value={locationId} onChange={(v) => { setLocationId(v); setRouteId(''); setPage(1); }} allowAll />
          <RoutePicker branchId={branchId || undefined} locationId={locationId || undefined} value={routeId} onChange={(v) => { setRouteId(v); setPage(1); }} allowAll />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {['ACTIVE', 'BLACKLISTED', 'CLOSED'].map((s) => <option key={s} value={s}>{t(`customerMod.statuses.${s}`)}</option>)}
          </select>
        </form>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('customerMod.title')}
          rows={data?.rows}
          onRow={(c) => nav(`/customers/${c.id}`)}
          actions={(c) => [{ icon: Eye, label: t('common.view'), onClick: () => nav(`/customers/${c.id}`) }]}
          columns={[
            { key: 'code', label: t('customerMod.code') },
            { key: 'name', label: t('common.name') },
            { key: 'phone', label: t('common.phone') },
            { key: 'locationName', label: t('common.location') },
            { key: 'routeName', label: t('common.route') },
            { key: 'routeSeq', label: '#', num: true },
            { key: 'gps', label: t('customerMod.gps'), value: (c) => (c.lat != null ? '✓' : '-') },
            { key: 'status', label: t('common.status'), value: (c) => t(`customerMod.statuses.${c.status}`), render: (c) => <Badge tone={statusTone(c.status)}>{t(`customerMod.statuses.${c.status}`)}</Badge> },
          ]}
        />
        <Pager page={page} pages={pages} total={data?.total} onPage={setPage} />
      </div>
      {creating && <CustomerForm customer={{}} onClose={() => setCreating(false)} onSaved={(c) => { void reload(); nav(`/customers/${c.id}`); }} />}
    </div>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total?: number; onPage: (p: number) => void }) {
  const { t } = useTranslation();
  if (pages <= 1) return null;
  return (
    <div className="row no-print" style={{ marginTop: 10, justifyContent: 'flex-end' }}>
      <span className="muted">{total}</span>
      <button className="btn small" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.back')}</button>
      <span>{page} / {pages}</span>
      <button className="btn small" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')}</button>
    </div>
  );
}

export function CustomerDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can } = useAuth();
  const nav = useNavigate();
  const { id } = useParams();
  const { data: c, error, reload } = useLoad(() => get<CustomerDetail>(`/customers/${id}`), [id]);
  const [tab, setTab] = useState<'loans' | 'history' | 'ledger' | 'documents'>('loans');
  const history = useLoad(() => (tab === 'history' ? get<History>(`/customers/${id}/history`) : Promise.resolve(null)), [id, tab]);
  const ledger = useLoad(() => (tab === 'ledger' ? get<LedgerRow[]>(`/customers/${id}/ledger`) : Promise.resolve(null)), [id, tab]);
  const [editing, setEditing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [statusing, setStatusing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [docKind, setDocKind] = useState('ID_PROOF');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} />;
  if (!c) return <Loading />;
  const active = c.loans.filter((l) => l.position);
  const outstanding = active.reduce((s, l) => s + (l.position?.totalOutstanding ?? 0), 0);
  const overdue = active.reduce((s, l) => s + (l.position?.overdue ?? 0), 0);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setActionError(null);
    try {
      await upload(file, { kind: docKind, customerId: c.id });
      toast(t('common.saved'));
      void reload();
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="muted"><Link to="/customers">{t('customerMod.title')}</Link> / {c.code}</div>
          <h1>{c.name} <Badge tone={statusTone(c.status)}>{t(`customerMod.statuses.${c.status}`)}</Badge></h1>
          {c.statusReason && <div className="muted">{c.statusReason}</div>}
        </div>
        <div className="row no-print">
          {can('loan.request') && c.status === 'ACTIVE' && <button className="btn primary" onClick={() => setRequesting(true)}>{t('loanMod.newRequest')}</button>}
          {can('customer.edit') && <button className="btn" onClick={() => setEditing(true)}>{t('common.edit')}</button>}
          {can('customer.edit') && c.status !== 'BLACKLISTED' && <button className="btn" onClick={() => setStatusing('BLACKLISTED')}>{t('customerMod.blacklist')}</button>}
          {can('customer.edit') && c.status !== 'ACTIVE' && <button className="btn" onClick={() => setStatusing('ACTIVE')}>{t('customerMod.reactivate')}</button>}
          {can('customer.edit') && c.status === 'ACTIVE' && <button className="btn" onClick={() => setStatusing('CLOSED')}>{t('common.close')}</button>}
        </div>
      </div>
      <ErrorBox error={actionError} />
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <Stat label={t('loanMod.outstanding')} value={money(outstanding)} sub={`${active.length} ${t('dashboard.activeLoans')}`} />
        <Stat label={t('loanMod.overdue')} value={money(overdue)} />
        <Stat label={t('common.phone')} value={<span style={{ fontSize: 16 }}>{c.phone}</span>} sub={c.altPhone ?? undefined} />
        <Stat label={t('common.route')} value={<span style={{ fontSize: 16 }}>{c.routeSeq ? `#${c.routeSeq}` : '-'}</span>} />
      </div>
      <div className="grid c2">
        <div className="card">
          <dl className="kv">
            <dt>{t('common.address')}</dt><dd>{c.address}</dd>
            <dt>{t('customerMod.landmark')}</dt><dd>{c.landmark ?? '-'}</dd>
            <dt>{t('customerMod.idType')}</dt><dd>{c.idType ? `${t(`customerMod.idTypes.${c.idType}`)} ${c.idNumber ?? ''}` : '-'}</dd>
            <dt>{t('customerMod.occupation')}</dt><dd>{c.occupation ?? '-'}</dd>
            <dt>{t('customerMod.monthlyIncome')}</dt><dd>{money(c.monthlyIncome)}</dd>
            <dt>{t('customerMod.guarantor')}</dt><dd>{c.guarantorName ? `${c.guarantorName} (${c.guarantorRelation ?? ''}) ${c.guarantorPhone ?? ''}` : '-'}</dd>
            <dt>{t('common.language')}</dt><dd>{LANGUAGES.find((l) => l.code === c.language)?.nativeName ?? c.language}</dd>
            <dt>{t('customerMod.since')}</dt><dd>{dateIN(c.createdAt)}</dd>
          </dl>
        </div>
        <div className="card">
          {c.lat != null && c.lng != null ? (
            <MapView height={240} pins={[{ id: c.id, lat: c.lat, lng: c.lng, label: String(c.routeSeq ?? '•'), title: c.name }]} />
          ) : (
            <div className="muted">{t('customerMod.noGps')}</div>
          )}
        </div>
      </div>
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: 'loans', label: t('nav.loans') },
            { key: 'history', label: t('customerMod.history') },
            { key: 'ledger', label: t('customerMod.ledger') },
            { key: 'documents', label: t('customerMod.documents') },
          ]}
        />
        {tab === 'loans' && (
          <DataTable
            rows={c.loans}
            onRow={(l) => nav(`/loans/${l.id}`)}
            columns={[
              { key: 'number', label: t('loanMod.number') },
              { key: 'principal', label: t('loanMod.principal'), money: true },
              { key: 'frequency', label: t('product.frequency'), value: (l) => t(`product.frequencies.${l.frequency}`) },
              { key: 'disbursedOn', label: t('loanMod.disbursedOn'), value: (l) => dateIN(l.disbursedOn) },
              { key: 'outstanding', label: t('loanMod.outstanding'), money: true, value: (l) => l.position?.totalOutstanding ?? null },
              { key: 'overdue', label: t('loanMod.overdue'), money: true, value: (l) => l.position?.overdue ?? null },
              { key: 'status', label: t('common.status'), value: (l) => t(`loanMod.statuses.${l.status}`), render: (l) => <Badge tone={statusTone(l.status)}>{t(`loanMod.statuses.${l.status}`)}</Badge> },
            ]}
          />
        )}
        {tab === 'history' && (history.data ? <HistoryView h={history.data} /> : <Loading />)}
        {tab === 'ledger' && (
          <div>
            <div className="print-only">
              <h2>{t('customerMod.statement')}: {c.name} ({c.code})</h2>
              <p>{c.phone} · {c.address}</p>
            </div>
            <DataTable
              title={`${t('customerMod.statement')} ${c.code}`}
              rows={ledger.data}
              columns={[
                { key: 'date', label: t('common.date'), value: (r) => dateIN(r.date) },
                { key: 'loanNumber', label: t('loanMod.number') },
                { key: 'description', label: t('daybook.particulars') },
                { key: 'debit', label: t('customerMod.debit'), money: true, total: true },
                { key: 'credit', label: t('customerMod.credit'), money: true, total: true },
                { key: 'balance', label: t('loanMod.balance'), money: true },
              ]}
            />
          </div>
        )}
        {tab === 'documents' && (
          <div>
            {can('customer.edit', 'customer.create') && (
              <div className="row no-print" style={{ marginBottom: 12 }}>
                <select value={docKind} onChange={(e) => setDocKind(e.target.value)}>
                  {['PHOTO', 'ID_PROOF', 'ADDRESS_PROOF', 'AGREEMENT', 'OTHER'].map((k) => <option key={k} value={k}>{t(`customerMod.docKinds.${k}`)}</option>)}
                </select>
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={busy} onChange={(e) => { void onUpload(e.target.files?.[0]); e.target.value = ''; }} />
              </div>
            )}
            <DataTable
              rows={c.documents}
              columns={[
                { key: 'kind', label: t('customerMod.docKind'), value: (d) => t(`customerMod.docKinds.${d.kind}`, { defaultValue: d.kind }) },
                { key: 'fileName', label: t('common.name'), render: (d) => <a href="#" onClick={(e) => { e.preventDefault(); void openFile(`/files/${d.id}`); }}>{d.fileName}</a> },
                { key: 'createdAt', label: t('common.date'), value: (d) => dateTime(d.createdAt) },
              ]}
            />
          </div>
        )}
      </div>
      {editing && <CustomerForm customer={c} onClose={() => setEditing(false)} onSaved={() => { toast(t('common.saved')); void reload(); }} />}
      {requesting && <LoanRequestForm customerId={c.id} customerName={c.name} onClose={() => setRequesting(false)} onSaved={(l) => nav(`/loans/${l.id}`)} />}
      {statusing && (
        <FormModal
          title={statusing === 'BLACKLISTED' ? t('customerMod.blacklist') : t(`customerMod.statuses.${statusing}`)}
          onClose={() => { setStatusing(null); setReason(''); }}
          onSubmit={async () => {
            await post(`/customers/${c.id}/status`, { status: statusing, reason: reason || undefined });
            toast(t('common.saved'));
            void reload();
          }}
        >
          <Field label={t('common.reason')} full><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </FormModal>
      )}
    </div>
  );
}

export function HistoryView({ h }: { h: History }) {
  const { t } = useTranslation();
  const nav = useNavigate();
  const s = h.summary;
  return (
    <div>
      {h.blacklisted && <div className="error-box">{t('customerMod.blacklistWarning')}</div>}
      <div className="grid k4" style={{ marginBottom: 12 }}>
        <Stat label={t('customerMod.riskGrade')} value={<Badge tone={gradeTone(s.grade)}>{t(`history.grades.${s.grade}`)}</Badge>} />
        <Stat label={t('history.pastLoans')} value={s.pastLoans} sub={`${t('history.currentLoans')}: ${s.currentLoans}`} />
        <Stat label={t('history.onTimeRate')} value={`${Math.round(s.onTimeRatio * 100)}%`} sub={`${s.instalmentsDue}`} />
        <Stat label={t('history.maxDaysLate')} value={s.maxDaysLate} sub={`${t('history.missed')}: ${s.missed} · ${t('history.writtenOff')}: ${s.writtenOff}`} />
      </div>
      {h.matches.length > 0 && (
        <div className="card">
          <h3>{t('history.matches')}</h3>
          <DataTable
            rows={h.matches}
            onRow={(m) => nav(`/customers/${m.id}`)}
            columns={[
              { key: 'code', label: t('customerMod.code') },
              { key: 'name', label: t('common.name') },
              { key: 'phone', label: t('common.phone') },
              { key: 'status', label: t('common.status'), value: (m) => `${t(`customerMod.statuses.${m.status}`)} ${m.statusReason ?? ''}` },
            ]}
          />
        </div>
      )}
      <DataTable
        rows={h.loans}
        onRow={(l) => nav(`/loans/${l.id}`)}
        columns={[
          { key: 'number', label: t('loanMod.number') },
          { key: 'principal', label: t('loanMod.principal'), money: true },
          { key: 'disbursedOn', label: t('loanMod.disbursedOn'), value: (l) => dateIN(l.disbursedOn) },
          { key: 'closedOn', label: t('customerMod.closedOn'), value: (l) => dateIN(l.closedOn) },
          { key: 'maxDaysLate', label: t('history.maxDaysLate'), num: true },
          { key: 'status', label: t('common.status'), value: (l) => t(`loanMod.statuses.${l.status}`) },
        ]}
      />
    </div>
  );
}

export type { History };
