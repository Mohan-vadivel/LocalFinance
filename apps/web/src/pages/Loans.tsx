import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, Banknote, Check, CornerUpLeft, Eye, Printer, Send, Undo2 } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BranchPicker, FundPicker, ModeSelect, ProductPicker, useFunds } from '../components/pickers';
import { Badge, ConfirmFormModal, ConfirmPanel, DataTable, DocHead, ErrorBox, Field, FormModal, Loading, Modal, PrintDoc, Stat, Tabs, printDoc, statusTone, useToast, RowActions, type Column, type ConfirmRow, type RowAction } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, money, toPaise, toRupeesInput, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { HistoryView, Pager, gradeTone, type History } from './Customers';

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
  legacyNo: string | null;
  migrated: boolean;
  openingPaid: number;
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

function LoanTable({ rows, onRow, actions, extra }: { rows: LoanRow[] | undefined; onRow: (l: LoanRow) => void; actions?: (l: LoanRow) => RowAction[]; extra?: Column<LoanRow>[] }) {
  const { t } = useTranslation();
  return (
    <DataTable
      title={t('loanMod.title')}
      rows={rows}
      onRow={onRow}
      actions={(l) => [{ icon: Eye, label: t('common.view'), onClick: () => onRow(l) }, ...(actions?.(l) ?? [])]}
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
        ...(extra ?? []),
      ]}
    />
  );
}

type Decision = 'APPROVE' | 'REJECT' | 'SEND_BACK';

/** Same rule as the API: managers decide branch-stage requests they did not raise; the Tenant Admin decides all. */
function canDecideLoan(l: LoanRow, auth: ReturnType<typeof useAuth>) {
  const isAdmin = auth.profile?.role === 'TENANT_ADMIN';
  return l.status === 'REQUESTED' && auth.can('loan.approve') && (isAdmin || (l.stage === 'BRANCH' && l.requestedById !== auth.profile?.id));
}

/** The customer's advisory risk grade, from their repayment history. */
function GradeCell({ customerId }: { customerId: string }) {
  const { t } = useTranslation();
  const { data } = useLoad(() => get<History>(`/customers/${customerId}/history`), [customerId]);
  if (!data) return <span className="muted">-</span>;
  return <Badge tone={gradeTone(data.summary.grade)}>{t(`history.grades.${data.summary.grade}`)}</Badge>;
}

export function Approvals() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const auth = useAuth();
  const waiting = useLoad(() => get<{ rows: LoanRow[] }>('/loans', { queue: 'approvals' }), []);
  const approved = useLoad(() => get<{ rows: LoanRow[] }>('/loans', { status: 'APPROVED' }), []);
  const [deciding, setDeciding] = useState<{ loan: LoanRow; decision: Decision } | null>(null);
  const [disbursing, setDisbursing] = useState<LoanRow | null>(null);
  const refresh = () => {
    void waiting.reload();
    void approved.reload();
  };
  return (
    <div>
      <div className="page-head"><h1>{t('nav.approvals')}</h1></div>
      <ErrorBox error={waiting.error ?? approved.error} />
      <div className="card">
        <h3>{t('loanMod.waitingDecision')}</h3>
        <LoanTable
          rows={waiting.data?.rows}
          onRow={(l) => nav(`/loans/${l.id}`)}
          extra={[{ key: 'grade', label: t('customerMod.riskGrade'), value: () => '', render: (l) => <GradeCell customerId={l.customerId} /> }]}
          actions={(l) => {
            const hidden = !canDecideLoan(l, auth);
            return [
              { icon: Check, label: t('loanMod.approve'), tone: 'primary', hidden, onClick: () => setDeciding({ loan: l, decision: 'APPROVE' }) },
              { icon: CornerUpLeft, label: t('loanMod.sendBack'), hidden, onClick: () => setDeciding({ loan: l, decision: 'SEND_BACK' }) },
              { icon: Ban, label: t('loanMod.reject'), tone: 'danger', hidden, onClick: () => setDeciding({ loan: l, decision: 'REJECT' }) },
            ];
          }}
        />
      </div>
      <div className="card">
        <h3>{t('loanMod.waitingDisbursal')}</h3>
        <LoanTable
          rows={approved.data?.rows}
          onRow={(l) => nav(`/loans/${l.id}`)}
          actions={(l) => [{ icon: Banknote, label: t('loanMod.disburse'), tone: 'primary', hidden: !auth.can('loan.disburse'), onClick: () => setDisbursing(l) }]}
        />
      </div>
      {deciding && (
        <DecisionForm
          compact
          loan={deciding.loan}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onSaved={(escalated) => {
            toast(escalated ? t('loanMod.overLimit') : t('common.saved'));
            refresh();
          }}
        />
      )}
      {disbursing && <DisburseFlow loan={disbursing} onClose={() => setDisbursing(null)} onDone={refresh} />}
    </div>
  );
}

