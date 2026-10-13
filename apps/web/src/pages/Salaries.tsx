import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Banknote, HandCoins, History, Pencil } from 'lucide-react';
import { BranchPicker, ModeSelect } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Modal, Stat, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { dateIN, money, toPaise, toRupeesInput, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Payment { id: string; month: string; date: string; gross: number; advanceDeducted: number; net: number; mode: string; note: string | null }
interface Advance { id: string; date: string; amount: number; mode: string; note: string | null }
interface Row {
  userId: string;
  name: string;
  roleName: string;
  baseRole: string;
  branchIds: string[];
  branches: string;
  salary: number;
  advancesThisMonth: number;
  advanceOutstanding: number;
  netDue: number;
  status: 'PAID' | 'UNPAID' | 'NO_SALARY';
  payment: Payment | null;
}
interface Month { month: string; rows: Row[]; totals: { salary: number; paid: number; unpaid: number; advanceOutstanding: number } }

const tone = (s: Row['status']) => (s === 'PAID' ? 'ok' : s === 'UNPAID' ? 'warn' : undefined);

/** Staff salaries for one month: set each person's salary, give advances, and pay the month net of advances. */
export default function Salaries() {
  const { t } = useTranslation();
  const toast = useToast();
  const [month, setMonth] = useState(today().slice(0, 7));
  const [branchId, setBranchId] = useState('');
  const { data, error, reload } = useLoad(() => get<Month>('/salaries', { month, branchId }), [month, branchId]);
  const [rate, setRate] = useState<Row | null>(null);
  const [advance, setAdvance] = useState<Row | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [history, setHistory] = useState<Row | null>(null);
  const done = () => {
    toast(t('common.saved'));
    void reload();
  };
  return (
    <div>
      <div className="page-head">
        <h1>{t('salary.title')}</h1>
        <div className="row">
          <input type="month" aria-label={t('salary.month')} value={month} max={today().slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
        </div>
      </div>
      {data && (
        <div className="grid k4" style={{ marginBottom: 16 }}>
          <Stat label={t('salary.totalSalary')} value={money(data.totals.salary)} />
          <Stat tone="ok" label={t('salary.totalPaid')} value={money(data.totals.paid)} />
          <Stat tone={data.totals.unpaid ? 'warn' : undefined} label={t('salary.totalUnpaid')} value={money(data.totals.unpaid)} />
          <Stat tone="info" label={t('salary.advanceOutstanding')} value={money(data.totals.advanceOutstanding)} />
        </div>
      )}
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={`${t('salary.title')} ${month}`}
          rows={data?.rows}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'roleName', label: t('staff.role') },
            { key: 'salary', label: t('salary.monthlySalary'), money: true, total: true },
            { key: 'advanceOutstanding', label: t('salary.advanceOutstanding'), money: true, total: true },
            { key: 'net', label: t('salary.netColumn'), money: true, total: true, value: (r) => r.payment?.net ?? r.netDue },
            {
              key: 'status',
              label: t('common.status'),
              value: (r) => t(`salary.statuses.${r.status}`),
              render: (r) => (
<span title={r.payment ? `${t('salary.paidOn')} ${dateIN(r.payment.date)}` : undefined}>
                  <Badge tone={tone(r.status)}>{t(`salary.statuses.${r.status}`)}</Badge>
                </span>
              ),
            },
          ]}
          actions={(r) => [
            { icon: Pencil, label: t('salary.setSalary'), onClick: () => setRate(r) },
            { icon: HandCoins, label: t('salary.giveAdvance'), onClick: () => setAdvance(r) },
            { icon: Banknote, label: t('salary.pay'), tone: 'primary', onClick: () => setPaying(r), hidden: r.status !== 'UNPAID' },
            { icon: History, label: t('salary.history'), onClick: () => setHistory(r) },
          ]}
        />
      </div>
      {rate && <RateForm row={rate} onClose={() => setRate(null)} onSaved={done} />}
      {advance && <AdvanceForm row={advance} onClose={() => setAdvance(null)} onSaved={done} />}
      {paying && <PayForm row={paying} month={month} onClose={() => setPaying(null)} onSaved={done} />}
      {history && <HistoryModal row={history} onClose={() => setHistory(null)} />}
    </div>
  );
}

function RateForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState(toRupeesInput(row.salary || null));
  return (
    <FormModal title={`${t('salary.setSalary')}: ${row.name}`} onClose={onClose} onSubmit={async () => { await put(`/salaries/staff/${row.userId}`, { amount: toPaise(amount) }); onSaved(); }}>
      <Field label={t('salary.monthlySalary')}><input type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
    </FormModal>
  );
}

function AdvanceForm({ row, onClose, onSaved }: { row: Row; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branchId: row.branchIds[0] ?? '', amount: '', date: today(), mode: 'CASH', note: '' });
  return (
    <FormModal
      title={`${t('salary.giveAdvance')}: ${row.name}`}
      onClose={onClose}
      onSubmit={async () => {
        await post('/salaries/advances', { userId: row.userId, branchId: f.branchId, amount: toPaise(f.amount), date: f.date, mode: f.mode, note: f.note || null });
        onSaved();
      }}
    >
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} /></Field>
      <Field label={t('common.amount')}><input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('common.notes')} full><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="full muted">{t('salary.advanceHelp')}</div>
    </FormModal>
  );
}

function PayForm({ row, month, onClose, onSaved }: { row: Row; month: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branchId: row.branchIds[0] ?? '', date: today(), mode: 'CASH', deduct: toRupeesInput(Math.min(row.advanceOutstanding, row.salary)), note: '' });
  const deduct = toPaise(f.deduct);
  return (
    <FormModal
      title={`${t('salary.pay')}: ${row.name} · ${month}`}
      submitLabel={`${t('salary.pay')} ${money(Math.max(0, row.salary - deduct))}`}
      onClose={onClose}
      onSubmit={async () => {
        await post('/salaries/payments', { userId: row.userId, branchId: f.branchId, month, date: f.date, mode: f.mode, advanceDeduct: deduct, note: f.note || null });
        onSaved();
      }}
    >
      <Field label={t('salary.gross')}><input value={money(row.salary)} readOnly /></Field>
      <Field label={`${t('salary.deduct')} (${t('salary.advanceOutstanding')} ${money(row.advanceOutstanding)})`}>
        <input type="number" min="0" max={Math.min(row.advanceOutstanding, row.salary) / 100} value={f.deduct} onChange={(e) => setF({ ...f, deduct: e.target.value })} />
      </Field>
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('common.notes')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      <div className="full muted">{t('salary.deductHelp')}</div>
    </FormModal>
  );
}

function HistoryModal({ row, onClose }: { row: Row; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, error } = useLoad(() => get<{ advanceOutstanding: number; advances: Advance[]; payments: Payment[] }>(`/salaries/staff/${row.userId}`), [row.userId]);
  return (
    <Modal wide title={`${row.name}: ${t('salary.history')}`} onClose={onClose} actions={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <ErrorBox error={error} />
      <DataTable
        title={`${row.name} ${t('salary.payments')}`}
        rows={data?.payments}
        columns={[
          { key: 'month', label: t('salary.month') },
          { key: 'date', label: t('salary.paidOn'), value: (p) => dateIN(p.date) },
          { key: 'gross', label: t('salary.gross'), money: true, total: true },
          { key: 'advanceDeducted', label: t('salary.deducted'), money: true, total: true },
          { key: 'net', label: t('salary.net'), money: true, total: true },
          { key: 'mode', label: t('common.mode'), value: (p) => t(`common.modes.${p.mode}`) },
        ]}
      />
      <DataTable
        title={`${row.name} ${t('salary.advances')} · ${t('salary.advanceOutstanding')} ${money(data?.advanceOutstanding ?? 0)}`}
        rows={data?.advances}
        columns={[
          { key: 'date', label: t('common.date'), value: (a) => dateIN(a.date) },
          { key: 'amount', label: t('common.amount'), money: true, total: true },
          { key: 'mode', label: t('common.mode'), value: (a) => t(`common.modes.${a.mode}`) },
          { key: 'note', label: t('common.notes') },
        ]}
      />
    </Modal>
  );
}
