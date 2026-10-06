import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, CheckCheck, X } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { BranchPicker, ModeSelect, StaffPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Modal, Stat, Tabs, useToast, RowActions } from '../components/ui';
import { get, openFile, post, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, money, toPaise, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Category { id: string; name: string; kind: string; active: boolean }
interface Entry { id: string; date: string; voucherNo: string; direction: string; categoryName: string | null; systemCategory: string | null; amount: number; mode: string; particulars: string; billUrl: string | null; source: string; createdByName?: string; approvedByName?: string; createdAt: string }
interface Day {
  from: string;
  to: string;
  branches: { id: string; name: string }[];
  opening: { cash: number; bank: number };
  closing: { cash: number; bank: number };
  receipts: number;
  payments: number;
  closed: { branchId: string; date: string; closedAt: string }[];
  entries: Entry[];
}

export default function Daybook() {
  const { t } = useTranslation();
  const toast = useToast();
  const { can, profile } = useAuth();
  // The dashboard's "Action needed" links open this page on ?branchId=...&date=... (the oldest open day).
  const [params] = useSearchParams();
  const [branchId, setBranchId] = useState(params.get('branchId') ?? (profile?.branches.length === 1 ? profile.branches[0].id : ''));
  const [from, setFrom] = useState(params.get('date') ?? today());
  const [to, setTo] = useState(params.get('date') ?? today());
  // Staff who can only send entries for approval do not see the whole day book, just their own entries.
  const full = can('daybook.view', 'daybook.manage');
  const approver = can('daybook.approve');
  const canEnter = can('daybook.manage', 'daybook.request', 'daybook.approve');
  const { data, error, reload } = useLoad(() => (full ? get<Day>('/daybook', { branchId, from, to }) : Promise.resolve(null)), [branchId, from, to, full]);
  const [version, setVersion] = useState(0);
  const changed = () => {
    setVersion((v) => v + 1);
    void reload();
  };
  const cats = useLoad(() => get<Category[]>('/daybook/categories'), []);
  const [adding, setAdding] = useState(false);
  const [catsOpen, setCatsOpen] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const single = from === to && !!branchId;
  const closed = single && data?.closed.some((c) => c.branchId === branchId && c.date === from);

  const dayAction = async (what: 'close' | 'reopen') => {
    if (!window.confirm(`${what === 'close' ? t('daybook.closeDay') : t('daybook.reopen')}: ${dateIN(from)}?`)) return;
    setActionError(null);
    try {
      await post(`/daybook/${what}`, { branchId, date: from });
      toast(t('common.saved'));
      void reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('daybook.title')}</h1>
        <div className="row no-print">
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
          <label className="field inline">{t('common.from')}<input type="date" value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} /></label>
          <label className="field inline">{t('common.to')}<input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></label>
          {can('daybook.manage') && <button className="btn" onClick={() => setCatsOpen(true)}>{t('daybook.categories')}</button>}
          {canEnter && <button className="btn primary" onClick={() => setAdding(true)}>{t('daybook.newEntry')}</button>}
        </div>
      </div>
      <ErrorBox error={error ?? actionError} />
      <Requests branchId={branchId} from={from} to={to} approver={approver} mine={!full && !approver} version={version} onChanged={changed} />
      {data && (
        <>
          <div className="grid k4" style={{ marginBottom: 16 }}>
            <Stat label={`${t('daybook.opening')} · ${t('daybook.cash')}`} value={money(data.opening.cash)} sub={`${t('daybook.bank')} ${money(data.opening.bank)}`} />
            <Stat label={t('daybook.receipt')} value={money(data.receipts)} />
            <Stat label={t('daybook.payment')} value={money(data.payments)} />
            <Stat label={`${t('daybook.closing')} · ${t('daybook.cash')}`} value={money(data.closing.cash)} sub={`${t('daybook.bank')} ${money(data.closing.bank)}`} />
          </div>
          {single && (
            <div className="card row no-print">
              {closed ? (
                <>
                  <Badge tone="ok">{t('daybook.closed')}</Badge>
                  <span className="muted">{t('daybook.closedLocked')}</span>
                  <span className="spacer" />
                  {profile?.role === 'TENANT_ADMIN' && <button className="btn" onClick={() => void dayAction('reopen')}>{t('daybook.reopen')}</button>}
                </>
              ) : (
                <>
                  <span className="muted">{t('daybook.closeHelp')}</span>
                  <span className="spacer" />
                  {can('daybook.manage') && <button className="btn primary" onClick={() => void dayAction('close')}>{t('daybook.closeDay')}</button>}
                </>
              )}
            </div>
          )}
          {!branchId && <div className="muted" style={{ marginBottom: 8 }}>{t('daybook.allBranches')}</div>}
          <div className="card">
            <div className="print-only">
              <h2>{t('daybook.title')} · {data.branches.map((b) => b.name).join(', ')} · {dateIN(data.from)} – {dateIN(data.to)}</h2>
              <p>{t('daybook.opening')}: {t('daybook.cash')} {money(data.opening.cash)} · {t('daybook.bank')} {money(data.opening.bank)}</p>
            </div>
            <DataTable
              title={`${t('daybook.title')} ${data.from} ${data.to}`}
              rows={data.entries}
              columns={[
                { key: 'date', label: t('common.date'), value: (e) => dateIN(e.date) },
                { key: 'voucherNo', label: t('daybook.voucher') },
                { key: 'category', label: t('daybook.category'), value: (e) => e.categoryName ?? (e.systemCategory ? t(`daybook.system.${e.systemCategory}`) : '') },
                { key: 'particulars', label: t('daybook.particulars') },
                { key: 'mode', label: t('common.mode'), value: (e) => t(`common.modes.${e.mode}`) },
                { key: 'in', label: t('daybook.in'), money: true, total: true, value: (e) => (e.direction === 'IN' ? e.amount : null) },
                { key: 'out', label: t('daybook.out'), money: true, total: true, value: (e) => (e.direction === 'OUT' ? e.amount : null) },
                { key: 'createdByName', label: t('audit.actor'), value: (e) => `${e.createdByName ?? ''}${e.source === 'AUTO' ? ` (${t('daybook.auto')})` : ''}${e.approvedByName ? ` (${t('daybook.approvedBy', { name: e.approvedByName })})` : ''}` },
                { key: 'bill', label: t('daybook.bill'), value: (e) => (e.billUrl ? '✓' : ''), render: (e) => e.billUrl && <a href="#" onClick={(ev) => { ev.preventDefault(); void openFile(e.billUrl!); }}>{t('common.view')}</a> },
              ]}
            />
            <p className="print-only">{t('daybook.closing')}: {t('daybook.cash')} {money(data.closing.cash)} · {t('daybook.bank')} {money(data.closing.bank)}</p>
          </div>
        </>
      )}
      {adding && <EntryForm branchId={branchId} approver={approver} categories={(cats.data ?? []).filter((c) => c.active)} onClose={() => setAdding(false)} onSaved={(pending) => { toast(t(pending ? 'daybook.sentForApproval' : 'common.saved')); changed(); }} />}
      {catsOpen && <Categories categories={cats.data ?? []} onClose={() => setCatsOpen(false)} onSaved={() => void cats.reload()} />}
    </div>
  );
}

