import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, DataTable, ErrorBox, Stat } from '../components/ui';
import { get, post } from '../lib/api';
import { dateIN, dateTime, money, toPaise, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Agent { id: string; name: string }
interface RouteRow { id: string; name: string; location?: { name: string }; assignments: { userId: string; current: boolean }[] }
interface DayLoan {
  id: string;
  number: string;
  principal: number;
  instalmentAmount: number;
  dueNow: number;
  arrears: number;
  outstanding: number;
  daysPastDue: number;
  disbursedOn: string | null;
  maturityDate: string | null;
  totalPayable: number;
  totalPaid: number;
  instalmentsPaid: number;
  instalmentsTotal: number;
}
interface DayCustomer { id: string; code: string; name: string; phone: string; routeSeq: number | null; dueNow: number; paidToday: number; loans: DayLoan[] }
interface RouteDay { customers: DayCustomer[] }
interface Entry { id: string; receiptNo: string; loanNumber?: string; customerName?: string; amount: number; mode: string; collectedAt: string; reversedAt: string | null }

type Match = { loan: DayLoan; customer: DayCustomer };

/** Normalises what the clerk types: "mdu-3", "3", "MDU-000003" and the customer code all find the same loan. */
function findLoan(day: RouteDay | null | undefined, typed: string): Match | null {
  const q = typed.trim().toLowerCase();
  if (!q || !day) return null;
  const all = day.customers.flatMap((c) => c.loans.map((loan) => ({ loan, customer: c })));
  const digits = q.replace(/\D/g, '');
  const exact = all.find((m) => m.loan.number.toLowerCase() === q || m.customer.code.toLowerCase() === q);
  if (exact) return exact;
  if (digits && digits === q.replace(/[^\d]/g, '') && /^\D*\d+$/.test(q)) {
    const byNumber = all.filter((m) => Number(m.loan.number.replace(/\D/g, '')) === Number(digits));
    if (byNumber.length === 1) return byNumber[0];
  }
  const byName = all.filter((m) => m.customer.name.toLowerCase().startsWith(q));
  return byName.length === 1 ? byName[0] : null;
}

/**
 * Office entry of the receipts an agent brings in, typed by account number like the old desk software:
 * the loan card shows the position before saving, Enter moves from account to amount to save.
 */
export default function DeskEntry() {
  const { t } = useTranslation();
  const [date, setDate] = useState(today());
  const [agentId, setAgentId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [account, setAccount] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [upiRef, setUpiRef] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState('');
  const [closed, setClosed] = useState<string[]>([]);
  const accountRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  const agents = useLoad(() => get<Agent[]>('/staff', { role: 'COLLECTION_AGENT' }), []);
  const routes = useLoad(() => get<RouteRow[]>('/routes'), []);
  const day = useLoad(() => (routeId ? get<RouteDay>(`/routes/${routeId}/day`, { date }) : Promise.resolve(null)), [routeId, date]);
  const list = useLoad(
    () => (routeId ? get<{ totals: Record<string, number>; rows: Entry[]; total: number }>('/collections', { from: date, to: date, routeId, agentId: agentId || undefined }) : Promise.resolve(null)),
    [routeId, agentId, date],
  );

  // Picking an agent selects the line they are assigned to.
  useEffect(() => {
    if (!agentId || !routes.data) return;
    const mine = routes.data.find((r) => r.assignments.some((a) => a.userId === agentId && a.current));
    if (mine) setRouteId(mine.id);
  }, [agentId, routes.data]);

  const match = useMemo(() => findLoan(day.data, account), [day.data, account]);
  const pending = (day.data?.customers ?? []).filter((c) => c.dueNow > 0 && c.paidToday === 0 && c.loans.length > 0);

  const pick = (m: Match) => {
    setAccount(m.loan.number);
    setAmount(String((m.loan.dueNow > 0 ? Math.min(m.loan.dueNow, m.loan.outstanding) : m.loan.instalmentAmount) / 100));
    setError(null);
    setTimeout(() => amountRef.current?.select(), 0);
  };

  const save = async () => {
    if (!match) {
      setError(new Error(t('desk.notFound')));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ collection: { receiptNo: string }; loanClosed: boolean }>('/collections', {
        loanId: match.loan.id,
        amount: toPaise(amount),
        mode,
        upiRef: mode === 'UPI' ? upiRef || null : null,
        note: note || null,
        clientRef: `desk-${crypto.randomUUID()}`,
        agentId: agentId || undefined,
        // A past date is saved at noon India time on that day.
        collectedAt: date === today() ? undefined : new Date(`${date}T06:30:00.000Z`).toISOString(),
      });
      if (r.loanClosed) setClosed((c) => [...c, match.loan.number]);
      setMessage(`${t('desk.saved', { receipt: r.collection.receiptNo })}${r.loanClosed ? ` · ${t('desk.accountClosed')}` : ''}`);
      setAccount('');
      setAmount('');
      setUpiRef('');
      setNote('');
      day.reload();
      list.reload();
      accountRef.current?.focus();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const totals = list.data?.totals ?? {};
  const sum = Object.values(totals).reduce((s, v) => s + v, 0);
  const loan = match?.loan;

  return (
    <div>
      <div className="page-head">
        <h1>{t('desk.title')}</h1>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>{t('desk.help')}</p>
      <div className="card no-print">
        <div className="row">
          <label className="field inline">{t('reportCols.date')}<input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          <label className="field inline">
            {t('desk.collectedBy')}
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">{t('common.agent')}</option>
              {(agents.data ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label className="field inline">
            {t('desk.line')}
            <select value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              <option value="">{t('common.route')}</option>
              {(routes.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.name}{r.location ? ` · ${r.location.name}` : ''}</option>)}
            </select>
          </label>
        </div>
      </div>
      <ErrorBox error={agents.error ?? routes.error ?? day.error} />
      {!routeId || !agentId ? (
        <p className="muted">{t('desk.chooseLine')}</p>
      ) : (
        <>
          <div className="grid c2" style={{ marginBottom: 16, alignItems: 'start' }}>
            <div className="card">
              <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
                <div className="row" style={{ alignItems: 'flex-end' }}>
                  <label className="field" style={{ flex: '2 1 200px' }}>
                    {t('desk.accountNo')}
                    <input
                      ref={accountRef}
                      autoFocus
                      list="desk-loans"
                      value={account}
                      placeholder={t('desk.find')}
                      onChange={(e) => { setAccount(e.target.value); setMessage(''); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          if (match) pick(match);
                          else setError(new Error(t('desk.notFound')));
                        }
                      }}
                    />
                  </label>
                  <label className="field" style={{ flex: '1 1 120px' }}>
                    {t('reportCols.amount')}
                    <input ref={amountRef} type="number" min="1" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
                  </label>
                  <label className="field">
                    {t('reportCols.mode')}
                    <select value={mode} onChange={(e) => setMode(e.target.value)}>
                      {['CASH', 'UPI', 'CARD', 'BANK'].map((m) => <option key={m} value={m}>{t(`common.modes.${m}`)}</option>)}
                    </select>
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  {mode === 'UPI' && <input placeholder={t('collection.upiRef')} value={upiRef} onChange={(e) => setUpiRef(e.target.value)} style={{ flex: '1 1 160px' }} />}
                  <input placeholder={t('reportCols.note')} value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: '2 1 200px' }} />
                  <button className="btn primary" disabled={busy || !match || !(Number(amount) > 0)}>{t('desk.save')}</button>
                </div>
                <datalist id="desk-loans">
                  {(day.data?.customers ?? []).flatMap((c) => c.loans.map((l) => <option key={l.id} value={l.number}>{`${c.name} · ${c.code}`}</option>))}
                </datalist>
              </form>
              <ErrorBox error={error} />
              {message && <p role="status"><Badge tone="ok">{message}</Badge></p>}
              {match && loan && (
                <div style={{ marginTop: 12 }}>
                  <h3 style={{ margin: '0 0 4px' }}>{match.customer.name} <span className="muted">· {loan.number} · {match.customer.phone}</span></h3>
                  <div className="grid k4">
                    <Stat label={t('desk.loanAmount')} value={money(loan.principal)} sub={`${t('desk.loanDate')}: ${dateIN(loan.disbursedOn)}`} />
                    <Stat label={t('desk.totalPayable')} value={money(loan.totalPayable)} sub={`${t('desk.maturity')}: ${dateIN(loan.maturityDate)}`} />
                    <Stat label={t('desk.received')} value={money(loan.totalPaid)} sub={`${t('desk.paidInstalments')}: ${loan.instalmentsPaid} / ${loan.instalmentsTotal}`} />
                    <Stat label={t('desk.balance')} value={money(loan.outstanding)} sub={`${t('desk.instalment')}: ${money(loan.instalmentAmount)}`} />
                    <Stat label={t('desk.pendingDues')} value={money(loan.dueNow)} sub={loan.daysPastDue ? `${t('desk.daysLate')}: ${loan.daysPastDue}` : undefined} />
                  </div>
                </div>
              )}
            </div>
            <div className="card">
              <h3 style={{ marginTop: 0 }}>{t('desk.pendingInLine')} ({pending.length})</h3>
              <DataTable
                rows={pending}
                onRow={(c) => pick({ customer: c, loan: c.loans[0] })}
                columns={[
                  { key: 'routeSeq', label: '#', num: true },
                  { key: 'loan', label: t('desk.accountNo'), value: (c) => c.loans[0].number },
                  { key: 'name', label: t('reportCols.customer') },
                  { key: 'dueNow', label: t('desk.pendingDues'), money: true, total: true },
                ]}
              />
            </div>
          </div>
          <div className="grid k4" style={{ marginBottom: 16 }}>
            <Stat label={t('common.total')} value={money(sum)} sub={`${t('collSummary.receipts')}: ${list.data?.total ?? 0}`} />
            <Stat label={t('common.modes.CASH')} value={money(totals.CASH ?? 0)} />
            <Stat label={t('common.modes.UPI')} value={money(totals.UPI ?? 0)} />
            {(totals.CARD ?? 0) > 0 && <Stat label={t('common.modes.CARD')} value={money(totals.CARD ?? 0)} />}
            {(totals.BANK ?? 0) > 0 && <Stat label={t('common.modes.BANK')} value={money(totals.BANK ?? 0)} />}
            <Stat label={t('desk.closedCount')} value={closed.length} sub={closed.join(', ')} />
          </div>
          <div className="card">
            <DataTable
              title={`${t('desk.entered')} ${dateIN(date)}`}
              rows={list.data?.rows.filter((r) => !r.reversedAt)}
              columns={[
                { key: 'receiptNo', label: t('collection.receiptNo') },
                { key: 'loanNumber', label: t('desk.accountNo') },
                { key: 'customerName', label: t('reportCols.customer') },
                { key: 'amount', label: t('reportCols.amount'), money: true, total: true },
                { key: 'mode', label: t('reportCols.mode'), value: (r) => t(`common.modes.${r.mode}`) },
                { key: 'collectedAt', label: t('common.date'), value: (r) => dateTime(r.collectedAt) },
              ]}
            />
          </div>
        </>
      )}
    </div>
  );
}
