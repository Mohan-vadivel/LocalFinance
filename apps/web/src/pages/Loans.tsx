import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BranchPicker, FundPicker, ModeSelect, ProductPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Loading, Stat, Tabs, statusTone, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, money, toPaise, toRupeesInput, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { HistoryView, Pager, type History } from './Customers';

interface Position { principalOutstanding: number; interestOutstanding: number; penaltyOutstanding: number; totalOutstanding: number; overdue: number; dueToday: number; daysPastDue: number }
interface Summary { principal: number; fee: number; upfrontInterest: number; netDisbursed: number; totalInterest: number; totalRepayable: number }
interface ScheduleRow { seq: number; dueDate: string; principalDue: number; interestDue: number; totalDue: number }
export interface LoanRow {
  id: string;
  number: string;
  customerId: string;
  branchId: string;
  productId: string;
  productName?: string;
  principal: number;
  frequency: string;
  tenure: number;
  status: string;
  stage: string;
  purpose: string | null;
  notes: string | null;
  disbursedOn: string | null;
  createdAt: string;
  requestedById: string;
  customer: { name: string; code: string; phone: string };
  position: Position | null;
}
interface Instalment { id: string; seq: number; dueDate: string; principalDue: number; interestDue: number; principalPaid: number; interestPaid: number; paidOn: string | null }
interface CollectionRow { id: string; receiptNo: string; date: string; collectedAt: string; amount: number; principal: number; interest: number; penalty: number; mode: string; upiRef: string | null; agentName?: string; flagged: boolean; distanceM: number | null; reversedAt: string | null; reverseReason: string | null; kind: string }
interface LoanDetailData extends LoanRow {
  interestMethod: string;
  interestRate: number;
  graceDays: number;
  penaltyType: string;
  penaltyValue: number;
  fee: number;
  upfrontInterest: number;
  netDisbursed: number;
  penaltyPaid: number;
  penaltyWaived: number;
  interestWaived: number;
  writtenOffAmount: number;
  closedOn: string | null;
  firstDueDate: string | null;
  disburseMode: string | null;
  fundName?: string;
  requestedByName?: string;
  approvedByName?: string;
  approvedAt: string | null;
  summary: Summary;
  instalments: Instalment[];
  approvals: { id: string; step: string; decision: string; reason: string | null; createdAt: string; userName?: string }[];
  collections: CollectionRow[];
  ledger: { id: string; date: string; type: string; description: string; debit: number; credit: number; balance: number }[];
  customer: LoanRow['customer'] & { id: string; address: string; lat: number | null; lng: number | null };
}

