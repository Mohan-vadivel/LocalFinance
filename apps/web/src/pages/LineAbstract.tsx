import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { addDays, addMonthsClamped } from '@localfinance/shared';
import { BranchPicker } from '../components/pickers';
import { DataTable, ErrorBox, Loading, Stat, type Column } from '../components/ui';
import { get } from '../lib/api';
import { dateIN, money, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Line {
  route: string;
  routeId: string;
  openingAccounts: number;
  newAccounts: number;
  closedAccounts: number;
  closingAccounts: number;
  loanAmount: number;
  interestTaken: number;
  docCharges: number;
  collected: number;
  cash: number;
  upi: number;
  interestCollected: number;
  penalty: number;
  balance: number;
}
interface BookLine { key: string; system: boolean; amount: number }
interface Abstract {
  from: string;
  to: string;
  lines: Line[];
  book: { opening: { cash: number; bank: number }; closing: { cash: number; bank: number }; receipts: BookLine[]; payments: BookLine[] };
  profit: { income: number; costs: number; net: number } | null;
}

/** The owner's monthly sheet per line: accounts, money given and collected, balances, receipts and payments. */
export default function LineAbstract() {
  const { t } = useTranslation();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const from = `${month}-01`;
  const to = addDays(addMonthsClamped(from, 1, 1), -1);
  const { data, error, loading } = useLoad(() => get<Abstract>('/reports/line-abstract', { from, to, branchId }), [from, to, branchId]);

  const cols: Column<Line>[] = [
    { key: 'route', label: t('reportCols.route'), render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.route}</span> },
    ...(['openingAccounts', 'newAccounts', 'closedAccounts', 'closingAccounts'] as const).map((k) => ({ key: k, label: t(`reportCols.${k}`), num: true, total: true })),
    ...(['loanAmount', 'interestTaken', 'docCharges', 'collected', 'cash', 'upi', 'interestCollected', 'penalty', 'balance'] as const).map((k) => ({ key: k, label: t(`reportCols.${k}`), money: true, total: true })),
  ];
  const label = (b: BookLine) => (b.system ? t(`daybook.system.${b.key}`, { defaultValue: b.key }) : b.key);

  return (
    <div>
      <div className="page-head">
        <h1>{t('abstract.title')}</h1>
      </div>
      <div className="card no-print">
        <div className="row">
          <label className="field inline">{t('abstract.month')}<input type="month" value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
        </div>
      </div>
      <ErrorBox error={error} />
      {loading && !data && <Loading />}
      {data && (
        <>
          <div className="print-only muted">{dateIN(data.from)} – {dateIN(data.to)}</div>
          {data.profit && (
            <div className="grid k4" style={{ marginBottom: 16 }}>
              <Stat label={t('abstract.income')} value={money(data.profit.income)} />
              <Stat label={t('abstract.costs')} value={money(data.profit.costs)} />
              <Stat label={t('abstract.profit')} value={money(data.profit.net)} />
              <Stat label={t('reportCols.collected')} value={money(data.lines.reduce((s, l) => s + l.collected, 0))} sub={`${t('reportCols.loanAmount')}: ${money(data.lines.reduce((s, l) => s + l.loanAmount, 0))}`} />
            </div>
          )}
          <div className="card">
            <DataTable title={`${t('abstract.lines')} ${dateIN(data.from)} – ${dateIN(data.to)}`} rows={data.lines} columns={cols} />
          </div>
          <div className="grid c2">
            <div className="card">
              <DataTable
                title={t('abstract.receipts')}
                rows={[
                  { name: `${t('abstract.opening')} · ${t('abstract.cash')}`, amount: data.book.opening.cash },
                  { name: `${t('abstract.opening')} · ${t('abstract.bank')}`, amount: data.book.opening.bank },
                  ...data.book.receipts.map((b) => ({ name: label(b), amount: b.amount })),
                ]}
                columns={[{ key: 'name', label: t('abstract.receipts') }, { key: 'amount', label: t('reportCols.amount'), money: true, total: true }]}
              />
            </div>
            <div className="card">
              <DataTable
                title={t('abstract.payments')}
                rows={[
                  ...data.book.payments.map((b) => ({ name: label(b), amount: b.amount })),
                  { name: `${t('abstract.closing')} · ${t('abstract.cash')}`, amount: data.book.closing.cash },
                  { name: `${t('abstract.closing')} · ${t('abstract.bank')}`, amount: data.book.closing.bank },
                ]}
                columns={[{ key: 'name', label: t('abstract.payments') }, { key: 'amount', label: t('reportCols.amount'), money: true, total: true }]}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
