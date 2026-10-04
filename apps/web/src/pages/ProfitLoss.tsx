import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BranchPicker, ProductPicker } from '../components/pickers';
import { DataTable, ErrorBox, Loading, Stat } from '../components/ui';
import { get } from '../lib/api';
import { dateIN, money, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface PL {
  from: string;
  to: string;
  basis: string;
  interestIncome: number;
  feeIncome: number;
  penaltyIncome: number;
  otherIncome: number;
  totalIncome: number;
  investorReturns: number;
  expenses: number;
  badDebts: number;
  netProfit: number;
  expenseBreakdown: { category: string; amount: number }[];
}

const LINES: (keyof PL)[] = ['interestIncome', 'feeIncome', 'penaltyIncome', 'otherIncome', 'totalIncome', 'investorReturns', 'expenses', 'badDebts', 'netProfit'];

export default function ProfitLoss() {
  const { t } = useTranslation();
  const fyStart = (() => {
    const d = today();
    const y = Number(d.slice(0, 4)) - (Number(d.slice(5, 7)) < 4 ? 1 : 0);
    return `${y}-04-01`;
  })();
  const [f, setF] = useState({ from: fyStart, to: today(), branchId: '', productId: '' });
  const [applied, setApplied] = useState(f);
  const { data, error } = useLoad(() => get<{ current: PL; previous: PL; months: (PL & { month: string })[] }>('/reports/profit-loss', applied), [JSON.stringify(applied)]);
  const change = (a: number, b: number) => (b ? `${Math.round(((a - b) / Math.abs(b)) * 1000) / 10}%` : '-');
  return (
    <div>
      <div className="page-head">
        <h1>{t('pl.title')}</h1>
        <form className="row no-print" onSubmit={(e) => { e.preventDefault(); setApplied(f); }}>
          <label className="field inline">{t('common.from')}<input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
          <label className="field inline">{t('common.to')}<input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
          <BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} allowAll />
          <ProductPicker value={f.productId} onChange={(v) => setF({ ...f, productId: v })} allowAll />
          <button className="btn primary">{t('report.run')}</button>
        </form>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        !error && <Loading />
      ) : (
        <>
          <div className="grid k4" style={{ marginBottom: 16 }}>
            <Stat label={t('pl.totalIncome')} value={money(data.current.totalIncome)} sub={`${t('pl.previousPeriod')}: ${money(data.previous.totalIncome)}`} />
            <Stat label={t('pl.expenses')} value={money(data.current.expenses)} />
            <Stat label={t('pl.investorReturns')} value={money(data.current.investorReturns)} />
            <Stat label={t('pl.netProfit')} value={<span style={{ color: data.current.netProfit < 0 ? 'var(--danger)' : 'var(--ok)' }}>{money(data.current.netProfit)}</span>} sub={`${t('pl.basis')}: ${t(`pl.bases.${data.current.basis}`)}`} />
          </div>
          <div className="grid c2">
            <div className="card">
              <DataTable
                title={`${t('pl.title')} ${dateIN(data.current.from)} – ${dateIN(data.current.to)}`}
                rows={LINES.map((k) => ({ id: k, line: t(`pl.${k}`), current: data.current[k] as number, previous: data.previous[k] as number }))}
                columns={[
                  { key: 'line', label: '', render: (r) => (['totalIncome', 'netProfit'].includes(r.id) ? <strong>{r.line}</strong> : r.line) },
                  { key: 'current', label: `${dateIN(data.current.from)} – ${dateIN(data.current.to)}`, money: true },
                  { key: 'previous', label: `${t('pl.previousPeriod')} (${dateIN(data.previous.from)} – ${dateIN(data.previous.to)})`, money: true },
                  { key: 'change', label: '±', num: true, value: (r) => change(r.current, r.previous) },
                ]}
              />
            </div>
            <div className="card">
              <DataTable
                title={t('pl.expenseBreakdown')}
                rows={data.current.expenseBreakdown.map((e) => ({ ...e, id: e.category }))}
                columns={[
                  { key: 'category', label: t('daybook.category') },
                  { key: 'amount', label: t('common.amount'), money: true, total: true },
                  { key: 'share', label: '%', num: true, value: (e) => (data.current.expenses ? `${Math.round((e.amount / data.current.expenses) * 1000) / 10}%` : '-') },
                ]}
              />
            </div>
          </div>
          <div className="card">
            <DataTable
              title={t('pl.byMonth')}
              rows={data.months.map((m) => ({ ...m, id: m.month }))}
              columns={[
                { key: 'month', label: t('pl.month') },
                { key: 'interestIncome', label: t('pl.interestIncome'), money: true, total: true },
                { key: 'feeIncome', label: t('pl.feeIncome'), money: true, total: true },
                { key: 'penaltyIncome', label: t('pl.penaltyIncome'), money: true, total: true },
                { key: 'otherIncome', label: t('pl.otherIncome'), money: true, total: true },
                { key: 'investorReturns', label: t('pl.investorReturns'), money: true, total: true },
                { key: 'expenses', label: t('pl.expenses'), money: true, total: true },
                { key: 'badDebts', label: t('pl.badDebts'), money: true, total: true },
                { key: 'netProfit', label: t('pl.netProfit'), money: true, total: true },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
