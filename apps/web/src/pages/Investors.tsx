import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { INVESTOR_RETURN_TYPES } from '@localfinance/shared';
import { BranchPicker, FundPicker, ModeSelect, clearLookups } from '../components/pickers';
import { DataTable, ErrorBox, Field, FormModal, Loading, Stat, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, money, monthStart, toPaise, toRupeesInput, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Totals { invested: number; withdrawn: number; principalBalance: number; returnsEarned: number; paidOut: number; balanceDue: number }
interface Investor extends Totals { id: string; name: string; phone: string; address: string | null; idProof: string | null; bankDetails: string | null; nominee: string | null; agreementUrl: string | null; investments: number }
interface InvTxn { id: string; type: string; amount: number; date: string; periodStart: string | null; periodEnd: string | null; mode: string | null; note: string | null }
interface Investment extends Totals { id: string; branchId: string; branchName?: string; fundId: string; amount: number; date: string; returnType: string; returnRate: number; payoutFrequencyMonths: number; maturityDate: string | null; status: string; txns: InvTxn[] }
interface InvestorDetailData extends Omit<Investor, 'investments'> { investments: Investment[] }

function InvestorForm({ investor, onClose, onSaved }: { investor: Partial<Investor>; onClose: () => void; onSaved: (i: { id: string }) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: investor.name ?? '', phone: investor.phone ?? '', address: investor.address ?? '', idProof: investor.idProof ?? '', bankDetails: investor.bankDetails ?? '', nominee: investor.nominee ?? '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <FormModal
      title={investor.id ? `${t('common.edit')}: ${investor.name}` : t('investor.new')}
      onClose={onClose}
      onSubmit={async () => {
        const body = { ...f, address: f.address || null, idProof: f.idProof || null, bankDetails: f.bankDetails || null, nominee: f.nominee || null };
        const r = investor.id ? await put<{ id: string }>(`/investors/${investor.id}`, body) : await post<{ id: string }>('/investors', body);
        onSaved(r);
      }}
    >
      <Field label={t('common.name')}><input value={f.name} onChange={set('name')} /></Field>
      <Field label={t('common.phone')}><input value={f.phone} onChange={set('phone')} /></Field>
      <Field label={t('common.address')} full><input value={f.address} onChange={set('address')} /></Field>
      <Field label={t('investor.idProof')}><input value={f.idProof} onChange={set('idProof')} /></Field>
      <Field label={t('investor.bankDetails')}><input value={f.bankDetails} onChange={set('bankDetails')} /></Field>
      <Field label={t('investor.nominee')}><input value={f.nominee} onChange={set('nominee')} /></Field>
    </FormModal>
  );
}

function RunReturns({ onClose, onSaved }: { onClose: () => void; onSaved: (r: { total: number; created: unknown[] }) => void }) {
  const { t } = useTranslation();
  const lastMonthEnd = (() => {
    const d = new Date(`${monthStart()}T00:00:00Z`);
    d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  })();
  const [f, setF] = useState({ periodStart: lastMonthEnd.slice(0, 8) + '01', periodEnd: lastMonthEnd });
  return (
    <FormModal title={t('investor.runReturns')} submitLabel={t('investor.runReturns')} onClose={onClose} onSubmit={async () => onSaved(await post('/investors/returns/run', f))}>
      <Field label={t('common.from')}><input type="date" value={f.periodStart} onChange={(e) => setF({ ...f, periodStart: e.target.value })} /></Field>
      <Field label={t('common.to')}><input type="date" value={f.periodEnd} onChange={(e) => setF({ ...f, periodEnd: e.target.value })} /></Field>
      <div className="full muted">{t('investor.runHelp')}</div>
    </FormModal>
  );
}

export default function Investors() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Investor[]>('/investors'), []);
  const due = useLoad(() => get<{ investmentId: string; investor: string; balanceDue: number; nextPayout: string; due: boolean }[]>('/investors/payouts-due'), []);
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const list = data ?? [];
  return (
    <div>
      <div className="page-head">
        <h1>{t('investor.title')}</h1>
        <div className="row">
          <button className="btn" onClick={() => setRunning(true)}>{t('investor.runReturns')}</button>
          <button className="btn primary" onClick={() => setCreating(true)}>{t('investor.new')}</button>
        </div>
      </div>
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <Stat label={t('investor.invested')} value={money(list.reduce((s, i) => s + i.principalBalance, 0))} />
        <Stat label={t('investor.returnsEarned')} value={money(list.reduce((s, i) => s + i.returnsEarned, 0))} />
        <Stat label={t('investor.paidOut')} value={money(list.reduce((s, i) => s + i.paidOut, 0))} />
        <Stat label={t('investor.balanceDue')} value={money(list.reduce((s, i) => s + i.balanceDue, 0))} />
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('investor.title')}
          rows={data}
          onRow={(i) => nav(`/investors/${i.id}`)}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'phone', label: t('common.phone') },
            { key: 'investments', label: t('investor.investments'), num: true },
            { key: 'principalBalance', label: t('investor.invested'), money: true, total: true },
            { key: 'returnsEarned', label: t('investor.returnsEarned'), money: true, total: true },
            { key: 'paidOut', label: t('investor.paidOut'), money: true, total: true },
            { key: 'balanceDue', label: t('investor.balanceDue'), money: true, total: true },
          ]}
        />
      </div>
      {(due.data?.length ?? 0) > 0 && (
        <div className="card">
          <h3>{t('investor.payoutsDue')}</h3>
          <DataTable
            rows={due.data}
            columns={[
              { key: 'investor', label: t('common.name') },
              { key: 'balanceDue', label: t('investor.balanceDue'), money: true, total: true },
              { key: 'nextPayout', label: t('investor.nextPayout'), value: (r) => dateIN(r.nextPayout) },
              { key: 'due', label: t('common.status'), value: (r) => (r.due ? t('investor.dueNow') : '') },
            ]}
          />
        </div>
      )}
      {creating && <InvestorForm investor={{}} onClose={() => setCreating(false)} onSaved={(i) => nav(`/investors/${i.id}`)} />}
      {running && (
        <RunReturns
          onClose={() => setRunning(false)}
          onSaved={(r) => {
            toast(`${t('investor.returnsCreated', { count: r.created.length })}: ${money(r.total)}`);
            void reload();
            void due.reload();
          }}
        />
      )}
    </div>
  );
}

