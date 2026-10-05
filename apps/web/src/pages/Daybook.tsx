import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCheck } from 'lucide-react';
import { BranchPicker, ModeSelect } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Modal, Stat, useToast, RowActions } from '../components/ui';
import { get, openFile, post, upload } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, money, toPaise, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Category { id: string; name: string; kind: string; active: boolean }
interface Entry { id: string; date: string; voucherNo: string; direction: string; categoryName: string | null; systemCategory: string | null; amount: number; mode: string; particulars: string; billUrl: string | null; source: string; createdByName?: string; createdAt: string }
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
  const [branchId, setBranchId] = useState(profile?.branches.length === 1 ? profile.branches[0].id : '');
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const { data, error, reload } = useLoad(() => get<Day>('/daybook', { branchId, from, to }), [branchId, from, to]);
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
          {can('daybook.manage') && <button className="btn primary" onClick={() => setAdding(true)}>{t('daybook.newEntry')}</button>}
        </div>
      </div>
      <ErrorBox error={error ?? actionError} />
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
                { key: 'createdByName', label: t('audit.actor'), value: (e) => `${e.createdByName ?? ''}${e.source === 'AUTO' ? ` (${t('daybook.auto')})` : ''}` },
                { key: 'bill', label: t('daybook.bill'), value: (e) => (e.billUrl ? '✓' : ''), render: (e) => e.billUrl && <a href="#" onClick={(ev) => { ev.preventDefault(); void openFile(e.billUrl!); }}>{t('common.view')}</a> },
              ]}
            />
            <p className="print-only">{t('daybook.closing')}: {t('daybook.cash')} {money(data.closing.cash)} · {t('daybook.bank')} {money(data.closing.bank)}</p>
          </div>
        </>
      )}
      {adding && <EntryForm branchId={branchId} categories={(cats.data ?? []).filter((c) => c.active)} onClose={() => setAdding(false)} onSaved={() => { toast(t('common.saved')); void reload(); }} />}
      {catsOpen && <Categories categories={cats.data ?? []} onClose={() => setCatsOpen(false)} onSaved={() => void cats.reload()} />}
    </div>
  );
}

function EntryForm({ branchId, categories, onClose, onSaved }: { branchId: string; categories: Category[]; onClose: () => void; onSaved: () => void }) {
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
        } else {
          await post('/daybook/entries', { ...base, direction: f.direction, mode: f.mode });
        }
        onSaved();
      }}
    >
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('daybook.direction')}>
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value, categoryId: '' })}>
          <option value="OUT">{t('daybook.out')}</option>
          <option value="IN">{t('daybook.in')}</option>
          <option value="WITHDRAW">{t('daybook.contraWithdraw')}</option>
          <option value="DEPOSIT">{t('daybook.contraDeposit')}</option>
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
  const [branchId, setBranchId] = useState(profile?.branches[0]?.id ?? '');
  const [date, setDate] = useState(today());
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
  const [received, setReceived] = useState(String(row.expected / 100));
  const [note, setNote] = useState('');
  const diff = toPaise(received) - row.expected;
  return (
    <FormModal
      title={`${t('handover.verify')}: ${row.agentName}`}
      onClose={onClose}
      onSubmit={async () => {
        await post('/handovers', { agentId: row.agentId, branchId, date, received: toPaise(received), note: note || null });
        onSaved();
      }}
    >
      <Field label={t('handover.expected')}><input value={money(row.expected)} disabled /></Field>
      <Field label={t('handover.received')}><input type="number" min="0" step="0.01" value={received} onChange={(e) => setReceived(e.target.value)} /></Field>
      <Field label={t('common.notes')} full><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      {diff !== 0 && <div className={`full ${diff < 0 ? 'error-box' : 'ok-box'}`}>{diff < 0 ? t('handover.shortage') : t('handover.excess')}: {money(Math.abs(diff))}</div>}
    </FormModal>
  );
}
