import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeftRight, CirclePlus, ReceiptText } from 'lucide-react';
import { FUND_SOURCE_TYPES } from '@localfinance/shared';
import { BranchPicker, FundPicker, ModeSelect, StaffPicker, clearLookups } from '../components/pickers';
import { DataTable, ErrorBox, Field, FormModal, Modal, Stat, useToast, RowActions } from '../components/ui';
import { get, post } from '../lib/api';
import { dateIN, dateTime, money, toPaise, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Fund { id: string; name: string; branchId: string; branchName?: string; sourceType: string; investorName?: string; balance: number; activeLoans: number; lentOut: number }
interface Txn { id: string; date: string; type: string; amount: number; balance: number; note: string | null; createdAt: string }

export default function Funds() {
  const { t } = useTranslation();
  const toast = useToast();
  const [branchId, setBranchId] = useState('');
  const { data, error, reload } = useLoad(() => get<Fund[]>('/funds', { branchId }), [branchId]);
  const [creating, setCreating] = useState(false);
  const [depositing, setDepositing] = useState<Fund | null>(null);
  const [transferring, setTransferring] = useState<Fund | null>(null);
  const [viewing, setViewing] = useState<Fund | null>(null);
  const done = () => {
    clearLookups();
    toast(t('common.saved'));
    void reload();
  };
  const funds = data ?? [];
  const total = funds.reduce((s, f) => s + f.balance, 0);
  const investor = funds.filter((f) => f.sourceType === 'INVESTOR').reduce((s, f) => s + f.balance, 0);
  return (
    <div>
      <div className="page-head">
        <h1>{t('fund.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
          <button className="btn primary" onClick={() => setCreating(true)}>{t('fund.new')}</button>
        </div>
      </div>
      <div className="grid k4" style={{ marginBottom: 16 }}>
        <Stat label={t('fund.available')} value={money(total)} />
        <Stat label={t('fund.investorShare')} value={money(investor)} />
        <Stat label={t('fund.ownerShare')} value={money(total - investor)} />
        <Stat label={t('fund.lentOut')} value={money(funds.reduce((s, f) => s + f.lentOut, 0))} sub={`${funds.reduce((s, f) => s + f.activeLoans, 0)} ${t('dashboard.activeLoans')}`} />
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('fund.title')}
          rows={data}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'branchName', label: t('common.branch') },
            { key: 'sourceType', label: t('fund.sourceType'), value: (f) => `${t(`fund.sourceTypes.${f.sourceType}`)}${f.investorName ? ` · ${f.investorName}` : ''}` },
            { key: 'balance', label: t('fund.balance'), money: true, total: true },
            { key: 'lentOut', label: t('fund.lentOut'), money: true, total: true },
            { key: 'activeLoans', label: t('dashboard.activeLoans'), num: true, total: true },
            {
              key: 'actions',
              label: t('common.actions'),
              value: () => '',
              render: (f) => (
                <RowActions
                  actions={[
                    { icon: CirclePlus, label: t('fund.deposit'), onClick: () => setDepositing(f), hidden: f.sourceType === 'INVESTOR' },
                    { icon: ArrowLeftRight, label: t('fund.transfer'), onClick: () => setTransferring(f) },
                    { icon: ReceiptText, label: t('fund.transactions'), onClick: () => setViewing(f) },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
      {creating && <FundForm onClose={() => setCreating(false)} onSaved={done} />}
      {depositing && <DepositForm fund={depositing} onClose={() => setDepositing(null)} onSaved={done} />}
      {transferring && <TransferForm fund={transferring} onClose={() => setTransferring(null)} onSaved={done} />}
      {viewing && <FundTxns fund={viewing} onClose={() => setViewing(null)} />}
    </div>
  );
}

function FundForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: '', sourceType: 'OWNER_CAPITAL', branchId: '' });
  return (
    <FormModal title={t('fund.new')} onClose={onClose} onSubmit={async () => { await post('/funds', f); onSaved(); }}>
      <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('common.branch')}><BranchPicker value={f.branchId} onChange={(v) => setF({ ...f, branchId: v })} /></Field>
      <Field label={t('fund.sourceType')}>
        <select value={f.sourceType} onChange={(e) => setF({ ...f, sourceType: e.target.value })}>
          {FUND_SOURCE_TYPES.map((s) => <option key={s} value={s}>{t(`fund.sourceTypes.${s}`)}</option>)}
        </select>
      </Field>
    </FormModal>
  );
}

function DepositForm({ fund, onClose, onSaved }: { fund: Fund; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ amount: '', date: today(), mode: 'BANK', note: '' });
  return (
    <FormModal
      title={`${t('fund.deposit')}: ${fund.name}`}
      onClose={onClose}
      onSubmit={async () => {
        await post(`/funds/${fund.id}/deposit`, { amount: toPaise(f.amount), date: f.date, mode: f.mode, note: f.note || null });
        onSaved();
      }}
    >
      <Field label={t('common.amount')}><input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('common.notes')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
    </FormModal>
  );
}

