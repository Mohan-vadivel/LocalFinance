import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyRound, LogOut, Pencil, Smartphone } from 'lucide-react';
import { LANGUAGES, PERMISSIONS, ROLES, type Permission } from '@localfinance/shared';
import { BranchPicker, clearLookups } from '../components/pickers';
import { Badge, DataTable, ErrorBox, Field, FormModal, Modal, useToast, RowActions } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateTime, toPaise, toRupeesInput } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface Role { id: string; name: string; baseRole: string; permissions: Permission[]; system: boolean; _count?: { users: number } }
interface StaffMember {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  approvalLimit: number;
  language: string;
  idProof: string | null;
  active: boolean;
  deviceId: string | null;
  lastSeenAt: string | null;
  role: { id: string; name: string; baseRole: string };
  branches: { branchId: string; branch: { name: string } }[];
}

function StaffForm({ staff, roles, onClose, onSaved }: { staff: Partial<StaffMember>; roles: Role[]; onClose: () => void; onSaved: (tempPassword?: string) => void }) {
  const { t } = useTranslation();
  const { data: branches } = useLoad(() => get<{ id: string; name: string }[]>('/branches'), []);
  const [f, setF] = useState({
    name: staff.name ?? '',
    phone: staff.phone ?? '',
    email: staff.email ?? '',
    password: '',
    roleId: staff.role?.id ?? '',
    branchIds: staff.branches?.map((b) => b.branchId) ?? [],
    approvalLimit: toRupeesInput(staff.approvalLimit ?? 0),
    language: staff.language ?? 'en',
    idProof: staff.idProof ?? '',
    active: staff.active ?? true,
  });
  return (
    <FormModal
      title={staff.id ? `${t('common.edit')}: ${staff.name}` : t('staff.new')}
      onClose={onClose}
      onSubmit={async () => {
        const body = {
          name: f.name,
          phone: f.phone,
          email: f.email || null,
          password: f.password || undefined,
          roleId: f.roleId,
          branchIds: f.branchIds,
          approvalLimit: toPaise(f.approvalLimit),
          language: f.language,
          idProof: f.idProof || null,
          active: f.active,
        };
        const r = staff.id ? await put<{ temporaryPassword?: string }>(`/staff/${staff.id}`, body) : await post<{ temporaryPassword?: string }>('/staff', body);
        clearLookups();
        onSaved(r.temporaryPassword);
      }}
    >
      <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('common.phone')}><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label={t('auth.password')}>
        <input type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} placeholder={staff.id ? t('staff.passwordKeep') : t('staff.passwordAuto')} autoComplete="new-password" />
      </Field>
      <Field label={t('staff.role')}>
        <select value={f.roleId} onChange={(e) => setF({ ...f, roleId: e.target.value })}>
          <option value="">{t('staff.role')}</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      </Field>
      <Field label={t('staff.approvalLimit')}><input type="number" min="0" value={f.approvalLimit} onChange={(e) => setF({ ...f, approvalLimit: e.target.value })} /></Field>
      <Field label={t('common.language')}>
        <select value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
          {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
        </select>
      </Field>
      <Field label={t('investor.idProof')}><input value={f.idProof} onChange={(e) => setF({ ...f, idProof: e.target.value })} /></Field>
      <Field label={t('common.status')}>
        <select value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}>
          <option value="1">{t('common.active')}</option>
          <option value="0">{t('common.inactive')}</option>
        </select>
      </Field>
      <Field label={t('staff.branches')} full>
        <div className="row">
          {(branches ?? []).map((b) => (
            <label key={b.id} className="field inline">
              <input type="checkbox" checked={f.branchIds.includes(b.id)} onChange={(e) => setF({ ...f, branchIds: e.target.checked ? [...f.branchIds, b.id] : f.branchIds.filter((x) => x !== b.id) })} />
              {b.name}
            </label>
          ))}
        </div>
      </Field>
    </FormModal>
  );
}