function EntryForm({ branchId, approver, categories, onClose, onSaved }: { branchId: string; approver: boolean; categories: Category[]; onClose: () => void; onSaved: (pending: boolean) => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ branchId, date: today(), direction: 'OUT', categoryId: '', amount: '', mode: 'CASH', particulars: '' });
  const [bill, setBill] = useState<File | null>(null);
  const contra = f.direction === 'WITHDRAW' || f.direction === 'DEPOSIT';
  const kinds = contra ? ['BANK'] : f.direction === 'IN' ? ['INCOME', 'DRAWING', 'BANK'] : ['EXPENSE', 'DRAWING', 'BANK'];
  return (
    <FormModal
      title={t('daybook.newEntry')}
      onClose={onClose}
      onSubmit={async () => {
        const billUrl = bill ? (await upload(bill, { kind: 'BILL' })).url : null;
        const base = { branchId: f.branchId, date: f.date, categoryId: f.categoryId, amount: toPaise(f.amount), particulars: f.particulars, billUrl };
        if (contra) {
          // A contra moves money between bank and cash: one entry out of one side, one into the other.
          const fromBank = f.direction === 'WITHDRAW';
          await post('/daybook/entries', { ...base, direction: 'OUT', mode: fromBank ? 'BANK' : 'CASH' });
          await post('/daybook/entries', { ...base, direction: 'IN', mode: fromBank ? 'CASH' : 'BANK' });
          onSaved(false);
        } else {
          const r = await post<{ pending?: boolean }>('/daybook/entries', { ...base, direction: f.direction, mode: f.mode });
          onSaved(!!r?.pending);
        }
      }}
    >
      {!approver && <p className="muted full" style={{ margin: 0 }}>{t('daybook.needsApproval')}</p>}
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('daybook.direction')}>
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, categoryId: '' })}>
          <option value="OUT">{t('daybook.out')}</option>
          <option value="IN">{t('daybook.in')}</option>
          {/* Moving money between bank and cash is office work for someone who posts straight to the day book. */}
          {approver && <option value="WITHDRAW">{t('daybook.contraWithdraw')}</option>}
          {approver && <option value="DEPOSIT">{t('daybook.contraDeposit')}</option>}
        </select>
      </Field>
      <Field label={t('daybook.category')}>
        <select value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
          <option value="">{t('daybook.category')}</option>
          {categories.filter((c) => kinds.includes(c.kind)).map((c) => <option key={c.id} value={c.id}>{c.name} · {t(`daybook.kinds.${c.kind}`)}</option>)}
        </select>
      </Field>
      <Field label={t('common.amount')}><input type="number" min="1" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      {!contra && <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>}
      <Field label={t('daybook.particulars')} full><input value={f.particulars} onChange={(e) => setF({ ...f, particulars: e.target.value })} /></Field>
      <Field label={t('daybook.bill')} full><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setBill(e.target.files?.[0] ?? null)} /></Field>
    </FormModal>
  );
}