type Action = 'decide' | 'disburse' | 'foreclose' | 'writeOff' | 'waive' | 'collect' | 'resubmit' | null;

export function LoanDetail() {
  const { t } = useTranslation();
  const toast = useToast();
  const auth = useAuth();
  const { can, profile } = auth;
  const { id } = useParams();
  const { data: l, error, reload } = useLoad(() => get<LoanDetailData>(`/loans/${id}`), [id]);
  const [tab, setTab] = useState<'schedule' | 'collections' | 'ledger' | 'approvals'>('schedule');
  const [action, setAction] = useState<Action>(null);
  const [decision, setDecision] = useState<Decision>('APPROVE');
  const [reversing, setReversing] = useState<CollectionRow | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  if (error) return <ErrorBox error={error} />;
  if (!l) return <Loading />;
  const p = l.position;
  const done = () => {
    toast(t('common.saved'));
    void reload();
  };
  const canDecide = canDecideLoan(l, auth);
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
            {l.migrated && <> <Badge>{t('import.migrated')}{l.legacyNo ? ` · ${t('import.oldAccount')} ${l.legacyNo}` : ''}</Badge></>}
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
          {l.instalments.length > 0 && (
            <button className="btn" onClick={() => printDoc('card')}>
              <Printer aria-hidden />
              {t('print.printCard')}
            </button>
          )}
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
          <Stat label={t('loanMod.paid')} value={money(l.openingPaid + l.collections.filter((c) => !c.reversedAt).reduce((s, c) => s + c.amount, 0))} sub={l.openingPaid ? `${t('import.receivedBefore')} ${money(l.openingPaid)}` : undefined} />
        </div>
      )}
      <div className="card">
        <dl className="kv">
          <dt>{t('common.product')}</dt><dd>{l.productName} · {t(`product.frequencies.${l.frequency}`)} × {l.tenure} · {t(`product.methods.${l.interestMethod}`)} {l.interestRate}%</dd>
          <dt>{t('loanMod.principal')}</dt><dd>{money(l.principal)}</dd>
          {!l.migrated && (<><dt>{t('loanMod.netDisbursed')}</dt><dd>{money(l.summary.netDisbursed)} ({t('loanMod.fee')} {money(l.summary.fee)}, {t('loanMod.upfrontInterest')} {money(l.summary.upfrontInterest)})</dd></>)}
          <dt>{t('loanMod.totalRepayable')}</dt><dd>{money(l.summary.totalRepayable)}</dd>
          <dt>{t('loanMod.purpose')}</dt><dd>{l.purpose ?? '-'} {l.notes ? `· ${l.notes}` : ''}</dd>
          <dt>{t('loanMod.requestedBy')}</dt><dd>{l.requestedByName} · {dateTime(l.createdAt)}</dd>
          {l.approvedByName && (<><dt>{t('loanMod.approvedBy')}</dt><dd>{l.approvedByName} · {dateTime(l.approvedAt)}</dd></>)}
          {l.disbursedOn && (<><dt>{t('loanMod.disbursedOn')}</dt><dd>{[dateIN(l.disbursedOn), l.disburseMode && t(`common.modes.${l.disburseMode}`), l.fundName].filter(Boolean).join(' · ')}</dd></>)}
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
                    <RowActions
                      actions={[
                        { icon: Send, label: t('collection.resend'), onClick: () => void resend(c) },
                        { icon: Undo2, label: t('collection.reverse'), tone: 'danger', onClick: () => setReversing(c), hidden: !can('collection.reverse') },
                      ]}
                    />
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
      {l.instalments.length > 0 && <PrintDoc id="card"><RepaymentCardDoc loan={l} business={profile?.tenant?.name ?? t('common.appName')} /></PrintDoc>}
      {action === 'decide' && <DecisionForm loan={l} decision={decision} onClose={() => setAction(null)} onSaved={(escalated) => { if (escalated) toast(t('loanMod.overLimit')); else done(); void reload(); }} />}
      {action === 'resubmit' && <LoanRequestForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'disburse' && <DisburseFlow loan={l} onClose={() => setAction(null)} onDone={done} />}
      {action === 'collect' && <CollectFlow loanId={l.id} loan={l} onClose={() => setAction(null)} onDone={done} />}
      {action === 'foreclose' && (
        <ForecloseForm
          loan={l}
          onClose={() => setAction(null)}
          onSaved={(r) => {
            done();
            setReceipt({ title: t('receipt.title'), rows: collectionRows(t, l, r.collection, profile?.name, r.loan.position?.totalOutstanding ?? 0), collectionId: r.collection.id });
          }}
        />
      )}
      {action === 'waive' && <WaiveForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {action === 'writeOff' && <WriteOffForm loan={l} onClose={() => setAction(null)} onSaved={done} />}
      {reversing && <ReverseForm collection={reversing} onClose={() => setReversing(null)} onSaved={done} />}
      {receipt && <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />}
    </div>
  );
}