function CustomerSearch({ value, onChange }: { value: { id: string; name: string } | null; onChange: (c: { id: string; name: string } | null) => void }) {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<{ id: string; name: string; code: string; phone: string; status: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return setRows([]);
    const h = setTimeout(() => {
      void get<{ rows: typeof rows }>('/customers', { q }).then((r) => setRows(r.rows.slice(0, 8))).catch(() => setRows([]));
    }, 300);
    return () => clearTimeout(h);
  }, [q]);
  if (value) {
    return (
      <div className="row">
        <strong>{value.name}</strong>
        <button type="button" className="btn small" onClick={() => onChange(null)}>{t('common.edit')}</button>
      </div>
    );
  }
  return (
    <div>
      <input placeholder={t('customerMod.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ width: '100%' }} />
      {rows.map((r) => (
        <div key={r.id}>
          <button type="button" className="btn small" style={{ marginTop: 4 }} disabled={r.status !== 'ACTIVE'} onClick={() => onChange({ id: r.id, name: `${r.name} (${r.code})` })}>
            {r.name} · {r.code} · {r.phone} {r.status !== 'ACTIVE' ? `· ${t(`customerMod.statuses.${r.status}`)}` : ''}
          </button>
        </div>
      ))}
    </div>
  );
}

export function SchedulePreview({ summary, schedule }: { summary: Summary; schedule: ScheduleRow[] }) {
  const { t } = useTranslation();
  return (
    <div>
      <div className="grid k4" style={{ margin: '8px 0' }}>
        <Stat label={t('loanMod.netDisbursed')} value={money(summary.netDisbursed)} sub={`${t('loanMod.fee')} ${money(summary.fee)} · ${t('loanMod.upfrontInterest')} ${money(summary.upfrontInterest)}`} />
        <Stat label={t('loanMod.totalRepayable')} value={money(summary.totalRepayable)} sub={`${t('loanMod.interestDue')} ${money(summary.totalInterest)}`} />
        <Stat label={t('loanMod.instalment')} value={money(schedule[0]?.totalDue)} sub={`× ${schedule.length}`} />
        <Stat label={t('loanMod.lastDue')} value={<span style={{ fontSize: 16 }}>{dateIN(schedule[schedule.length - 1]?.dueDate)}</span>} />
      </div>
    </div>
  );
}

/** Raise (or, when `loan` is given, correct and resubmit) a loan request. */
export function LoanRequestForm({ customerId, customerName, loan, onClose, onSaved }: { customerId?: string; customerName?: string; loan?: LoanRow; onClose: () => void; onSaved: (l: { id: string }) => void }) {
  const { t } = useTranslation();
  const [customer, setCustomer] = useState<{ id: string; name: string } | null>(customerId ? { id: customerId, name: customerName ?? '' } : loan ? { id: loan.customerId, name: loan.customer.name } : null);
  const [f, setF] = useState({ productId: loan?.productId ?? '', principal: toRupeesInput(loan?.principal ?? null), purpose: loan?.purpose ?? '', notes: loan?.notes ?? '' });
  const [preview, setPreview] = useState<{ summary: Summary; schedule: ScheduleRow[] } | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const history = useLoad(() => (customer ? get<History>(`/customers/${customer.id}/history`) : Promise.resolve(null)), [customer?.id]);
  useEffect(() => {
    setPreview(null);
    setPreviewError(null);
    if (!f.productId || !Number(f.principal)) return;
    const h = setTimeout(() => {
      post<{ summary: Summary; schedule: ScheduleRow[] }>('/loans/preview', { productId: f.productId, principal: toPaise(f.principal) }).then(setPreview).catch(setPreviewError);
    }, 300);
    return () => clearTimeout(h);
  }, [f.productId, f.principal]);
  return (
    <FormModal
      wide
      title={loan ? `${t('loanMod.resubmit')}: ${loan.number}` : t('loanMod.newRequest')}
      submitLabel={t('common.submit')}
      onClose={onClose}
      onSubmit={async () => {
        if (!customer) throw new Error(t('loanMod.chooseCustomer'));
        const body = { customerId: customer.id, productId: f.productId, principal: toPaise(f.principal), purpose: f.purpose || null, notes: f.notes || null };
        const l = loan ? await put<{ id: string }>(`/loans/${loan.id}`, body) : await post<{ id: string }>('/loans', body);
        onSaved(l);
      }}
    >
      <Field label={t('common.customer')} full>
        {customerId || loan ? <strong>{customer?.name}</strong> : <CustomerSearch value={customer} onChange={setCustomer} />}
      </Field>
      <Field label={t('common.product')}><ProductPicker value={f.productId} onChange={(v) => setF({ ...f, productId: v })} /></Field>
      <Field label={t('loanMod.principal')}><input type="number" min="1" value={f.principal} onChange={(e) => setF({ ...f, principal: e.target.value })} /></Field>
      <Field label={t('loanMod.purpose')}><input value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} /></Field>
      <Field label={t('common.notes')}><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      <div className="full">
        <ErrorBox error={previewError} />
        {preview && <SchedulePreview {...preview} />}
        {history.data && (
          <details>
            <summary>{t('customerMod.history')}: {t(`history.grades.${history.data.summary.grade}`)}</summary>
            <HistoryView h={history.data} />
          </details>
        )}
      </div>
    </FormModal>
  );
}