export function InvestorDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { profile } = useAuth();
  const { id } = useParams();
  const { data: inv, error, reload } = useLoad(() => get<InvestorDetailData>(`/investors/${id}`), [id]);
  const [editing, setEditing] = useState(false);
  const [investing, setInvesting] = useState(false);
  const [paying, setPaying] = useState<{ investment: Investment; kind: 'PAYOUT' | 'WITHDRAWAL' } | null>(null);
  if (error) return <ErrorBox error={error} />;
  if (!inv) return <Loading />;
  const done = () => {
    clearLookups();
    toast(t('common.saved'));
    void reload();
  };
  const isAdmin = profile?.role === 'TENANT_ADMIN';
  const txns = inv.investments.flatMap((i) => i.txns.map((x) => ({ ...x, branchName: i.branchName }))).sort((a, b) => a.date.localeCompare(b.date));
  return (
    <div>
      <div className="page-head">
        <div>
          <div className="muted"><Link to="/investors">{t('investor.title')}</Link></div>
          <h1>{inv.name}</h1>
          <div className="muted">{inv.phone} · {inv.address ?? ''}</div>
        </div>
        <div className="row no-print">
          <button className="btn" onClick={() => setEditing(true)}>{t('common.edit')}</button>
          <button className="btn primary" onClick={() => setInvesting(true)}>{t('investor.invest')}</button>
        </div>
      </div>
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <Stat label={t('investor.invested')} value={money(inv.principalBalance)} sub={`${money(inv.invested)} − ${money(inv.withdrawn)}`} />
        <Stat label={t('investor.returnsEarned')} value={money(inv.returnsEarned)} />
        <Stat label={t('investor.paidOut')} value={money(inv.paidOut)} />
        <Stat label={t('investor.balanceDue')} value={money(inv.balanceDue)} />
      </div>
      <div className="card">
        <dl className="kv">
          <dt>{t('investor.idProof')}</dt><dd>{inv.idProof ?? '-'}</dd>
          <dt>{t('investor.bankDetails')}</dt><dd>{inv.bankDetails ?? '-'}</dd>
          <dt>{t('investor.nominee')}</dt><dd>{inv.nominee ?? '-'}</dd>
        </dl>
      </div>
      <div className="card">
        <h3>{t('investor.investments')}</h3>
        <DataTable
          rows={inv.investments}
          columns={[
            { key: 'date', label: t('common.date'), value: (i) => dateIN(i.date) },
            { key: 'branchName', label: t('common.branch') },
            { key: 'amount', label: t('common.amount'), money: true, total: true },
            { key: 'returnType', label: t('investor.returnType'), value: (i) => `${t(`investor.returnTypes.${i.returnType}`)} ${i.returnRate}%` },
            { key: 'payoutFrequencyMonths', label: t('investor.payoutEvery'), num: true },
            { key: 'maturityDate', label: t('investor.maturityDate'), value: (i) => dateIN(i.maturityDate) },
            { key: 'principalBalance', label: t('investor.invested'), money: true, total: true },
            { key: 'balanceDue', label: t('investor.balanceDue'), money: true, total: true },
            { key: 'status', label: t('common.status'), value: (i) => (i.status === 'ACTIVE' ? t('common.active') : t('customerMod.statuses.CLOSED')) },
            {
              key: 'actions',
              label: t('common.actions'),
              value: () => '',
              render: (i) =>
                isAdmin && i.status === 'ACTIVE' ? (
                  <div className="row no-print">
                    {i.balanceDue > 0 && <button className="btn small" onClick={() => setPaying({ investment: i, kind: 'PAYOUT' })}>{t('investor.payout')}</button>}
                    <button className="btn small" onClick={() => setPaying({ investment: i, kind: 'WITHDRAWAL' })}>{t('investor.withdrawal')}</button>
                  </div>
                ) : null,
            },
          ]}
        />
        {!isAdmin && <div className="muted">{t('investor.adminOnly')}</div>}
      </div>
      <div className="card">
        <DataTable
          title={`${t('investor.statement')}: ${inv.name}`}
          rows={txns}
          columns={[
            { key: 'date', label: t('common.date'), value: (x) => dateIN(x.date) },
            { key: 'type', label: t('daybook.direction'), value: (x) => t(`investor.txnTypes.${x.type}`) },
            { key: 'period', label: t('investor.period'), value: (x) => (x.periodStart ? `${dateIN(x.periodStart)} – ${dateIN(x.periodEnd)}` : '') },
            { key: 'branchName', label: t('common.branch') },
            { key: 'amount', label: t('common.amount'), money: true },
            { key: 'mode', label: t('common.mode'), value: (x) => (x.mode ? t(`common.modes.${x.mode}`) : '') },
            { key: 'note', label: t('common.notes') },
          ]}
        />
      </div>
      {editing && <InvestorForm investor={{ ...inv, investments: inv.investments.length }} onClose={() => setEditing(false)} onSaved={done} />}
      {investing && <InvestForm investorId={inv.id} onClose={() => setInvesting(false)} onSaved={done} />}
      {paying && <PayoutForm investment={paying.investment} kind={paying.kind} onClose={() => setPaying(null)} onSaved={done} />}
    </div>
  );
}

