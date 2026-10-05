import { useTranslation } from 'react-i18next';
import { get } from '../lib/api';
import { useLoad } from '../lib/hooks';

type Opt = { id: string; name: string };
const cache = new Map<string, Promise<unknown>>();
/** Small cached lookups for drop-downs; cleared after saves via clearLookups(). */
function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (!cache.has(key)) cache.set(key, fn().catch((e) => { cache.delete(key); throw e; }));
  return cache.get(key) as Promise<T>;
}
export const clearLookups = () => cache.clear();

interface PickerProps {
  value: string;
  onChange: (v: string) => void;
  allowAll?: boolean;
  required?: boolean;
}

function Picker({ value, onChange, allowAll, options, placeholder }: PickerProps & { options: Opt[] | null; placeholder: string }) {
  const { t } = useTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{allowAll ? t('common.all') : placeholder}</option>
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </select>
  );
}

export function BranchPicker(p: PickerProps) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached('branches', () => get<Opt[]>('/branches')), []);
  return <Picker {...p} options={data} placeholder={t('common.branch')} />;
}

export function LocationPicker(p: PickerProps & { branchId?: string }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached(`locations:${p.branchId ?? ''}`, () => get<Opt[]>('/locations', { branchId: p.branchId })), [p.branchId]);
  return <Picker {...p} options={data} placeholder={t('common.location')} />;
}

export interface RouteOpt extends Opt { locationId: string; location: { name: string; branchId: string } }
/** Routes, optionally narrowed to a branch or location. `onPickRoute` also gets the chosen route's location and branch. */
export function RoutePicker(p: PickerProps & { branchId?: string; locationId?: string; onPickRoute?: (r: RouteOpt | null) => void }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached(`routes:${p.branchId ?? ''}:${p.locationId ?? ''}`, () => get<RouteOpt[]>('/routes', { branchId: p.branchId, locationId: p.locationId })), [p.branchId, p.locationId]);
  const onChange = (v: string) => {
    p.onChange(v);
    p.onPickRoute?.((data ?? []).find((r) => r.id === v) ?? null);
  };
  return <Picker {...p} onChange={onChange} options={data} placeholder={t('common.route')} />;
}

export function StaffPicker(p: PickerProps & { role?: string; branchId?: string }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached(`staff:${p.role ?? ''}:${p.branchId ?? ''}`, () => get<Opt[]>('/staff', { role: p.role, branchId: p.branchId })), [p.role, p.branchId]);
  return <Picker {...p} options={data} placeholder={t('common.agent')} />;
}

export function FundPicker(p: PickerProps & { branchId?: string }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached(`funds:${p.branchId ?? ''}`, () => get<(Opt & { balance: number })[]>('/funds', { branchId: p.branchId })), [p.branchId]);
  return <Picker {...p} options={(data ?? []).map((f) => ({ id: f.id, name: `${f.name} (₹${(f.balance / 100).toLocaleString('en-IN')})` }))} placeholder={t('loanMod.fund')} />;
}

export function ProductPicker(p: PickerProps) {
  const { t } = useTranslation();
  const { data } = useLoad(() => cached('products', () => get<Opt[]>('/products')), []);
  return <Picker {...p} options={data} placeholder={t('common.product')} />;
}

export function ModeSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {['CASH', 'UPI', 'CARD', 'BANK'].map((m) => (
        <option key={m} value={m}>
          {t(`common.modes.${m}`)}
        </option>
      ))}
    </select>
  );
}
