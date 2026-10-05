import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { FREQUENCIES, INTEREST_METHODS, PENALTY_TYPES, summarize } from '@localfinance/shared';
import { clearLookups } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { money, toPaise, toRupeesInput } from '../lib/format';
import { useLoad } from '../lib/hooks';

export interface Product {
  id: string;
  name: string;
  frequency: string;
  minAmount: number;
  maxAmount: number;
  tenure: number;
  interestMethod: string;
  interestRate: number;
  feePercent: number;
  feeFlat: number;
  penaltyType: string;
  penaltyValue: number;
  graceDays: number;
  active: boolean;
}

function ProductForm({ product, onClose, onSaved }: { product: Partial<Product>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({
    name: product.name ?? '',
    frequency: product.frequency ?? 'DAILY',
    minAmount: toRupeesInput(product.minAmount ?? 500_000),
    maxAmount: toRupeesInput(product.maxAmount ?? 5_000_000),
    tenure: String(product.tenure ?? 100),
    interestMethod: product.interestMethod ?? 'FLAT',
    interestRate: String(product.interestRate ?? 20),
    feePercent: String(product.feePercent ?? 0),
    feeFlat: toRupeesInput(product.feeFlat ?? 0),
    penaltyType: product.penaltyType ?? 'NONE',
    // FIXED_PER_DAY is stored in paise; the form shows rupees.
    penaltyValue: product.penaltyType === 'FIXED_PER_DAY' ? toRupeesInput(product.penaltyValue ?? 0) : String(product.penaltyValue ?? 0),
    graceDays: String(product.graceDays ?? 0),
    active: product.active ?? true,
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const body = () => ({
    name: f.name,
    frequency: f.frequency,
    minAmount: toPaise(f.minAmount),
    maxAmount: toPaise(f.maxAmount),
    tenure: Number(f.tenure),
    interestMethod: f.interestMethod,
    interestRate: Number(f.interestRate),
    feePercent: Number(f.feePercent),
    feeFlat: toPaise(f.feeFlat),
    penaltyType: f.penaltyType,
    penaltyValue: f.penaltyType === 'FIXED_PER_DAY' ? toPaise(f.penaltyValue) : Number(f.penaltyValue),
    graceDays: Number(f.graceDays),
    active: f.active,
  });
  let example: ReturnType<typeof summarize> | null = null;
  try {
    const b = body();
    example = summarize({ ...b, principal: b.minAmount, frequency: b.frequency as 'DAILY', interestMethod: b.interestMethod as 'FLAT' });
  } catch {
    example = null;
  }
  return (
    <FormModal
      wide
      title={product.id ? `${t('common.edit')}: ${product.name}` : t('product.new')}
      onClose={onClose}
      onSubmit={async () => {
        if (product.id) await put(`/products/${product.id}`, body());
        else await post('/products', body());
        clearLookups();
        onSaved();
      }}
    >
      <Field label={t('common.name')} full><input value={f.name} onChange={set('name')} /></Field>
      <Field label={t('product.frequency')}>
        <select value={f.frequency} onChange={set('frequency')}>
          {FREQUENCIES.map((x) => <option key={x} value={x}>{t(`product.frequencies.${x}`)}</option>)}
        </select>
      </Field>
      <Field label={t('product.minAmount')}><input type="number" min="1" value={f.minAmount} onChange={set('minAmount')} /></Field>
      <Field label={t('product.maxAmount')}><input type="number" min="1" value={f.maxAmount} onChange={set('maxAmount')} /></Field>
      <Field label={t('product.tenure')}><input type="number" min="1" value={f.tenure} onChange={set('tenure')} /></Field>
      <Field label={t('product.interestMethod')}>
        <select value={f.interestMethod} onChange={set('interestMethod')}>
          {INTEREST_METHODS.map((x) => <option key={x} value={x}>{t(`product.methods.${x}`)}</option>)}
        </select>
      </Field>
      <Field label={t('product.interestRate')} error={undefined}>
        <input type="number" min="0" step="0.01" value={f.interestRate} onChange={set('interestRate')} />
      </Field>
      <Field label={t('product.feePercent')}><input type="number" min="0" step="0.01" value={f.feePercent} onChange={set('feePercent')} /></Field>
      <Field label={t('product.feeFlat')}><input type="number" min="0" value={f.feeFlat} onChange={set('feeFlat')} /></Field>
      <Field label={t('product.penaltyType')}>
        <select value={f.penaltyType} onChange={set('penaltyType')}>
          {PENALTY_TYPES.map((x) => <option key={x} value={x}>{t(`product.penaltyTypes.${x}`)}</option>)}
        </select>
      </Field>
      <Field label={t('product.penaltyValue')}><input type="number" min="0" step="0.01" value={f.penaltyValue} disabled={f.penaltyType === 'NONE'} onChange={set('penaltyValue')} /></Field>
      <Field label={t('product.graceDays')}><input type="number" min="0" value={f.graceDays} onChange={set('graceDays')} /></Field>
      <Field label={t('common.status')}>
        <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
          <option value="1">{t('common.active')}</option>
          <option value="0">{t('common.inactive')}</option>
        </select>
      </Field>
      <div className="full muted">{t('product.interestRateHelp')}</div>
      {example && (
        <div className="full ok-box">
          {t('product.example')}: {t('loanMod.principal')} {money(example.principal)} · {t('loanMod.fee')} {money(example.fee)} · {t('loanMod.upfrontInterest')} {money(example.upfrontInterest)} · {t('loanMod.netDisbursed')} {money(example.netDisbursed)} · {t('loanMod.totalRepayable')} {money(example.totalRepayable)}
        </div>
      )}
    </FormModal>
  );
}

export default function Products() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Product[]>('/products', { all: 'true' }), []);
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('product.title')}</h1>
        <button className="btn primary" onClick={() => setEditing({})}>{t('product.new')}</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('product.title')}
          rows={data}
          empty={{ message: t('empty.products'), action: { label: t('empty.firstProduct'), onClick: () => setEditing({}) } }}
          onRow={(p) => setEditing(p)}
          actions={(p) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setEditing(p) }]}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'frequency', label: t('product.frequency'), value: (p) => t(`product.frequencies.${p.frequency}`) },
            { key: 'minAmount', label: t('product.minAmount'), money: true },
            { key: 'maxAmount', label: t('product.maxAmount'), money: true },
            { key: 'tenure', label: t('product.tenure'), num: true },
            { key: 'interestMethod', label: t('product.interestMethod'), value: (p) => t(`product.methods.${p.interestMethod}`) },
            { key: 'interestRate', label: t('product.interestRate'), num: true },
            { key: 'feePercent', label: t('product.feePercent'), num: true },
            { key: 'penaltyType', label: t('product.penaltyType'), value: (p) => t(`product.penaltyTypes.${p.penaltyType}`) },
            { key: 'active', label: t('common.status'), value: (p) => (p.active ? t('common.active') : t('common.inactive')), render: (p) => <Badge tone={p.active ? 'ok' : undefined}>{p.active ? t('common.active') : t('common.inactive')}</Badge> },
          ]}
        />
      </div>
      {editing && <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => { toast(t('common.saved')); void reload(); }} />}
    </div>
  );
}
