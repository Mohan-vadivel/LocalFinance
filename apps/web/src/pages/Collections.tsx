import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BranchPicker, RoutePicker, StaffPicker } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Stat, useToast } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, money, today } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { Pager } from './Customers';
import { ReverseForm } from './Loans';

interface Row {
  id: string;
  receiptNo: string;
  loanId: string;
  customerId: string;
  customerName?: string;
  loanNumber?: string;
  agentName?: string;
  amount: number;
  principal: number;
  interest: number;
  penalty: number;
  mode: string;
  upiRef: string | null;
  collectedAt: string;
  flagged: boolean;
  distanceM: number | null;
  reversedAt: string | null;
  reverseReason: string | null;
}

export default function Collections() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState('');
  const [routeId, setRouteId] = useState('');
  const [agentId, setAgentId] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [page, setPage] = useState(1);
  const { data, error, reload } = useLoad(
    () => get<{ total: number; pageSize: number; totals: Record<string, number>; rows: Row[] }>('/collections', { from, to, branchId, routeId, agentId, flagged: flagged ? 'true' : undefined, page }),
    [from, to, branchId, routeId, agentId, flagged, page],
  );
  const [reversing, setReversing] = useState<Row | null>(null);
  const totals = data?.totals ?? {};
  const all = Object.values(totals).reduce((s, v) => s + v, 0);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); setPage(1); };
  return (
    <div>
      <div className="page-head">
        <h1>{t('collection.title')}</h1>
      </div>
      <div className="card no-print">
        <div className="row">
          <label className="field inline">{t('common.from')}<input type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} /></label>
          <label className="field inline">{t('common.to')}<input type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} /></label>
          <BranchPicker value={branchId} onChange={reset(setBranchId)} allowAll />
          <RoutePicker branchId={branchId || undefined} value={routeId} onChange={reset(setRouteId)} allowAll />
          {can('staff.manage', 'route.manage', 'report.view', 'handover.verify') && <StaffPicker branchId={branchId || undefined} value={agentId} onChange={reset(setAgentId)} allowAll />}
          <label className="field inline"><input type="checkbox" checked={flagged} onChange={(e) => reset(setFlagged)(e.target.checked)} />{t('collection.farFromCustomer')}</label>
        </div>
      </div>
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <Stat label={t('common.total')} value={money(all)} sub={`${data?.total ?? 0}`} />
        <Stat label={t('common.modes.CASH')} value={money(totals.CASH ?? 0)} />
        <Stat label={t('common.modes.UPI')} value={money(totals.UPI ?? 0)} />
        <Stat label={t('common.modes.BANK')} value={money(totals.BANK ?? 0)} />
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={`${t('collection.title')} ${from} ${to}`}
          rows={data?.rows}
          columns={[
            { key: 'receiptNo', label: t('collection.receiptNo') },
            { key: 'collectedAt', label: t('common.date'), value: (r) => dateTime(r.collectedAt) },
            { key: 'customerName', label: t('common.customer'), render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); nav(`/customers/${r.customerId}`); }}>{r.customerName}</a> },
            { key: 'loanNumber', label: t('common.loan'), render: (r) => <a href="#" onClick={(e) => { e.preventDefault(); nav(`/loans/${r.loanId}`); }}>{r.loanNumber}</a> },
            { key: 'agentName', label: t('common.agent') },
            { key: 'amount', label: t('common.amount'), money: true, total: true, value: (r) => (r.reversedAt ? 0 : r.amount) },
            { key: 'interest', label: t('loanMod.interestDue'), money: true },
            { key: 'penalty', label: t('loanMod.penalty'), money: true },
            { key: 'mode', label: t('common.mode'), value: (r) => `${t(`common.modes.${r.mode}`)}${r.upiRef ? ` ${r.upiRef}` : ''}` },
            {
              key: 'flags',
              label: t('common.status'),
              value: (r) => (r.reversedAt ? `${t('collection.reversed')}: ${r.reverseReason}` : r.flagged ? t('collection.farFromCustomer') : ''),
              render: (r) => (
                <>
                  {r.reversedAt && <Badge tone="danger">{t('collection.reversed')}</Badge>}
                  {r.flagged && <Badge tone="warn">{r.distanceM ? `${r.distanceM} m` : t('collection.farFromCustomer')}</Badge>}
                </>
              ),
            },
            {
              key: 'actions',
              label: t('common.actions'),
              value: () => '',
              render: (r) => !r.reversedAt && can('collection.reverse') && <button className="btn small no-print" onClick={() => setReversing(r)}>{t('collection.reverse')}</button>,
            },
          ]}
        />
        <Pager page={page} pages={pages} total={data?.total} onPage={setPage} />
      </div>
      {reversing && <ReverseForm collection={reversing} onClose={() => setReversing(null)} onSaved={() => { toast(t('common.saved')); void reload(); }} />}
    </div>
  );
}
