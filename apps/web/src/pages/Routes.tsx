import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp, Eye, Trash2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { BranchPicker, clearLookups, LocationPicker, StaffPicker } from '../components/pickers';
import { MapView } from '../components/MapView';
import { DataTable, ErrorBox, Field, FormModal, Loading, useToast, RowActions } from '../components/ui';
import { del, get, post, put } from '../lib/api';
import { dateIN, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Route {
  id: string;
  name: string;
  branchId: string;
  locationId: string;
  collectionDays: number[];
  active: boolean;
  customerCount: number;
  location: { name: string; branchId: string };
  assignments: { id: string; userId: string; userName?: string; fromDate: string; toDate: string | null; current: boolean }[];
}

function DaysPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const { t } = useTranslation();
  return (
    <div className="row">
      {[1, 2, 3, 4, 5, 6, 0].map((d) => (
        <label key={d} className="field inline">
          <input type="checkbox" checked={value.includes(d)} onChange={(e) => onChange(e.target.checked ? [...value, d] : value.filter((x) => x !== d))} />
          {t(`weekdays.${d}`)}
        </label>
      ))}
    </div>
  );
}

export function RouteForm({ route, onClose, onSaved }: { route: Partial<Route>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branchId: route.location?.branchId ?? route.branchId ?? '', locationId: route.locationId ?? '', name: route.name ?? '', collectionDays: route.collectionDays ?? [1, 2, 3, 4, 5, 6], active: route.active ?? true });
  return (
    <FormModal
      title={route.id ? `${t('common.edit')}: ${route.name}` : t('routeMod.new')}
      onClose={onClose}
      onSubmit={async () => {
        const body = { locationId: f.locationId, name: f.name, collectionDays: f.collectionDays, active: f.active };
        if (route.id) await put(`/routes/${route.id}`, body);
        else await post('/routes', body);
        clearLookups();
        onSaved();
      }}
    >
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v, locationId: '' })} /></Field>
      <Field label={t('common.location')}><LocationPicker branchId={f.branchId || undefined} value={f.locationId} onChange={(v) => setF({ ...f, locationId: v })} /></Field>
      <Field label={t('common.name')} full><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('routeMod.collectionDays')} full><DaysPicker value={f.collectionDays} onChange={(v) => setF({ ...f, collectionDays: v })} /></Field>
      <Field label={t('common.status')}>
        <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
          <option value="1">{t('common.active')}</option>
          <option value="0">{t('common.inactive')}</option>
        </select>
      </Field>
    </FormModal>
  );
}

export default function Routes() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const [branchId, setBranchId] = useState('');
  const [locationId, setLocationId] = useState('');
  const { data, error, reload } = useLoad(() => get<Route[]>('/routes', { branchId, locationId }), [branchId, locationId]);
  const [editing, setEditing] = useState<Partial<Route> | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('routeMod.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setLocationId(''); }} allowAll />
          <LocationPicker branchId={branchId || undefined} value={locationId} onChange={setLocationId} allowAll />
          <button className="btn primary" onClick={() => setEditing({})}>{t('routeMod.new')}</button>
        </div>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('routeMod.title')}
          rows={data}
          empty={branchId || locationId ? t('empty.noMatch') : { message: t('empty.routes'), action: { label: t('empty.firstRoute'), onClick: () => setEditing({}) } }}
          onRow={(r) => nav(`/routes/${r.id}`)}
          actions={(r) => [{ icon: Eye, label: t('common.view'), onClick: () => nav(`/routes/${r.id}`) }]}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'location', label: t('common.location'), value: (r) => r.location.name },
            { key: 'days', label: t('routeMod.collectionDays'), value: (r) => r.collectionDays.map((d) => t(`weekdays.${d}`)).join(' ') },
            { key: 'customerCount', label: t('nav.customers'), num: true, total: true },
            { key: 'agents', label: t('routeMod.assignments'), value: (r) => r.assignments.filter((a) => a.current).map((a) => a.userName).join(', ') },
            { key: 'active', label: t('common.status'), value: (r) => (r.active ? t('common.active') : t('common.inactive')) },
          ]}
        />
      </div>
      {editing && <RouteForm route={editing} onClose={() => setEditing(null)} onSaved={() => void reload()} />}
    </div>
  );
}

interface RouteCustomer { id: string; code: string; name: string; phone: string; address: string; landmark: string | null; lat: number | null; lng: number | null; routeSeq: number | null }