export default function Staff() {
  const { t } = useTranslation();
  const toast = useToast();
  const [branchId, setBranchId] = useState('');
  const { data, error, reload } = useLoad(() => get<StaffMember[]>('/staff', { branchId }), [branchId]);
  const roles = useLoad(() => get<Role[]>('/roles'), []);
  const [editing, setEditing] = useState<Partial<StaffMember> | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);

  const act = async (s: StaffMember, action: 'reset-password' | 'reset-device' | 'force-logout') => {
    if (!window.confirm(`${t(`staff.${action === 'reset-password' ? 'resetPassword' : action === 'reset-device' ? 'resetDevice' : 'forceLogout'}`)}: ${s.name}?`)) return;
    setActionError(null);
    try {
      const r = await post<{ temporaryPassword?: string }>(`/staff/${s.id}/${action}`);
      if (r.temporaryPassword) setPassword(r.temporaryPassword);
      else toast(t('common.saved'));
      void reload();
    } catch (e) {
      setActionError(e);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('staff.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
          <button className="btn primary" onClick={() => setEditing({})}>{t('staff.new')}</button>
        </div>
      </div>
      <ErrorBox error={error ?? actionError} />
      <div className="card">
        <DataTable
          title={t('staff.title')}
          rows={data}
          empty={branchId ? t('empty.noMatch') : { message: t('empty.staff'), action: { label: t('empty.firstStaff'), onClick: () => setEditing({}) } }}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'phone', label: t('common.phone') },
            { key: 'role', label: t('staff.role'), value: (s) => s.role.name },
            { key: 'branches', label: t('staff.branches'), value: (s) => s.branches.map((b) => b.branch.name).join(', ') },
            { key: 'approvalLimit', label: t('staff.approvalLimit'), money: true },
            { key: 'lastSeenAt', label: t('staff.lastSeen'), value: (s) => dateTime(s.lastSeenAt) },
            { key: 'device', label: t('staff.device'), value: (s) => (s.deviceId ? t('common.yes') : t('common.no')) },
            { key: 'active', label: t('common.status'), value: (s) => (s.active ? t('common.active') : t('common.inactive')), render: (s) => <Badge tone={s.active ? 'ok' : 'danger'}>{s.active ? t('common.active') : t('common.inactive')}</Badge> },
            {
              key: 'actions',
              label: t('common.actions'),
              value: () => '',
              render: (s) => (
                <RowActions
                  actions={[
                    { icon: Pencil, label: t('common.edit'), onClick: () => setEditing(s) },
                    { icon: KeyRound, label: t('staff.resetPassword'), onClick: () => void act(s, 'reset-password') },
                    { icon: Smartphone, label: t('staff.resetDevice'), onClick: () => void act(s, 'reset-device'), hidden: !s.deviceId },
                    { icon: LogOut, label: t('staff.forceLogout'), tone: 'danger', onClick: () => void act(s, 'force-logout') },
                  ]}
                />
              ),
            },
          ]}
        />
      </div>
      {editing && (
        <StaffForm
          staff={editing}
          roles={roles.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={(p) => {
            if (p) setPassword(p);
            else toast(t('common.saved'));
            void reload();
          }}
        />
      )}
      {password && (
        <Modal title={t('staff.temporaryPassword')} onClose={() => setPassword(null)} actions={<button className="btn primary" onClick={() => setPassword(null)}>{t('common.close')}</button>}>
          <p>{t('staff.temporaryPasswordHelp')}</p>
          <p style={{ fontSize: 22, fontWeight: 700, fontFamily: 'monospace' }}>{password}</p>
        </Modal>
      )}
    </div>
  );
}

function RoleForm({ role, onClose, onSaved }: { role: Partial<Role>; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [f, setF] = useState({ name: role.name ?? '', baseRole: role.baseRole ?? 'LOAN_OFFICER', permissions: role.permissions ?? ([] as Permission[]) });
  const choices = PERMISSIONS.filter((p) => p !== 'tenant.manage');
  return (
    <FormModal
      wide
      title={role.id ? `${t('common.edit')}: ${role.name}` : t('role.new')}
      onClose={onClose}
      onSubmit={async () => {
        if (role.id) await put(`/roles/${role.id}`, f);
        else await post('/roles', f);
        onSaved();
      }}
    >
      <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label={t('role.baseRole')}>
        <select value={f.baseRole} disabled={role.system} onChange={(e) => setF({ ...f, baseRole: e.target.value })}>
          {ROLES.filter((r) => r !== 'SUPER_ADMIN' && (r !== 'TENANT_ADMIN' || profile?.role === 'TENANT_ADMIN')).map((r) => (
            <option key={r} value={r}>{t(`roles.${r}`)}</option>
          ))}
        </select>
      </Field>
      <Field label={t('role.permissions')} full>
        <div className="grid c3">
          {choices.map((p) => (
            <label key={p} className="field inline" style={{ fontWeight: 400, color: 'var(--ink)' }}>
              <input type="checkbox" checked={f.permissions.includes(p)} onChange={(e) => setF({ ...f, permissions: e.target.checked ? [...f.permissions, p] : f.permissions.filter((x) => x !== p) })} />
              {t(`permissions.${p}`)}
            </label>
          ))}
        </div>
      </Field>
    </FormModal>
  );
}

export function Roles() {
  const { t } = useTranslation();
  const toast = useToast();
  const { data, error, reload } = useLoad(() => get<Role[]>('/roles'), []);
  const [editing, setEditing] = useState<Partial<Role> | null>(null);
  return (
    <div>
      <div className="page-head">
        <h1>{t('role.title')}</h1>
        <button className="btn primary" onClick={() => setEditing({})}>{t('role.new')}</button>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('role.title')}
          rows={data}
          onRow={(r) => setEditing(r)}
          actions={(r) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setEditing(r) }]}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'baseRole', label: t('role.baseRole'), value: (r) => t(`roles.${r.baseRole}`) },
            { key: 'users', label: t('staff.title'), num: true, value: (r) => r._count?.users ?? 0 },
            { key: 'permissions', label: t('role.permissions'), value: (r) => r.permissions.map((p) => t(`permissions.${p}`)).join(', ') },
          ]}
        />
      </div>
      {editing && <RoleForm role={editing} onClose={() => setEditing(null)} onSaved={() => { toast(t('common.saved')); void reload(); }} />}
    </div>
  );
}

