import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Ban, CircleCheck, Eye, Pencil } from 'lucide-react';
import { DataTable, ErrorBox, Field, FormModal, Stat, statusTone, Badge, RowActions } from '../components/ui';
import { get, patch, post, setSupportTenant } from '../lib/api';
import { dateIN } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Tenant {
  id: string;
  name: string;
  businessId: string | null;
  plan: string;
  status: string;
  maxBranches: number;
  maxStaff: number;
  maxActiveLoans: number;
  supportAccessUntil: string | null;
  createdAt: string;
  usage: { branches: number; staff: number; activeLoans: number; customers: number };
}

export default function Tenants() {
  const { t } = useTranslation();
  const list = useLoad(() => get<Tenant[]>('/platform/tenants'), []);
  const stats = useLoad(() => get<Record<string, number>>('/platform/tenants/stats'), []);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Tenant | null>(null);
  const [f, setF] = useState({ name: '', businessId: '', ownerName: '', ownerPhone: '', ownerEmail: '', ownerPassword: '', plan: 'STANDARD', maxBranches: 10, maxStaff: 100, maxActiveLoans: 50000 });
  const [error, setError] = useState<unknown>(null);

  const setStatus = async (tn: Tenant, status: string) => {
    try {
      await patch(`/platform/tenants/${tn.id}`, { status });
      await list.reload();
    } catch (e) {
      setError(e);
    }
  };
  const open = (tn: Tenant) => {
    setSupportTenant(tn.id);
    window.location.href = '/';
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('tenant.title')}</h1>
        <button className="btn primary" onClick={() => setCreating(true)}>
          {t('tenant.new')}
        </button>
      </div>
      <ErrorBox error={error ?? list.error} />
      {stats.data && (
        <div className="grid k4" style={{ marginBottom: 16 }}>
          <Stat label={t('tenant.title')} value={`${stats.data.activeTenants} / ${stats.data.tenants}`} />
          <Stat label={t('nav.staff')} value={stats.data.staff} />
          <Stat label={t('nav.customers')} value={stats.data.customers} />
          <Stat label={t('dashboard.activeLoans')} value={stats.data.activeLoans} />
        </div>
      )}
      <div className="card">
        <DataTable
          rows={list.data}
          title={t('tenant.title')}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'plan', label: t('tenant.plan') },
            { key: 'status', label: t('common.status'), render: (r) => <Badge tone={statusTone(r.status)}>{t(`tenant.statuses.${r.status}`)}</Badge> },
            { key: 'branches', label: t('nav.branches'), value: (r) => `${r.usage.branches}/${r.maxBranches}` },
            { key: 'staff', label: t('nav.staff'), value: (r) => `${r.usage.staff}/${r.maxStaff}` },
            { key: 'loans', label: t('dashboard.activeLoans'), value: (r) => `${r.usage.activeLoans}/${r.maxActiveLoans}` },
            { key: 'createdAt', label: t('common.date'), value: (r) => dateIN(r.createdAt) },
            {
              key: 'actions',
              label: t('common.actions'),
              value: () => '',
              render: (r) => (
                <RowActions
                  actions={[
                    { icon: Eye, label: t('common.view'), onClick: () => open(r), hidden: !(r.supportAccessUntil && new Date(r.supportAccessUntil) > new Date()) },
                    { icon: Pencil, label: t('common.edit'), onClick: () => setEditing(r) },
                    r.status === 'ACTIVE'
                      ? { icon: Ban, label: t('tenant.suspend'), tone: 'danger', onClick: () => void setStatus(r, 'SUSPENDED') }
                      : { icon: CircleCheck, label: t('tenant.activate'), tone: 'primary', onClick: () => void setStatus(r, 'ACTIVE') },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
      {creating && (
        <FormModal
          title={t('tenant.new')}
          onClose={() => setCreating(false)}
          onSubmit={async () => {
            await post('/platform/tenants', { ...f, businessId: f.businessId || undefined, ownerEmail: f.ownerEmail || undefined });
            await list.reload();
          }}
        >
          <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={t('tenant.businessId')}><input value={f.businessId} onChange={(e) => setF({ ...f, businessId: e.target.value })} /></Field>
          <Field label={t('tenant.ownerName')}><input value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
          <Field label={t('tenant.ownerPhone')}><input value={f.ownerPhone} onChange={(e) => setF({ ...f, ownerPhone: e.target.value })} /></Field>
          <Field label={t('tenant.ownerEmail')}><input value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          <Field label={t('tenant.ownerPassword')}><input type="password" value={f.ownerPassword} onChange={(e) => setF({ ...f, ownerPassword: e.target.value })} /></Field>
          <Field label={t('tenant.plan')}><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
          <Field label={t('tenant.maxBranches')}><input type="number" value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: Number(e.target.value) })} /></Field>
          <Field label={t('tenant.maxStaff')}><input type="number" value={f.maxStaff} onChange={(e) => setF({ ...f, maxStaff: Number(e.target.value) })} /></Field>
          <Field label={t('tenant.maxActiveLoans')}><input type="number" value={f.maxActiveLoans} onChange={(e) => setF({ ...f, maxActiveLoans: Number(e.target.value) })} /></Field>
        </FormModal>
      )}
      {editing && (
        <TenantEdit
          tenant={editing}
          onClose={() => setEditing(null)}
          onSaved={() => void list.reload()}
        />
      )}
    </div>
  );
}

function TenantEdit({ tenant, onClose, onSaved }: { tenant: Tenant; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ name: tenant.name, plan: tenant.plan, maxBranches: tenant.maxBranches, maxStaff: tenant.maxStaff, maxActiveLoans: tenant.maxActiveLoans });
  return (
    <FormModal
      title={`${t('common.edit')}: ${tenant.name}`}
      onClose={onClose}
      onSubmit={async () => {
        await patch(`/platform/tenants/${tenant.id}`, f);
        onSaved();
      }}
    >
      <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('tenant.plan')}><input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></Field>
      <Field label={t('tenant.maxBranches')}><input type="number" value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: Number(e.target.value) })} /></Field>
      <Field label={t('tenant.maxStaff')}><input type="number" value={f.maxStaff} onChange={(e) => setF({ ...f, maxStaff: Number(e.target.value) })} /></Field>
      <Field label={t('tenant.maxActiveLoans')}><input type="number" value={f.maxActiveLoans} onChange={(e) => setF({ ...f, maxActiveLoans: Number(e.target.value) })} /></Field>
    </FormModal>
  );
}