export function RouteDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { id } = useParams();
  const routes = useLoad(() => get<Route[]>('/routes'), [id]);
  const route = routes.data?.find((r) => r.id === id);
  const customers = useLoad(() => get<RouteCustomer[]>(`/routes/${id}/customers`), [id]);
  const [order, setOrder] = useState<RouteCustomer[] | null>(null);
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [assign, setAssign] = useState({ userId: '', fromDate: today(), toDate: '' });
  const list = order ?? customers.data ?? [];

  const move = (i: number, dir: -1 | 1) => {
    const next = [...list];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  };
  const suggest = async () => {
    try {
      const r = await post<{ customerIds: string[] }>(`/routes/${id}/suggest-order`, {});
      setOrder(r.customerIds.map((cid) => list.find((c) => c.id === cid)!).filter(Boolean));
    } catch (e) {
      setError(e);
    }
  };
  const saveOrder = async () => {
    try {
      await put(`/routes/${id}/order`, { customerIds: list.map((c) => c.id) });
      setOrder(null);
      await customers.reload();
      toast(t('common.saved'));
    } catch (e) {
      setError(e);
    }
  };
  const unassign = async (aid: string) => {
    try {
      await del(`/route-assignments/${aid}`);
      await routes.reload();
    } catch (e) {
      setError(e);
    }
  };

  if (!route) return <Loading />;
  const pins = list.filter((c) => c.lat != null && c.lng != null).map((c) => ({ id: c.id, lat: c.lat!, lng: c.lng!, label: String(list.indexOf(c) + 1), title: `${list.indexOf(c) + 1}. ${c.name} · ${c.address}` }));
  return (
    <div>
      <div className="page-head">
        <h1>{route.name}</h1>
        <div className="row">
          <span className="muted">{route.location.name} · {route.collectionDays.map((d) => t(`weekdays.${d}`)).join(' ')}</span>
          <button className="btn" onClick={() => setEditing(true)}>{t('common.edit')}</button>
          <button className="btn primary" onClick={() => setAssigning(true)}>{t('routeMod.assign')}</button>
        </div>
      </div>
      <ErrorBox error={error ?? customers.error} />
      <div className="card">
        <h2>{t('routeMod.assignments')}</h2>
        <DataTable
          rows={route.assignments}
          columns={[
            { key: 'userName', label: t('common.agent') },
            { key: 'fromDate', label: t('routeMod.fromDate'), value: (r) => dateIN(r.fromDate) },
            { key: 'toDate', label: t('routeMod.toDate'), value: (r) => (r.toDate ? dateIN(r.toDate) : '-') },
            { key: 'current', label: t('common.status'), value: (r) => (r.current ? t('common.active') : t('common.inactive')) },
            { key: 'actions', label: t('common.actions'), value: () => '', render: (r) => <RowActions actions={[{ icon: Trash2, label: t('common.delete'), tone: 'danger', onClick: () => void unassign(r.id) }]} /> },
          ]}
        />
      </div>
      <div className="grid c2">
        <div className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>{t('routeMod.order')}</h2>
            <span className="spacer" />
            <button className="btn small" onClick={() => void suggest()}>{t('routeMod.optimise')}</button>
            <button className="btn small primary" disabled={!order} onClick={() => void saveOrder()}>{t('routeMod.saveOrder')}</button>
          </div>
          <div className="table-wrap">
          <table className="data">
            <tbody>
              {list.map((c, i) => (
                <tr key={c.id}>
                  <td className="num">{i + 1}</td>
                  <td className="wrap">
                    <strong>{c.name}</strong> <span className="muted">{c.code}</span>
                    <div className="muted">{c.address}{c.landmark ? ` · ${c.landmark}` : ''}</div>
                    {c.lat == null && <span className="badge warn">{t('customerMod.gps')} -</span>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <RowActions
                      actions={[
                        { icon: ChevronUp, label: t('common.moveUp'), onClick: () => move(i, -1), disabled: i === 0 },
                        { icon: ChevronDown, label: t('common.moveDown'), onClick: () => move(i, 1), disabled: i === list.length - 1 },
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {!list.length && (
                <tr><td className="muted">{t('common.noData')}</td></tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
        <div className="card">
          <h2>{t('routeMod.map')}</h2>
          <MapView pins={pins} path />
        </div>
      </div>
      {assigning && (
        <FormModal
          title={t('routeMod.assign')}
          onClose={() => setAssigning(false)}
          onSubmit={async () => {
            await post(`/routes/${id}/assignments`, { userId: assign.userId, fromDate: assign.fromDate, toDate: assign.toDate || null });
            await routes.reload();
          }}
        >
          <Field label={t('common.agent')}><StaffPicker branchId={route.branchId} value={assign.userId} onChange={(v) => setAssign({ ...assign, userId: v })} /></Field>
          <Field label={t('routeMod.fromDate')}><input type="date" value={assign.fromDate} onChange={(e) => setAssign({ ...assign, fromDate: e.target.value })} /></Field>
          <Field label={t('routeMod.toDate')}><input type="date" value={assign.toDate} onChange={(e) => setAssign({ ...assign, toDate: e.target.value })} /></Field>
        </FormModal>
      )}
      {editing && <RouteForm route={route} onClose={() => setEditing(false)} onSaved={() => void routes.reload()} />}
    </div>
  );
}