export default function Loans() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branchId, setBranchId] = useState('');
  const [queue, setQueue] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(() => get<{ total: number; pageSize: number; rows: LoanRow[] }>('/loans', { q: search, status, branchId, queue, page }), [search, status, branchId, queue, page]);
  const [creating, setCreating] = useState(false);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  return (
    <div>
      <div className="page-head">
        <h1>{t('loanMod.title')}</h1>
        {can('loan.request') && <button className="btn primary" onClick={() => setCreating(true)}>{t('loanMod.newRequest')}</button>}
      </div>
      <div className="card no-print">
        <form className="row" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(q); }}>
          <input placeholder={t('loanMod.searchHint')} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
          <button className="btn">{t('common.search')}</button>
          <BranchPicker value={branchId} onChange={(v) => { setBranchId(v); setPage(1); }} allowAll />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {['REQUESTED', 'SENT_BACK', 'APPROVED', 'ACTIVE', 'CLOSED', 'FORECLOSED', 'REJECTED', 'WRITTEN_OFF'].map((s) => <option key={s} value={s}>{t(`loanMod.statuses.${s}`)}</option>)}
          </select>
          <select value={queue} onChange={(e) => { setQueue(e.target.value); setPage(1); }}>
            <option value="">{t('loanMod.allLoans')}</option>
            <option value="mine">{t('mobile.myRequests')}</option>
          </select>
        </form>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <LoanTable rows={data?.rows} onRow={(l) => nav(`/loans/${l.id}`)} />
        <Pager page={page} pages={pages} total={data?.total} onPage={setPage} />
      </div>
      {creating && <LoanRequestForm onClose={() => setCreating(false)} onSaved={(l) => nav(`/loans/${l.id}`)} />}
    </div>
  );
}

function LoanTable({ rows, onRow }: { rows: LoanRow[] | undefined; onRow: (l: LoanRow) => void }) {
  const { t } = useTranslation();
  return (
    <DataTable
      title={t('loanMod.title')}
      rows={rows}
      onRow={onRow}
      columns={[
        { key: 'number', label: t('loanMod.number') },
        { key: 'customer', label: t('common.customer'), value: (l) => `${l.customer.name} (${l.customer.code})` },
        { key: 'productName', label: t('common.product') },
        { key: 'principal', label: t('loanMod.principal'), money: true, total: true },
        { key: 'createdAt', label: t('common.date'), value: (l) => dateIN(l.disbursedOn ?? l.createdAt) },
        { key: 'outstanding', label: t('loanMod.outstanding'), money: true, total: true, value: (l) => l.position?.totalOutstanding ?? null },
        { key: 'overdue', label: t('loanMod.overdue'), money: true, total: true, value: (l) => l.position?.overdue ?? null },
        { key: 'dpd', label: t('loanMod.daysPastDue'), num: true, value: (l) => l.position?.daysPastDue ?? null },
        {
          key: 'status',
          label: t('common.status'),
          value: (l) => t(`loanMod.statuses.${l.status}`),
          render: (l) => (
            <>
              <Badge tone={statusTone(l.status)}>{t(`loanMod.statuses.${l.status}`)}</Badge>
              {l.status === 'REQUESTED' && l.stage === 'ADMIN' && <> <Badge tone="warn">{t('loanMod.atAdmin')}</Badge></>}
            </>
          ),
        },
      ]}
    />
  );
}

export function Approvals() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const { data, error } = useLoad(() => get<{ rows: LoanRow[] }>('/loans', { queue: 'approvals' }), []);
  const approved = useLoad(() => get<{ rows: LoanRow[] }>('/loans', { status: 'APPROVED' }), []);
  return (
    <div>
      <div className="page-head"><h1>{t('nav.approvals')}</h1></div>
      <ErrorBox error={error} />
      <div className="card">
        <h3>{t('loanMod.waitingDecision')}</h3>
        <LoanTable rows={data?.rows} onRow={(l) => nav(`/loans/${l.id}`)} />
      </div>
      <div className="card">
        <h3>{t('loanMod.waitingDisbursal')}</h3>
        <LoanTable rows={approved.data?.rows} onRow={(l) => nav(`/loans/${l.id}`)} />
      </div>
    </div>
  );
}

type Action = 'decide' | 'disburse' | 'foreclose' | 'writeOff' | 'waive' | 'collect' | 'resubmit' | null;

