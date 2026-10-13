import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BranchPicker, clearLookups } from './pickers';
import { MapView } from './MapView';
import { Field, FormModal } from './ui';
import { post, put } from '../lib/api';

export interface BranchDraft {
  id?: string;
  name?: string;
  code?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  active?: boolean;
}

export interface AreaDraft {
  id?: string;
  branchId?: string;
  name?: string;
  notes?: string | null;
  lat?: number | null;
  lng?: number | null;
  active?: boolean;
}

/** Add or edit a branch. Used by the Branches page and the Setup view. */
export function BranchForm({ branch: start, onClose, onSaved }: { branch: BranchDraft; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [branch, setBranch] = useState<BranchDraft>(start);
  const save = async () => {
    const body = { name: branch.name, code: branch.code, address: branch.address || null, lat: branch.lat ?? null, lng: branch.lng ?? null, active: branch.active ?? true };
    if (branch.id) await put(`/branches/${branch.id}`, body);
    else await post('/branches', body);
    clearLookups();
    onSaved();
  };
  return (
    <FormModal title={branch.id ? `${t('common.edit')}: ${branch.name}` : t('branch.new')} onClose={onClose} onSubmit={save} wide>
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
  );
}

/** Add or edit an area (location). An inactive area is hidden from the pickers but kept for its history. */
export function AreaForm({ area: start, onClose, onSaved }: { area: AreaDraft; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [loc, setLoc] = useState<AreaDraft>(start);
  const save = async () => {
    const body = { branchId: loc.branchId, name: loc.name, lat: loc.lat ?? null, lng: loc.lng ?? null, notes: loc.notes || null, active: loc.active ?? true };
    if (loc.id) await put(`/locations/${loc.id}`, body);
    else await post('/locations', body);
    clearLookups();
    onSaved();
  };
  return (
    <FormModal title={loc.id ? `${t('common.edit')}: ${loc.name}` : t('locationMod.new')} onClose={onClose} onSubmit={save} wide>
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
  );
}