function TransferForm({ fund, onClose, onSaved }: { fund: Fund; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [to, setTo] = useState<'fund' | 'agent'>('fund');
  const [f, setF] = useState({ toFundId: '', toUserId: '', amount: '', date: today(), mode: 'CASH', note: '' });
  return (
    <FormModal
      title={`${t('fund.transfer')}: ${fund.name} (${money(fund.balance)})`}
      onClose={onClose}
      onSubmit={async () => {
        await post('/funds/transfer', {
          fromFundId: fund.id,
          toFundId: to === 'fund' ? f.toFundId : null,
          toUserId: to === 'agent' ? f.toUserId : null,
          amount: toPaise(f.amount),
          date: f.date,
          mode: f.mode,
          note: f.note || null,
        });
        onSaved();
      }}
    >
      <Field label={t('fund.transferTo')}>
        <select value={to} onChange={(e) => setTo(e.target.value as 'fund')}>
          <option value="fund">{t('fund.toFund')}</option>
          <option value="agent">{t('fund.toAgent')}</option>
        </select>
      </Field>
      {to === 'fund' ? (
        <Field label={t('fund.toFund')}><FundPicker value={f.toFundId} onChange={(v) => setF({ ...f, toFundId: v })} /></Field>
      ) : (
        <Field label={t('common.agent')}><StaffPicker role="COLLECTION_AGENT" branchId={fund.branchId} value={f.toUserId} onChange={(v) => setF({ ...f, toUserId: v })} /></Field>
      )}
      <Field label={t('common.amount')}><input type="number" min="1" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></Field>
      <Field label={t('common.date')}><input type="date" max={today()} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label={t('common.mode')}><ModeSelect value={f.mode} onChange={(v) => setF({ ...f, mode: v })} /></Field>
      <Field label={t('common.notes')}><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
      {to === 'agent' && <div className="full muted">{t('fund.floatHelp')}</div>}
    </FormModal>
  );
}

function FundTxns({ fund, onClose }: { fund: Fund; onClose: () => void }) {
  const { t } = useTranslation();
  const { data, error } = useLoad(() => get<Txn[]>(`/funds/${fund.id}/transactions`), [fund.id]);
  return (
    <Modal wide title={`${fund.name}: ${t('fund.transactions')}`} onClose={onClose} actions={<button className="btn" onClick={onClose}>{t('common.close')}</button>}>
      <ErrorBox error={error} />
      <DataTable
        title={`${fund.name} ${t('fund.transactions')}`}
        rows={data}
        columns={[
          { key: 'date', label: t('common.date'), value: (x) => dateIN(x.date) },
          { key: 'type', label: t('daybook.direction'), value: (x) => t(`fund.txnTypes.${x.type}`, { defaultValue: x.type }) },
          { key: 'amount', label: t('common.amount'), money: true },
          { key: 'balance', label: t('fund.balance'), money: true },
          { key: 'note', label: t('common.notes') },
          { key: 'createdAt', label: t('audit.time'), value: (x) => dateTime(x.createdAt) },
        ]}
      />
    </Modal>
  );
}