export function LoanDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can, profile } = useAuth();
  const { id } = useParams();
  const { data: l, error, reload } = useLoad(() => get<LoanDetailData>(`/loans/${id}`), [id]);
  const [tab, setTab] = useState<'schedule' | 'collections' | 'ledger' | 'approvals'>('schedule');
  const [action, setAction] = useState<Action>(null);
  const [decision, setDecision] = useState<'APPROVE' | 'REJECT' | 'SEND_BACK'>('APPROVE');
  const [reversing, setReversing] = useState<CollectionRow | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} />;
  if (!l) return <Loading />;
  const p = l.position;
  const done = () => {
    toast(t('common.saved'));
    void reload();
  };
  const isAdmin = profile?.role === 'TENANT_ADMIN';
  const canDecide = l.status === 'REQUESTED' && can('loan.approve') && (isAdmin || (l.stage === 'BRANCH' && l.requestedById !== profile?.id));
  const resend = async (c: CollectionRow) => {
    setActionError(null);
    try {
      await post(`/collections/${c.id}/resend-receipt`);
      toast(t('collection.receiptSent'));
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <div>
          <div className="muted"><Link to="/loans">{t('loanMod.title')}</Link> / <Link to={`/customers/${l.customerId}`}>{l.customer.name} ({l.customer.code})</Link></div>
          <h1>
            {l.number} <Badge tone={statusTone(l.status)}>{t(`loanMod.statuses.${l.status}`)}</Badge>
            {l.status === 'REQUESTED' && l.stage === 'ADMIN' && <> <Badge tone="warn">{t('loanMod.atAdmin')}</Badge></>}
          </h1>
        </div>
        <div className="row no-print">
          {canDecide && (
            <>
              <button className="btn primary" onClick={() => { setDecision('APPROVE'); setAction('decide'); }}>{t('loanMod.approve')}</button>
              <button className="btn" onClick={() => { setDecision('SEND_BACK'); setAction('decide'); }}>{t('loanMod.sendBack')}</button>
              <button className="btn danger" onClick={() => { setDecision('REJECT'); setAction('decide'); }}>{t('loanMod.reject')}</button>
            </>
          )}
          {l.status === 'SENT_BACK' && can('loan.request') && <button className="btn primary" onClick={() => setAction('resubmit')}>{t('loanMod.resubmit')}</button>}
          {l.status === 'APPROVED' && can('loan.disburse') && <button className="btn primary" onClick={() => setAction('disburse')}>{t('loanMod.disburse')}</button>}
          {l.status === 'ACTIVE' && can('collection.record') && <button className="btn primary" onClick={() => setAction('collect')}>{t('collection.record')}</button>}
          {l.status === 'ACTIVE' && can('loan.manage') && (
            <>
              <button className="btn" onClick={() => setAction('foreclose')}>{t('loanMod.foreclose')}</button>
              {(p?.penaltyOutstanding ?? 0) > 0 && <button className="btn" onClick={() => setAction('waive')}>{t('loanMod.waivePenalty')}</button>}
              <button className="btn danger" onClick={() => setAction('writeOff')}>{t('loanMod.writeOff')}</button>
            </>
          )}
        </div>
      </div>
      <ErrorBox error={actionError} />
      {p && (
        <div className="grid k4" style={{ marginBottom: 16 }}>
          <Stat label={t('loanMod.outstanding')} value={money(p.totalOutstanding)} sub={`${t('loanMod.principalDue')} ${money(p.principalOutstanding)} · ${t('loanMod.interestDue')} ${money(p.interestOutstanding)}`} />
          <Stat label={t('loanMod.overdue')} value={money(p.overdue)} sub={`${t('loanMod.daysPastDue')}: ${p.daysPastDue}`} />
          <Stat label={t('collection.dueNow')} value={money(p.dueToday + p.overdue + p.penaltyOutstanding)} sub={`${t('loanMod.penalty')} ${money(p.penaltyOutstanding)}`} />
          <Stat label={t('loanMod.paid')} value={money(l.collections.filter((c) => !c.reversedAt).reduce((s, c) => s + c.amount, 0))} />
        </div>
      )}
      <div className="card">
        <dl className="kv">
          <dt>{t('common.product')}</dt><dd>{l.productName} · {t(`product.frequencies.${l.frequency}`)} × {l.tenure} · {t(`product.methods.${l.interestMethod}`)} {l.interestRate}%</dd>
          <dt>{t('loanMod.principal')}</dt><dd>{money(l.principal)}</dd>
          <dt>{t('loanMod.netDisbursed')}</dt><dd>{money(l.summary.netDisbursed)} ({t('loanMod.fee')} {money(l.summary.fee)}, {t('loanMod.upfrontInterest')} {money(l.summary.upfrontInterest)})</dd>
          <dt>{t('loanMod.totalRepayable')}</dt><dd>{money(l.summary.totalRepayable)}</dd>
          <dt>{t('loanMod.purpose')}</dt><dd>{l.purpose ?? '-'} {l.notes ? `· ${l.notes}` : ''}</dd>
          <dt>{t('loanMod.requestedBy')}</dt><dd>{l.requestedByName} · {dateTime(l.createdAt)}</dd>
          {l.approvedByName && (<><dt>{t('loanMod.approvedBy')}</dt><dd>{l.approvedByName} · {dateTime(l.approvedAt)}</dd></>)}
          {l.disbursedOn && (<><dt>{t('loanMod.disbursedOn')}</dt><dd>{dateIN(l.disbursedOn)} · {l.disburseMode && t(`common.modes.${l.disburseMode}`)} · {l.fundName}</dd></>)}
          {l.closedOn && (<><dt>{t('customerMod.closedOn')}</dt><dd>{dateIN(l.closedOn)}</dd></>)}
          {(l.penaltyWaived > 0 || l.interestWaived > 0) && (<><dt>{t('loanMod.waived')}</dt><dd>{t('loanMod.penalty')} {money(l.penaltyWaived)} · {t('loanMod.interestDue')} {money(l.interestWaived)}</dd></>)}
          {l.writtenOffAmount > 0 && (<><dt>{t('loanMod.writeOff')}</dt><dd>{money(l.writtenOffAmount)}</dd></>)}
        </dl>
      </div>
      <div className="card">
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { key: 'schedule', label: t('loanMod.schedule') },
            { key: 'collections', label: t('collection.title') },
            { key: 'ledger', label: t('customerMod.ledger') },
            { key: 'approvals', label: t('loanMod.approvals') },
          ]}
        />
        {tab === 'schedule' && (
          <DataTable
            title={`${l.number} ${t('loanMod.schedule')}`}
            rows={l.instalments}
            columns={[
              { key: 'seq', label: '#', num: true },
              { key: 'dueDate', label: t('loanMod.dueDate'), value: (i) => dateIN(i.dueDate) },
              { key: 'principalDue', label: t('loanMod.principalDue'), money: true, total: true },
              { key: 'interestDue', label: t('loanMod.interestDue'), money: true, total: true },
              { key: 'paid', label: t('loanMod.paid'), money: true, total: true, value: (i) => i.principalPaid + i.interestPaid },
              { key: 'balance', label: t('loanMod.balance'), money: true, total: true, value: (i) => i.principalDue + i.interestDue - i.principalPaid - i.interestPaid },
              { key: 'paidOn', label: t('loanMod.paidOn'), value: (i) => dateIN(i.paidOn) },
            ]}
          />
        )}
        {tab === 'collections' && (
          <DataTable
            title={`${l.number} ${t('collection.title')}`}
            rows={l.collections}
            columns={[
              { key: 'receiptNo', label: t('collection.receiptNo') },
              { key: 'collectedAt', label: t('common.date'), value: (c) => dateTime(c.collectedAt) },
              { key: 'amount', label: t('common.amount'), money: true, total: true, value: (c) => (c.reversedAt ? 0 : c.amount) },
              { key: 'principal', label: t('loanMod.principalDue'), money: true },
              { key: 'interest', label: t('loanMod.interestDue'), money: true },
              { key: 'penalty', label: t('loanMod.penalty'), money: true },
              { key: 'mode', label: t('common.mode'), value: (c) => `${t(`common.modes.${c.mode}`)}${c.upiRef ? ` ${c.upiRef}` : ''}` },
              { key: 'agentName', label: t('common.agent') },
              {
                key: 'flags',
                label: t('common.status'),
                value: (c) => (c.reversedAt ? t('collection.reversed') : c.flagged ? t('collection.farFromCustomer') : ''),
                render: (c) => (
                  <>
                    {c.reversedAt && <Badge tone="danger" >{t('collection.reversed')}</Badge>}
                    {c.flagged && <Badge tone="warn">{t('collection.farFromCustomer')} {c.distanceM ? `${c.distanceM} m` : ''}</Badge>}
                  </>
                ),
              },
              {
                key: 'actions',
                label: t('common.actions'),
                value: () => '',
                render: (c) =>
                  !c.reversedAt && (
                    <div className="row no-print">
                      {can('collection.reverse') && <button className="btn small" onClick={() => setReversing(c)}>{t('collection.reverse')}</button>}
                      <button className="btn small" onClick={() => void resend(c)}>{t('collection.resend')}</button>
                    </div>
                  ),
              },
            ]}
          />
        )}
        {tab === 'ledger' && (
          <DataTable
            title={`${l.number} ${t('customerMod.ledger')}`}
            rows={l.ledger}
            columns={[
              { key: 'date', label: t('common.date'), value: (r) => dateIN(r.date) },
              { key: 'description', label: t('daybook.particulars') },
              { key: 'debit', label: t('customerMod.debit'), money: true, total: true },
              { key: 'credit', label: t('customerMod.credit'), money: true, total: true },
              { key: 'balance', label: t('loanMod.balance'), money: true },
            ]}
          />
        )}
        {tab === 'approvals' && (
          <DataTable
            rows={l.approvals}
            columns={[
              { key: 'createdAt', label: t('common.date'), value: (a) => dateTime(a.createdAt) },
              { key: 'step', label: t('loanMod.step'), value: (a) => t(`loanMod.steps.${a.step}`) },
              { key: 'userName', label: t('audit.actor') },
              { key: 'decision', label: t('audit.action'), value: (a) => t(`loanMod.decisions.${a.decision}`) },
              { key: 'reason', label: t('common.reason') },
            ]}
          />
        )}
      </div>
      {action === 'decide' && <DecisionForm loan={l} decision={decision} onClose={() => setAction(null)} onSaved={(escalated) => { if (escalated) toast(t('loanMod.overLimit')); else done(); void reload(); }} />}
      {action === 'resubmit' && <LoanRequestForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'disburse' && <DisburseForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'collect' && <CollectForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'foreclose' && <ForecloseForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'waive' && <WaiveForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'writeOff' && <WriteOffForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {reversing && <ReverseForm collection={reversing} onClose={() => setReversing(null)} onSaved={done} />}
    </div>
  );
}