type ReqStatus = 'PENDING' | 'APPROVED' | 'REJECTED';
interface Req {
  id: string;
  branchId: string;
  branchName?: string;
  date: string;
  direction: string;
  categoryName?: string;
  amount: number;
  mode: string;
  particulars: string;
  billUrl: string | null;
  status: ReqStatus;
  requestedById: string;
  requestedByName?: string;
  createdAt: string;
  decidedByName?: string;
  decidedAt: string | null;
  reason: string | null;
  responsibleId: string | null;
  responsibleName?: string;
}
const REQ_TONE = { PENDING: 'warn', APPROVED: 'ok', REJECTED: 'danger' } as const;

/**
 * Day book entries sent by staff for a branch manager's approval. Waiting entries are listed whatever their date,
 * so none are missed; approved and rejected ones follow the page's dates. Rejected ones are totalled per responsible person.
 */
function Requests({ branchId, from, to, approver, mine, version, onChanged }: { branchId: string; from: string; to: string; approver: boolean; mine: boolean; version: number; onChanged: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { profile } = useAuth();
  const [tab, setTab] = useState<ReqStatus>('PENDING');
  const { data, error, reload } = useLoad(() => get<Req[]>('/daybook/requests', { branchId, status: tab, ...(tab === 'PENDING' ? {} : { from, to }) }), [branchId, tab, from, to, version]);
  const [rejecting, setRejecting] = useState<Req | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const approve = async (r: Req) => {
    if (!window.confirm(t('daybook.confirmApprove', { amount: money(r.amount), name: r.requestedByName ?? '' }))) return;
    setActionError(null);
    try {
      await post(`/daybook/requests/${r.id}/approve`, {});
      toast(t('common.saved'));
      onChanged();
    } catch (e) {
      setActionError(e);
    }
  };
  const totals = new Map<string, { name: string; count: number; amount: number }>();
  if (tab === 'REJECTED') {
    for (const r of data ?? []) {
      const k = r.responsibleId ?? '';
      const row = totals.get(k) ?? { name: r.responsibleName ?? '', count: 0, amount: 0 };
      row.count += 1;
      row.amount += r.amount;
      totals.set(k, row);
    }
  }
  return (
    <div className="card">
      <div className="card-head row">
        <h3 style={{ margin: 0 }}>{mine ? t('daybook.myEntries') : t('daybook.requests')}</h3>
        <span className="spacer" />
        <Tabs value={tab} onChange={setTab} items={(['PENDING', 'APPROVED', 'REJECTED'] as const).map((k) => ({ key: k, label: t(`daybook.statuses.${k}`) }))} />
      </div>
      <ErrorBox error={error ?? actionError} />
      {tab === 'REJECTED' && totals.size > 0 && (
        <div style={{ marginBottom: 12 }}>
          <DataTable
            title={t('daybook.rejectedTotals')}
            rows={[...totals.values()]}
            columns={[
              { key: 'name', label: t('daybook.responsible') },
              { key: 'count', label: t('daybook.entries'), num: true, total: true },
              { key: 'amount', label: t('common.amount'), money: true, total: true },
            ]}
          />
        </div>
      )}
      <DataTable
        title={`${mine ? t('daybook.myEntries') : t('daybook.requests')} · ${t(`daybook.statuses.${tab}`)}`}
        rows={data}
        empty={tab === 'PENDING' ? t('daybook.nothingWaiting') : undefined}
        columns={[
          { key: 'date', label: t('common.date'), value: (r) => dateIN(r.date) },
          ...(branchId ? [] : [{ key: 'branchName', label: t('common.branch') }]),
          { key: 'categoryName', label: t('daybook.category') },
          { key: 'particulars', label: t('daybook.particulars') },
          { key: 'mode', label: t('common.mode'), value: (r: Req) => t(`common.modes.${r.mode}`) },
          { key: 'in', label: t('daybook.in'), money: true, total: true, value: (r: Req) => (r.direction === 'IN' ? r.amount : null) },
          { key: 'out', label: t('daybook.out'), money: true, total: true, value: (r: Req) => (r.direction === 'OUT' ? r.amount : null) },
          { key: 'requestedByName', label: t('daybook.enteredBy'), value: (r: Req) => `${r.requestedByName ?? ''} · ${dateTime(r.createdAt)}` },
          ...(tab === 'PENDING'
            ? []
            : [{ key: 'decidedByName', label: t('daybook.decidedBy'), value: (r: Req) => `${r.decidedByName ?? ''}${r.decidedAt ? ` · ${dateTime(r.decidedAt)}` : ''}` }]),
          ...(tab === 'REJECTED'
            ? [
                { key: 'reason', label: t('daybook.reason') },
                { key: 'responsibleName', label: t('daybook.responsible') },
              ]
            : []),
          { key: 'bill', label: t('daybook.bill'), value: (r: Req) => (r.billUrl ? '✓' : ''), render: (r: Req) => r.billUrl && <a href="#" onClick={(ev) => { ev.preventDefault(); void openFile(r.billUrl!); }}>{t('common.view')}</a> },
          {
            key: 'status',
            label: t('common.status'),
            value: (r: Req) => t(`daybook.statuses.${r.status}`),
            render: (r: Req) =>
              r.status === 'PENDING' && approver ? (
                r.requestedById === profile?.id ? (
                  <span className="muted">{t('daybook.ownEntry')}</span>
                ) : (
                  <RowActions
                    actions={[
                      { icon: Check, label: t('daybook.approve'), tone: 'primary', onClick: () => void approve(r) },
                      { icon: X, label: t('daybook.reject'), tone: 'danger', onClick: () => setRejecting(r) },
                    ]}
                  />
                )
              ) : (
                <Badge tone={REQ_TONE[r.status]}>{t(`daybook.statuses.${r.status}`)}</Badge>
              ),
          },
        ]}
      />
      {rejecting && <RejectForm req={rejecting} onClose={() => setRejecting(null)} onSaved={() => { toast(t('common.saved')); onChanged(); void reload(); }} />}
    </div>
  );
}

function RejectForm({ req, onClose, onSaved }: { req: Req; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  const [responsibleId, setResponsibleId] = useState(req.requestedById);
  return (
    <FormModal
      title={`${t('daybook.rejectTitle')}: ${money(req.amount)}`}
      submitLabel={t('daybook.reject')}
      onClose={onClose}
      onSubmit={async () => {
        if (reason.trim().length < 3) throw new Error(`${t('daybook.reason')}: ${t('common.required')}`);
        await post(`/daybook/requests/${req.id}/reject`, { reason: reason.trim(), responsibleId: responsibleId || undefined });
        onSaved();
      }}
    >
      <Field label={t('daybook.enteredBy')}><input value={`${req.requestedByName ?? ''} · ${req.particulars}`} disabled /></Field>
      <Field label={t('daybook.responsible')}>
        <StaffPicker value={responsibleId} onChange={setResponsibleId} branchId={req.branchId} />
      </Field>
      <p className="muted full" style={{ margin: 0 }}>{t('daybook.responsibleHelp')}</p>
      <Field label={t('daybook.reason')} full><input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </FormModal>
  );
}

function Categories({ categories, onClose, onSaved }: { categories: Category[]; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: '', kind: 'EXPENSE' });
  const [error, setError] = useState<unknown>(null);
  const add = async () => {
    setError(null);
    try {
      await post('/daybook/categories', f);
      setF({ name: '', kind: f.kind });
      onSaved();
    } catch (e) {
      setError(e);
    }
  };
  return (
    <Modal title={t('daybook.categories')} onClose={onClose} actions={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <ErrorBox error={error} />
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder={t('daybook.newCategory')} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
          {['EXPENSE', 'INCOME', 'DRAWING', 'BANK'].map((k) => <option key={k} value={k}>{t(`daybook.kinds.${k}`)}</option>)}
        </select>
        <button className="btn primary" onClick={() => void add()} disabled={f.name.trim().length < 2}>{t('common.create')}</button>
      </div>
      <DataTable rows={categories} columns={[{ key: 'name', label: t('common.name') }, { key: 'kind', label: t('daybook.direction'), value: (c) => t(`daybook.kinds.${c.kind}`) }]} />
    </Modal>
  );
}

export function Handovers() {
  const { t } = useTranslation();
  const toast = useToast();
  const { profile } = useAuth();
  const [params] = useSearchParams();
  const [branchId, setBranchId] = useState(params.get('branchId') ?? profile?.branches[0]?.id ?? '');
  const [date, setDate] = useState(params.get('date') ?? today());
  // Owners are not tied to a branch: start on the first branch they can see.
  const branches = useLoad(() => get<{ id: string }[]>('/branches'), []);
  useEffect(() => {
    if (!branchId && branches.data?.length) setBranchId(branches.data[0].id);
  }, [branchId, branches.data]);
  const pending = useLoad(
    () => (branchId ? get<{ agentId: string; agentName?: string; cash: number; upi: number; float: number; expected: number; handover: { received: number; difference: number } | null }[]>('/handovers/pending', { branchId, date }) : Promise.resolve([])),
    [branchId, date],
  );
  const history = useLoad(
    () => get<{ id: string; date: string; agentName?: string; expected: number; received: number; difference: number; note: string | null; verifiedByName?: string; verifiedAt: string }[]>('/handovers', { branchId, from: date.slice(0, 8) + '01', to: date }),
    [branchId, date],
  );
  const [verifying, setVerifying] = useState<{ agentId: string; agentName?: string; expected: number } | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('handover.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={setBranchId} />
          <input type="date" max={today()} value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>
      <ErrorBox error={pending.error ?? history.error} />
      <div className="card">
        <h3>{t('handover.pending')} · {dateIN(date)}</h3>
        <DataTable
          rows={pending.data}
          columns={[
            { key: 'agentName', label: t('common.agent') },
            { key: 'float', label: t('handover.float'), money: true, total: true },
            { key: 'cash', label: t('common.modes.CASH'), money: true, total: true },
            { key: 'upi', label: `${t('common.modes.UPI')} / ${t('common.modes.BANK')}`, money: true, total: true },
            { key: 'expected', label: t('handover.expected'), money: true, total: true },
            { key: 'received', label: t('handover.received'), money: true, value: (r) => r.handover?.received ?? null },
            {
              key: 'status',
              label: t('common.status'),
              value: (r) => (r.handover ? t('handover.done') : t('handover.pending')),
              render: (r) =>
                r.handover ? (
                  <Badge tone={r.handover.difference < 0 ? 'danger' : r.handover.difference > 0 ? 'warn' : 'ok'}>{r.handover.difference === 0 ? t('handover.done') : `${r.handover.difference < 0 ? t('handover.shortage') : t('handover.excess')} ${money(Math.abs(r.handover.difference))}`}</Badge>
                ) : r.agentId === profile?.id ? (
                  <span className="muted">{t('handover.notSelf')}</span>
                ) : (
                  <RowActions actions={[{ icon: CheckCheck, label: t('handover.verify'), tone: 'primary', onClick: () => setVerifying(r) }]} />
                ),
            },
          ]}
        />
      </div>
      <div className="card">
        <DataTable
          title={t('handover.history')}
          rows={history.data}
          columns={[
            { key: 'date', label: t('common.date'), value: (r) => dateIN(r.date) },
            { key: 'agentName', label: t('common.agent') },
            { key: 'expected', label: t('handover.expected'), money: true, total: true },
            { key: 'received', label: t('handover.received'), money: true, total: true },
            { key: 'difference', label: t('handover.difference'), money: true, total: true },
            { key: 'note', label: t('common.notes') },
            { key: 'verifiedByName', label: t('handover.verifiedBy'), value: (r) => `${r.verifiedByName ?? ''} · ${dateTime(r.verifiedAt)}` },
          ]}
        />
      </div>
      {verifying && <VerifyForm row={verifying} branchId={branchId} date={date} onClose={() => setVerifying(null)} onSaved={() => { toast(t('common.saved')); void pending.reload(); void history.reload(); }} />}
    </div>
  );
}

function VerifyForm({ row, branchId, date, onClose, onSaved }: { row: { agentId: string; agentName?: string; expected: number }; branchId: string; date: string; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  // Starts empty so the cash is really counted, not confirmed by habit.
  const [received, setReceived] = useState('');
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const entered = received.trim() !== '';
  const diff = entered ? toPaise(received) - row.expected : 0;
  const noteMissing = diff < 0 && !note.trim();
  return (
    <FormModal
      title={`${t('handover.verify')}: ${row.agentName}`}
      onClose={onClose}
      submitLabel={t('handover.verify')}
      onSubmit={async () => {
        setTried(true);
        if (!entered) throw new Error(`${t('handover.received')}: ${t('common.required')}`);
        if (noteMissing) throw new Error(t('handover.noteRequired'));
        await post('/handovers', { agentId: row.agentId, branchId, date, received: toPaise(received), note: note.trim() || null });
        onSaved();
      }}
    >
      <Field label={t('handover.expected')}><input value={money(row.expected)} disabled /></Field>
      <Field label={t('handover.received')} error={tried && !entered ? t('common.required') : undefined}>
        <input type="number" min="0" step="0.01" inputMode="decimal" autoFocus placeholder={t('handover.countCash')} value={received} onChange={(e) => setReceived(e.target.value)} />
      </Field>
      {entered && (
        <div className={`full ${diff < 0 ? 'error-box' : 'ok-box'}`} role="status" style={{ marginBottom: 0 }}>
          {t('handover.difference')}: {diff === 0 ? money(0) : `${diff < 0 ? t('handover.shortage') : t('handover.excess')} ${money(Math.abs(diff))}`}
        </div>
      )}
      <Field label={diff < 0 ? t('handover.noteForShortage') : t('common.notes')} full error={tried && noteMissing ? t('handover.noteRequired') : undefined}>
        <input value={note} required={diff < 0} onChange={(e) => setNote(e.target.value)} />
      </Field>
    </FormModal>
  );
}
