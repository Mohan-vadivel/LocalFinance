import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { BranchPicker, clearLookups } from '../components/pickers';
import { MapView } from '../components/MapView';
import { Badge, DataTable, ErrorBox, Field, FormModal } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';

interface Branch { id: string; name: string; code: string; address: string | null; lat: number | null; lng: number | null; active: boolean; availableFund: number; _count: { locations: number } }
interface Location { id: string; branchId: string; name: string; lat: number | null; lng: number | null; notes: string | null; active: boolean; branch: { name: string }; _count: { routes: number } }

export default function Branches() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const branches = useLoad(() => get<Branch[]>('/branches'), []);
  const locations = useLoad(() => get<Location[]>('/locations'), []);
  const [branch, setBranch] = useState<Partial<Branch> | null>(null);
  const [loc, setLoc] = useState<Partial<Location> | null>(null);

  const saveBranch = async () => {
    const body = { name: branch!.name, code: branch!.code, address: branch!.address || null, lat: branch!.lat ?? null, lng: branch!.lng ?? null, active: branch!.active ?? true };
    if (branch!.id) await put(`/branches/${branch!.id}`, body);
    else await post('/branches', body);
    clearLookups();
    await branches.reload();
  };
  const saveLoc = async () => {
    const body = { branchId: loc!.branchId, name: loc!.name, lat: loc!.lat ?? null, lng: loc!.lng ?? null, notes: loc!.notes || null, active: loc!.active ?? true };
    if (loc!.id) await put(`/locations/${loc!.id}`, body);
    else await post('/locations', body);
    clearLookups();
    await locations.reload();
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('branch.title')}</h1>
        <div className="row">
          {can('branch.manage') && <button className="btn primary" onClick={() => setBranch({ active: true })}>{t('branch.new')}</button>}
          <button className="btn" onClick={() => setLoc({ active: true })}>{t('locationMod.new')}</button>
        </div>
      </div>
      <ErrorBox error={branches.error ?? locations.error} />
      <div className="card">
        <DataTable
          title={t('branch.title')}
          rows={branches.data}
          empty={{ message: t('empty.branches'), action: can('branch.manage') ? { label: t('empty.firstBranch'), onClick: () => setBranch({ active: true }) } : undefined }}
          onRow={can('branch.manage') ? (r) => setBranch(r) : undefined}
          actions={can('branch.manage') ? (r) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setBranch(r) }] : undefined}
          columns={[
            { key: 'code', label: t('branch.code') },
            { key: 'name', label: t('common.name') },
            { key: 'address', label: t('common.address') },
            { key: 'locations', label: t('locationMod.title'), value: (r) => r._count.locations, num: true },
            { key: 'availableFund', label: t('branch.availableFund'), money: true, total: true },
            { key: 'active', label: t('common.status'), render: (r) => <Badge tone={r.active ? 'ok' : undefined}>{r.active ? t('common.active') : t('common.inactive')}</Badge>, value: (r) => (r.active ? t('common.active') : t('common.inactive')) },
          ]}
        />
      </div>
      <div className="card">
        <DataTable
          title={t('locationMod.title')}
          rows={locations.data}
          empty={{ message: t('empty.locations'), action: { label: t('empty.firstLocation'), onClick: () => setLoc({ active: true }) } }}
          onRow={(r) => setLoc(r)}
          actions={(r) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setLoc(r) }]}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'branch', label: t('common.branch'), value: (r) => r.branch.name },
            { key: 'routes', label: t('nav.routes'), value: (r) => r._count.routes, num: true },
            { key: 'notes', label: t('common.notes') },
            { key: 'active', label: t('common.status'), value: (r) => (r.active ? t('common.active') : t('common.inactive')) },
          ]}
        />
      </div>
      {branch && (
        <FormModal title={branch.id ? `${t('common.edit')}: ${branch.name}` : t('branch.new')} onClose={() => setBranch(null)} onSubmit={saveBranch} wide>
          <Field label={t('common.name')}><input value={branch.name ?? ''} onChange={(e) => setBranch({ ...branch, name: e.target.value })} /></Field>
          <Field label={t('branch.code')}><input value={branch.code ?? ''} onChange={(e) => setBranch({ ...branch, code: e.target.value.toUpperCase() })} /></Field>
          <Field label={t('common.address')} full><input value={branch.address ?? ''} onChange={(e) => setBranch({ ...branch, address: e.target.value })} /></Field>
          <Field label={t('common.status')}>
            <select value={branch.active === false ? '0' : '1'} onChange={(e) => setBranch({ ...branch, active: e.target.value === '1' })}>
              <option value="1">{t('common.active')}</option>
              <option value="0">{t('common.inactive')}</option>
            </select>
          </Field>
          <div className="full">
            <div className="muted" style={{ marginBottom: 6 }}>{t('customerMod.pickOnMap')}</div>
            <MapView height={280} pins={branch.lat != null && branch.lng != null ? [{ id: 'b', lat: branch.lat, lng: branch.lng, label: '★', title: branch.name ?? '' }] : []} onPick={(lat, lng) => setBranch({ ...branch, lat, lng })} />
          </div>
        </FormModal>
      )}
      {loc && (
        <FormModal title={loc.id ? `${t('common.edit')}: ${loc.name}` : t('locationMod.new')} onClose={() => setLoc(null)} onSubmit={saveLoc} wide>
          <Field label={t('common.branch')}><BranchPicker value={loc.branchId ?? ''} onChange={(v) => setLoc({ ...loc, branchId: v })} /></Field>
          <Field label={t('common.name')}><input value={loc.name ?? ''} onChange={(e) => setLoc({ ...loc, name: e.target.value })} /></Field>
          <Field label={t('common.notes')} full><input value={loc.notes ?? ''} onChange={(e) => setLoc({ ...loc, notes: e.target.value })} /></Field>
          <Field label={t('common.status')}>
            <select value={loc.active === false ? '0' : '1'} onChange={(e) => setLoc({ ...loc, active: e.target.value === '1' })}>
              <option value="1">{t('common.active')}</option>
              <option value="0">{t('common.inactive')}</option>
            </select>
          </Field>
          <div className="full">
            <div className="muted" style={{ marginBottom: 6 }}>{t('locationMod.centre')}: {t('customerMod.pickOnMap')}</div>
            <MapView height={280} pins={loc.lat != null && loc.lng != null ? [{ id: 'l', lat: loc.lat, lng: loc.lng, label: '●', title: loc.name ?? '' }] : []} onPick={(lat, lng) => setLoc({ ...loc, lat, lng })} />
          </div>
        </FormModal>
      )}

    </div>
  );
}