function DecisionForm({ loan, decision, onClose, onSaved }: { loan: LoanDetailData; decision: 'APPROVE' | 'REJECT' | 'SEND_BACK'; onClose: () => void; onSaved: (escalated: boolean) => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const history = useLoad(() => get<History>(`/customers/${loan.customerId}/history`), [loan.customerId]);
  const label = { APPROVE: t('loanMod.approve'), REJECT: t('loanMod.reject'), SEND_BACK: t('loanMod.sendBack') }[decision];
  const overLimit = decision === 'APPROVE' && profile?.role !== 'TENANT_ADMIN' && loan.principal > (profile?.approvalLimit ?? 0);
  return (
    <FormModal
      wide
      title={`${label}: ${loan.number}`}
      submitLabel={label}
      onClose={onClose}
      onSubmit={async () => {
        const r = await post<{ escalated: boolean }>(`/loans/${loan.id}/decision`, { decision, reason: reason || undefined });
        onSaved(r.escalated);
      }}
    >
      {overLimit && <div className="full error-box">{t('loanMod.overLimit')}</div>}
      <Field label={t('common.reason')} full><textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      <div className="full">{history.data ? <HistoryView h={history.data} /> : <Loading />}</div>
    </FormModal>
  );
}

function DisburseForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ disbursedOn: today(), firstDueDate: '', mode: 'CASH', fundId: '', reference: '' });
  const [preview, setPreview] = useState<{ summary: Summary; schedule: ScheduleRow[] } | null>(null);
  useEffect(() => {
    post<{ summary: Summary; schedule: ScheduleRow[] }>('/loans/preview', { productId: loan.productId, principal: loan.principal, disbursedOn: f.disbursedOn }).then(setPreview).catch(() => setPreview(null));
  }, [loan.productId, loan.principal, f.disbursedOn]);
  return (
    <FormModal
      wide
      title={`${t('loanMod.disburse')}: ${loan.number}`}
      submitLabel={t('loanMod.disburse')}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/disburse`, { ...f, firstDueDate: f.firstDueDate || undefined, reference: f.reference || null });
        onSaved();
      }}
    >
      <Field label={t('loanMod.disbursedOn')}><input type="date" max={today()} value={f.disbursedOn} onChange={(e) => setF({ ...f, disbursedOn: e.target.value })} /></Field>
      <Field label={t('loanMod.firstDueDate')}><input type="date" value={f.firstDueDate} placeholder={preview?.schedule[0]?.dueDate} onChange={(e) => setF({ ...f, firstDueDate: e.target.value })} /></Field>
      <Field label={t('loanMod.fund')}><FundPicker branchId={loan.branchId} value={f.fundId} onChange={(v) => setF({ ...f, fundId: v })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('loanMod.reference')}><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      <div className="full">{preview && <SchedulePreview {...preview} />}</div>
    </FormModal>
  );
}

function CollectForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const p = loan.position!;
  const next = loan.instalments.find((i) => i.principalPaid + i.interestPaid < i.principalDue + i.interestDue);
  const suggested = p.overdue + p.dueToday + p.penaltyOutstanding || (next ? next.principalDue + next.interestDue - next.principalPaid - next.interestPaid : 0);
  const [f, setF] = useState({ amount: toRupeesInput(suggested), mode: 'CASH', upiRef: '', note: '' });
  const [ref] = useState(() => `web-${crypto.randomUUID()}`);
  return (
    <FormModal
      title={`${t('collection.record')}: ${loan.number}`}
      onClose={onClose}
      onSubmit={async () => {
        await post('/collections', { loanId: loan.id, amount: toPaise(f.amount), mode: f.mode, upiRef: f.upiRef || null, note: f.note || null, clientRef: ref });
        onSaved();
      }}
    >
      <Field label={t('collection.amountCollected')}><input type="number" min="1" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      {f.mode !== 'CASH' && <Field label={t('collection.upiRef')}><input value={f.upiRef} onChange={(e) => setF({ ...f, upiRef: e.target.value })} /></Field>}
      <Field label={t('common.notes')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {f.mode === 'UPI' && <div className="full muted">{t('collection.upiNote')}</div>}
      <div className="full muted">{t('loanMod.outstanding')}: {money(p.totalOutstanding)}</div>
    </FormModal>
  );
}

function ForecloseForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const p = loan.position!;
  // Interest not yet due is the default waiver on early closure.
  const futureInterest = loan.instalments.filter((i) => i.dueDate > today()).reduce((s, i) => s + i.interestDue - i.interestPaid, 0);
  const [f, setF] = useState({ date: today(), mode: 'CASH', interestWaived: toRupeesInput(futureInterest), reason: '' });
  const payable = p.totalOutstanding - toPaise(f.interestWaived);
  return (
    <FormModal
      title={`${t('loanMod.foreclose')}: ${loan.number}`}
      submitLabel={t('loanMod.foreclose')}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/foreclose`, { date: f.date, mode: f.mode, amount: payable, interestWaived: toPaise(f.interestWaived), reason: f.reason || null });
        onSaved();
      }}
    >
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('loanMod.interestWaived')}><input type="number" min="0" step="0.01" value={f.interestWaived} onChange={(e) => setF({ ...f, interestWaived: e.target.value })} /></Field>
      <Field label={t('common.reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="full ok-box">{t('loanMod.amountToCollect')}: <strong>{money(payable)}</strong> ({t('loanMod.outstanding')} {money(p.totalOutstanding)})</div>
    </FormModal>
  );
}

function WaiveForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ amount: toRupeesInput(loan.position?.penaltyOutstanding ?? 0), reason: '' });
  return (
    <FormModal
      title={`${t('loanMod.waivePenalty')}: ${loan.number}`}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/waive-penalty`, { amount: toPaise(f.amount), reason: f.reason });
        onSaved();
      }}
    >
      <Field label={t('common.amount')}><input type="number" min="0" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </FormModal>
  );
}

function WriteOffForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ date: today(), reason: '' });
  return (
    <FormModal
      title={`${t('loanMod.writeOff')}: ${loan.number}`}
      submitLabel={t('loanMod.writeOff')}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/write-off`, f);
        onSaved();
      }}
    >
      <div className="full error-box">{t('loanMod.writeOffWarning', { amount: money(loan.position?.principalOutstanding) })}</div>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </FormModal>
  );
}

export function ReverseForm({ collection, onClose, onSaved }: { collection: { id: string; receiptNo: string; amount: number }; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  return (
    <FormModal
      title={`${t('collection.reverse')}: ${collection.receiptNo} (${money(collection.amount)})`}
      submitLabel={t('collection.reverse')}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/collections/${collection.id}/reverse`, { reason });
        onSaved();
      }}
    >
      <Field label={t('common.reason')} full><input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}