function DecisionForm({ loan, decision, compact, onClose, onSaved }: { loan: LoanRow; decision: Decision; compact?: boolean; onClose: () => void; onSaved: (escalated: boolean) => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [reason, setReason] = useState('');
  const history = useLoad(() => (compact ? Promise.resolve(null) : get<History>(`/customers/${loan.customerId}/history`)), [loan.customerId, compact]);
  const label = { APPROVE: t('loanMod.approve'), REJECT: t('loanMod.reject'), SEND_BACK: t('loanMod.sendBack') }[decision];
  const overLimit = decision === 'APPROVE' && profile?.role !== 'TENANT_ADMIN' && loan.principal > (profile?.approvalLimit ?? 0);
  // Rejecting or sending back must tell the requester why.
  const needsReason = decision !== 'APPROVE';
  return (
    <FormModal
      wide={!compact}
      title={`${label}: ${loan.number}`}
      submitLabel={label}
      onClose={onClose}
      onSubmit={async () => {
        if (needsReason) checkReason(t, reason);
        const r = await post<{ escalated: boolean }>(`/loans/${loan.id}/decision`, { decision, reason: reason.trim() || undefined });
        onSaved(r.escalated);
      }}
    >
      {compact && <div className="full muted">{loan.customer.name} ({loan.customer.code}) · {t('loanMod.principal')} <strong>{money(loan.principal)}</strong></div>}
      {overLimit && <div className="full error-box">{t('loanMod.overLimit')}</div>}
      <Field label={needsReason ? t('confirm.reasonRequired') : t('common.reason')} full><textarea rows={2} required={needsReason} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      {!compact && <div className="full">{history.data ? <HistoryView h={history.data} /> : <Loading />}</div>}
    </FormModal>
  );
}

type T = ReturnType<typeof useTranslation>['t'];
/** Write-off, reversal, waiver and refusals carry a reason; the API asks for at least 3 letters. */
function checkReason(t: T, reason: string) {
  if (reason.trim().length < 3) throw new Error(t('confirm.reasonNeeded'));
}
const customerOf = (l: LoanRow) => `${l.customer.name} (${l.customer.code})`;

interface Receipt { title: string; rows: ConfirmRow[]; collectionId?: string; loan?: LoanDetailData }
interface SavedCollection { id: string; receiptNo: string; amount: number; mode: string; upiRef: string | null; collectedAt: string }

/** What a collection receipt shows, on screen and on paper. */
function collectionRows(t: T, loan: LoanRow, c: SavedCollection, collectedBy: string | undefined, outstanding: number | null): ConfirmRow[] {
  return [
    { label: t('collection.receiptNo'), value: c.receiptNo, strong: true },
    { label: t('common.date'), value: dateTime(c.collectedAt) },
    { label: t('common.customer'), value: customerOf(loan) },
    { label: t('loanMod.number'), value: loan.number },
    { label: t('collection.amountCollected'), value: money(c.amount), strong: true },
    { label: t('common.mode'), value: `${t(`common.modes.${c.mode}`)}${c.upiRef ? ` ${c.upiRef}` : ''}` },
    { label: t('print.collectedBy'), value: collectedBy },
    { label: t('print.outstandingAfter'), value: outstanding == null ? null : money(outstanding), strong: true },
  ];
}

/** After money moves: what was saved, with print and (for collections) an SMS receipt to the customer. */
function ReceiptModal({ receipt, onClose }: { receipt: Receipt; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const business = profile?.tenant?.name ?? t('common.appName');
  const sms = async () => {
    setBusy(true);
    setError(null);
    try {
      await post(`/collections/${receipt.collectionId}/resend-receipt`);
      toast(t('print.smsSent'));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={receipt.title}
      onClose={onClose}
      actions={
        <>
          <button className="btn" onClick={onClose}>{t('common.close')}</button>
          {receipt.collectionId && (
            <button className="btn" onClick={() => void sms()} disabled={busy}>
              <Send aria-hidden />
              {t('print.sendSms')}
            </button>
          )}
          {receipt.loan && (
            <button className="btn" onClick={() => printDoc('result-card')}>
              <Printer aria-hidden />
              {t('print.printCard')}
            </button>
          )}
          <button className="btn primary" onClick={() => printDoc('receipt')} autoFocus>
            <Printer aria-hidden />
            {t('print.receipt')}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <div className="ok-box" style={{ marginBottom: 12 }}>{t('common.saved')}</div>
      <ConfirmPanel rows={receipt.rows} />
      <PrintDoc id="receipt">
        <div className="receipt-doc">
          <DocHead business={business} title={receipt.title} />
          <ConfirmPanel rows={receipt.rows} />
          {profile?.tenant?.settings.receiptFooter && <p className="doc-foot">{profile.tenant.settings.receiptFooter}</p>}
          <div className="doc-sign">{t('print.signature')}</div>
          <p className="doc-foot">{t('receipt.thanks')}</p>
        </div>
      </PrintDoc>
      {receipt.loan && <PrintDoc id="result-card"><RepaymentCardDoc loan={receipt.loan} business={business} /></PrintDoc>}
    </Modal>
  );
}

/** Printable repayment card: loan terms and every instalment, with a column for the collector's signature. */
function RepaymentCardDoc({ loan: l, business }: { loan: LoanDetailData; business: string }) {
  const { t } = useTranslation();
  const due = (i: Instalment) => i.principalDue + i.interestDue;
  const paid = (i: Instalment) => i.principalPaid + i.interestPaid;
  const sum = (f: (i: Instalment) => number) => l.instalments.reduce((s, i) => s + f(i), 0);
  return (
    <div>
      <DocHead business={business} title={t('print.repaymentCard')} />
      <ConfirmPanel
        rows={[
          { label: t('common.customer'), value: customerOf(l), strong: true },
          { label: t('common.phone'), value: l.customer.phone },
          { label: t('common.address'), value: l.customer.address },
          { label: t('loanMod.number'), value: l.number, strong: true },
          { label: t('common.product'), value: `${l.productName ?? ''} · ${t(`product.frequencies.${l.frequency}`)} × ${l.tenure}` },
          { label: t('loanMod.principal'), value: money(l.principal) },
          { label: t('loanMod.disbursedOn'), value: dateIN(l.disbursedOn) },
          { label: t('loanMod.totalRepayable'), value: money(sum(due)) },
        ]}
      />
      <table className="doc-table">
        <thead>
          <tr>
            <th>#</th>
            <th>{t('loanMod.dueDate')}</th>
            <th className="num">{t('loanMod.instalment')}</th>
            <th className="num">{t('loanMod.paid')}</th>
            <th className="num">{t('loanMod.balance')}</th>
            <th>{t('loanMod.paidOn')}</th>
            <th>{t('print.sign')}</th>
          </tr>
        </thead>
        <tbody>
          {l.instalments.map((i) => (
            <tr key={i.id}>
              <td>{i.seq}</td>
              <td>{dateIN(i.dueDate)}</td>
              <td className="num">{money(due(i))}</td>
              <td className="num">{paid(i) ? money(paid(i)) : ''}</td>
              <td className="num">{money(due(i) - paid(i))}</td>
              <td>{i.paidOn ? dateIN(i.paidOn) : ''}</td>
              <td className="sign-cell" />
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2}>{t('common.total')}</td>
            <td className="num">{money(sum(due))}</td>
            <td className="num">{money(sum(paid))}</td>
            <td className="num">{money(sum(due) - sum(paid))}</td>
            <td colSpan={2} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function DisburseForm({ loan, onClose, onSaved }: { loan: LoanRow; onClose: () => void; onSaved: (l: LoanDetailData) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ disbursedOn: today(), firstDueDate: '', mode: 'CASH', fundId: '', reference: '' });
  const [preview, setPreview] = useState<{ summary: Summary; schedule: ScheduleRow[] } | null>(null);
  const funds = useFunds(loan.branchId);
  useEffect(() => {
    post<{ summary: Summary; schedule: ScheduleRow[] }>('/loans/preview', { productId: loan.productId, principal: loan.principal, disbursedOn: f.disbursedOn }).then(setPreview).catch(() => setPreview(null));
  }, [loan.productId, loan.principal, f.disbursedOn]);
  return (
    <ConfirmFormModal
      wide
      title={`${t('loanMod.disburse')}: ${loan.number}`}
      submitLabel={t('loanMod.disburse')}
      onClose={onClose}
      validate={() => {
        if (!f.disbursedOn) throw new Error(`${t('loanMod.disbursedOn')}: ${t('common.required')}`);
        if (!f.fundId) throw new Error(`${t('loanMod.fund')}: ${t('common.required')}`);
      }}
      review={() => [
        { label: t('common.customer'), value: customerOf(loan) },
        { label: t('loanMod.number'), value: loan.number },
        { label: t('loanMod.principal'), value: money(loan.principal) },
        { label: t('loanMod.netDisbursed'), value: preview ? money(preview.summary.netDisbursed) : null, strong: true },
        { label: t('common.mode'), value: t(`common.modes.${f.mode}`) },
        { label: t('loanMod.fund'), value: funds?.find((x) => x.id === f.fundId)?.name },
        { label: t('loanMod.disbursedOn'), value: dateIN(f.disbursedOn) },
        { label: t('loanMod.firstDueDate'), value: f.firstDueDate ? dateIN(f.firstDueDate) : null },
        { label: t('loanMod.reference'), value: f.reference },
      ]}
      onSubmit={async () => {
        const l = await post<LoanDetailData>(`/loans/${loan.id}/disburse`, { ...f, firstDueDate: f.firstDueDate || undefined, reference: f.reference || null });
        onSaved(l);
      }}
    >
      <Field label={t('loanMod.disbursedOn')}><input type="date" max={today()} required value={f.disbursedOn} onChange={(e) => setF({ ...f, disbursedOn: e.target.value })} /></Field>
      <Field label={t('loanMod.firstDueDate')}><input type="date" value={f.firstDueDate} placeholder={preview?.schedule[0]?.dueDate} onChange={(e) => setF({ ...f, firstDueDate: e.target.value })} /></Field>
      <Field label={t('loanMod.fund')}><FundPicker branchId={loan.branchId} value={f.fundId} onChange={(v) => setF({ ...f, fundId: v })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('loanMod.reference')}><input value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      <div className="full">{preview && <SchedulePreview {...preview} />}</div>
    </ConfirmFormModal>
  );
}

/** Disburse an approved loan, then show the disbursal slip and repayment card. */
export function DisburseFlow({ loan, onClose, onDone }: { loan: LoanRow; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [result, setResult] = useState<LoanDetailData | null>(null);
  // The form closes itself after saving; the flow stays open to show the result.
  const saved = useRef(false);
  if (result) {
    const l = result;
    const first = l.instalments[0];
    const rows: ConfirmRow[] = [
      { label: t('common.customer'), value: customerOf(l) },
      { label: t('loanMod.number'), value: l.number, strong: true },
      { label: t('loanMod.disbursedOn'), value: dateIN(l.disbursedOn) },
      { label: t('loanMod.principal'), value: money(l.principal) },
      { label: t('loanMod.fee'), value: money(l.summary.fee) },
      { label: t('loanMod.upfrontInterest'), value: money(l.summary.upfrontInterest) },
      { label: t('loanMod.netDisbursed'), value: money(l.summary.netDisbursed), strong: true },
      { label: t('common.mode'), value: l.disburseMode ? t(`common.modes.${l.disburseMode}`) : null },
      { label: t('loanMod.fund'), value: l.fundName },
      { label: t('loanMod.firstDueDate'), value: first ? dateIN(first.dueDate) : null },
      { label: t('loanMod.instalment'), value: first ? `${money(first.principalDue + first.interestDue)} × ${l.instalments.length}` : null },
      { label: t('print.disbursedBy'), value: profile?.name },
      { label: t('print.outstandingAfter'), value: money(l.position?.totalOutstanding ?? l.summary.totalRepayable), strong: true },
    ];
    return <ReceiptModal receipt={{ title: t('print.disbursalSlip'), rows, loan: l }} onClose={onClose} />;
  }
  return (
    <DisburseForm
      loan={loan}
      onClose={() => !saved.current && onClose()}
      onSaved={(l) => {
        saved.current = true;
        setResult(l);
        onDone();
      }}
    />
  );
}

function CollectForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: (c: SavedCollection, outstanding: number | null) => void }) {
  const { t } = useTranslation();
  const p = loan.position!;
  const next = loan.instalments.find((i) => i.principalPaid + i.interestPaid < i.principalDue + i.interestDue);
  const suggested = p.overdue + p.dueToday + p.penaltyOutstanding || (next ? next.principalDue + next.interestDue - next.principalPaid - next.interestPaid : 0);
  const [f, setF] = useState({ amount: toRupeesInput(suggested), mode: 'CASH', upiRef: '', note: '' });
  const [ref] = useState(() => `web-${crypto.randomUUID()}`);
  const amount = toPaise(f.amount);
  return (
    <ConfirmFormModal
      title={`${t('collection.record')}: ${loan.number}`}
      submitLabel={t('collection.record')}
      onClose={onClose}
      validate={() => {
        if (!(amount > 0)) throw new Error(`${t('collection.amountCollected')}: ${t('common.required')}`);
        if (amount > p.totalOutstanding) throw new Error(t('collection.tooMuch'));
      }}
      review={() => [
        { label: t('common.customer'), value: customerOf(loan) },
        { label: t('loanMod.number'), value: loan.number },
        { label: t('collection.amountCollected'), value: money(amount), strong: true },
        { label: t('common.mode'), value: `${t(`common.modes.${f.mode}`)}${f.upiRef ? ` ${f.upiRef}` : ''}` },
        { label: t('loanMod.fund'), value: loan.fundName },
        { label: t('common.date'), value: dateIN(today()) },
        { label: t('print.outstandingAfter'), value: money(p.totalOutstanding - amount) },
        { label: t('common.notes'), value: f.note },
      ]}
      onSubmit={async () => {
        const r = await post<{ collection: SavedCollection }>('/collections', { loanId: loan.id, amount, mode: f.mode, upiRef: f.upiRef || null, note: f.note || null, clientRef: ref });
        // The receipt shows the balance as the server now sees it (penalty included).
        const fresh = await get<LoanDetailData>(`/loans/${loan.id}`).catch(() => null);
        onSaved(r.collection, fresh ? fresh.position?.totalOutstanding ?? 0 : null);
      }}
    >
      <Field label={t('collection.amountCollected')}><input type="number" min="1" step="0.01" required value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      {f.mode !== 'CASH' && <Field label={t('collection.upiRef')}><input value={f.upiRef} onChange={(e) => setF({ ...f, upiRef: e.target.value })} /></Field>}
      <Field label={t('common.notes')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {f.mode === 'UPI' && <div className="full muted">{t('collection.upiNote')}</div>}
      <div className="full muted">{t('loanMod.outstanding')}: {money(p.totalOutstanding)}</div>
    </ConfirmFormModal>
  );
}

/** Record a collection on one loan, then show its receipt. Loads the loan when only its id is known. */
export function CollectFlow({ loanId, loan: given, onClose, onDone }: { loanId: string; loan?: LoanDetailData; onClose: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const loaded = useLoad(() => (given ? Promise.resolve(given) : get<LoanDetailData>(`/loans/${loanId}`)), [loanId]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const saved = useRef(false);
  const loan = given ?? loaded.data;
  if (receipt) return <ReceiptModal receipt={receipt} onClose={onClose} />;
  if (!loan || !loan.position) {
    return (
      <Modal title={t('collection.record')} onClose={onClose}>
        {loaded.error ? <ErrorBox error={loaded.error} /> : loan ? <div className="muted">{t(`loanMod.statuses.${loan.status}`)}</div> : <Loading />}
      </Modal>
    );
  }
  return (
    <CollectForm
      loan={loan}
      onClose={() => !saved.current && onClose()}
      onSaved={(c, outstanding) => {
        saved.current = true;
        setReceipt({ title: t('receipt.title'), rows: collectionRows(t, loan, c, profile?.name, outstanding), collectionId: c.id });
        onDone();
      }}
    />
  );
}

function ForecloseForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: (r: { collection: SavedCollection; loan: LoanDetailData }) => void }) {
  const { t } = useTranslation();
  const p = loan.position!;
  // Interest not yet due is the default waiver on early closure.
  const futureInterest = loan.instalments.filter((i) => i.dueDate > today()).reduce((s, i) => s + i.interestDue - i.interestPaid, 0);
  const [f, setF] = useState({ date: today(), mode: 'CASH', interestWaived: toRupeesInput(futureInterest), reason: '' });
  const payable = p.totalOutstanding - toPaise(f.interestWaived);
  return (
    <ConfirmFormModal
      title={`${t('loanMod.foreclose')}: ${loan.number}`}
      submitLabel={t('loanMod.foreclose')}
      onClose={onClose}
      validate={() => {
        if (!(payable > 0)) throw new Error(`${t('loanMod.amountToCollect')}: ${t('common.required')}`);
      }}
      review={() => [
        { label: t('common.customer'), value: customerOf(loan) },
        { label: t('loanMod.number'), value: loan.number },
        { label: t('loanMod.amountToCollect'), value: money(payable), strong: true },
        { label: t('loanMod.interestWaived'), value: money(toPaise(f.interestWaived)) },
        { label: t('common.mode'), value: t(`common.modes.${f.mode}`) },
        { label: t('loanMod.fund'), value: loan.fundName },
        { label: t('common.date'), value: dateIN(f.date) },
        { label: t('common.reason'), value: f.reason },
      ]}
      onSubmit={async () => {
        const r = await post<{ collection: SavedCollection; loan: LoanDetailData }>(`/loans/${loan.id}/foreclose`, { date: f.date, mode: f.mode, amount: payable, interestWaived: toPaise(f.interestWaived), reason: f.reason || null });
        onSaved(r);
      }}
    >
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('loanMod.interestWaived')}><input type="number" min="0" step="0.01" value={f.interestWaived} onChange={(e) => setF({ ...f, interestWaived: e.target.value })} /></Field>
      <Field label={t('common.reason')}><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
      <div className="full ok-box">{t('loanMod.amountToCollect')}: <strong>{money(payable)}</strong> ({t('loanMod.outstanding')} {money(p.totalOutstanding)})</div>
    </ConfirmFormModal>
  );
}

function WaiveForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const outstanding = loan.position?.penaltyOutstanding ?? 0;
  const [f, setF] = useState({ amount: toRupeesInput(outstanding), reason: '' });
  const amount = toPaise(f.amount);
  return (
    <ConfirmFormModal
      title={`${t('loanMod.waivePenalty')}: ${loan.number}`}
      submitLabel={t('loanMod.waivePenalty')}
      onClose={onClose}
      validate={() => {
        if (!(amount > 0) || amount > outstanding) throw new Error(`${t('common.amount')}: ${money(outstanding)}`);
        checkReason(t, f.reason);
      }}
      review={() => [
        { label: t('common.customer'), value: customerOf(loan) },
        { label: t('loanMod.number'), value: loan.number },
        { label: t('loanMod.waivePenalty'), value: money(amount), strong: true },
        { label: t('common.date'), value: dateIN(today()) },
        { label: t('common.reason'), value: f.reason },
      ]}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/waive-penalty`, { amount, reason: f.reason.trim() });
        onSaved();
      }}
    >
      <Field label={t('common.amount')}><input type="number" min="0" max={outstanding / 100} step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('confirm.reasonRequired')}><input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </ConfirmFormModal>
  );
}

function WriteOffForm({ loan, onClose, onSaved }: { loan: LoanDetailData; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ date: today(), reason: '' });
  return (
    <ConfirmFormModal
      danger
      title={`${t('loanMod.writeOff')}: ${loan.number}`}
      submitLabel={t('loanMod.writeOff')}
      onClose={onClose}
      validate={() => checkReason(t, f.reason)}
      review={() => [
        { label: t('common.customer'), value: customerOf(loan) },
        { label: t('loanMod.number'), value: loan.number },
        { label: t('loanMod.writeOff'), value: money(loan.position?.principalOutstanding), strong: true },
        { label: t('common.date'), value: dateIN(f.date) },
        { label: t('common.reason'), value: f.reason },
      ]}
      onSubmit={async () => {
        await post(`/loans/${loan.id}/write-off`, { date: f.date, reason: f.reason.trim() });
        onSaved();
      }}
    >
      <div className="full error-box">{t('loanMod.writeOffWarning', { amount: money(loan.position?.principalOutstanding) })}</div>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('confirm.reasonRequired')}><input required minLength={3} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
    </ConfirmFormModal>
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
        checkReason(t, reason);
        await post(`/collections/${collection.id}/reverse`, { reason: reason.trim() });
        onSaved();
      }}
    >
      <Field label={t('confirm.reasonRequired')} full><input required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}