function InvestForm({ investorId, onClose, onSaved }: { investorId: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ amount: '', date: today(), branchId: '', fundId: '', mode: 'BANK', returnType: 'FIXED_MONTHLY', returnRate: '1.5', payoutFrequencyMonths: '1', maturityDate: '' });
  return (
    <FormModal
      title={t('investor.invest')}
      onClose={onClose}
      onSubmit={async () => {
        await post('/investors/investments', {
          investorId,
          amount: toPaise(f.amount),
          date: f.date,
          branchId: f.branchId,
          fundId: f.fundId,
          mode: f.mode,
          returnType: f.returnType,
          returnRate: Number(f.returnRate),
          payoutFrequencyMonths: Number(f.payoutFrequencyMonths),
          maturityDate: f.maturityDate || null,
        });
        onSaved();
      }}
    >
      <Field label={t('common.amount')}><input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v, fundId: '' })} /></Field>
      <Field label={t('loanMod.fund')}><FundPicker branchId={f.branchId || undefined} value={f.fundId} onChange={(v) => setF({ ...f, fundId: v })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('investor.returnType')}>
        <select value={f.returnType} onChange={(e) => setF({ ...f, returnType: e.target.value })}>
          {INVESTOR_RETURN_TYPES.map((r) => <option key={r} value={r}>{t(`investor.returnTypes.${r}`)}</option>)}
        </select>
      </Field>
      <Field label={t('investor.returnRate')}><input type="number" min="0" step="0.01" value={f.returnRate} onChange={(e) => setF({ ...f, returnRate: e.target.value })} /></Field>
      <Field label={t('investor.payoutEvery')}><input type="number" min="1" max="12" value={f.payoutFrequencyMonths} onChange={(e) => setF({ ...f, payoutFrequencyMonths: e.target.value })} /></Field>
      <Field label={t('investor.maturityDate')}><input type="date" value={f.maturityDate} onChange={(e) => setF({ ...f, maturityDate: e.target.value })} /></Field>
    </FormModal>
  );
}

function PayoutForm({ investment, kind, onClose, onSaved }: { investment: Investment; kind: 'PAYOUT' | 'WITHDRAWAL'; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const max = kind === 'PAYOUT' ? investment.balanceDue : investment.principalBalance;
  const [f, setF] = useState({ amount: toRupeesInput(max), date: today(), mode: 'BANK', fundId: investment.fundId, note: '' });
  return (
    <FormModal
      title={kind === 'PAYOUT' ? t('investor.payout') : t('investor.withdrawal')}
      onClose={onClose}
      onSubmit={async () => {
        await post('/investors/payouts', { investmentId: investment.id, amount: toPaise(f.amount), date: f.date, mode: f.mode, kind, fundId: f.fundId, note: f.note || null });
        onSaved();
      }}
    >
      <Field label={`${t('common.amount')} (≤ ${money(max)})`}><input type="number" min="1" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('loanMod.fund')}><FundPicker branchId={investment.branchId} value={f.fundId} onChange={(v) => setF({ ...f, fundId: v })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('common.notes')} full><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </FormModal>
  );
}
