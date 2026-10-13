import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil } from 'lucide-react';
import { AreaDraft, AreaForm, BranchDraft, BranchForm } from '../components/structureForms';
import { Badge, DataTable, ErrorBox } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';

interface Branch { id: string; name: string; code: string; address: string | null; lat: number | null; lng: number | null; active: boolean; availableFund: number; _count: { locations: number } }
interface Location { id: string; branchId: string; name: string; lat: number | null; lng: number | null; notes: string | null; active: boolean; branch: { name: string }; _count: { routes: number } }

export default function Branches() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const branches = useLoad(() => get<Branch[]>('/branches'), []);
  const locations = useLoad(() => get<Location[]>('/locations'), []);
  const [branch, setBranch] = useState<BranchDraft | null>(null);
  const [loc, setLoc] = useState<AreaDraft | null>(null);

  return (
    <div>
      <div className="page-head">
        <h1>{t('branch.title')}</h1>
        <div className="row">
          {can('branch.manage') && <button className="btn primary" onClick={() => setBranch({ active: true })}>{t('branch.new')}</button>}
          <button className="btn" onClick={() => setLoc({ active: true })}>{t('locationMod.new')}</button>
        </div>
      </div>
      <ErrorBox error={branches.error ?? locations.error} />
      <div className="card">
        <DataTable
          title={t('branch.title')}
          rows={branches.data}
          empty={{ message: t('empty.branches'), action: can('branch.manage') ? { label: t('empty.firstBranch'), onClick: () => setBranch({ active: true }) } : undefined }}
          onRow={can('branch.manage') ? (r) => setBranch(r) : undefined}
          actions={can('branch.manage') ? (r) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setBranch(r) }] : undefined}
          columns={[
            { key: 'code', label: t('branch.code') },
            { key: 'name', label: t('common.name') },
            { key: 'address', label: t('common.address') },
            { key: 'locations', label: t('locationMod.title'), value: (r) => r._count.locations, num: true },
            { key: 'availableFund', label: t('branch.availableFund'), money: true, total: true },
            { key: 'active', label: t('common.status'), render: (r) => <Badge tone={r.active ? 'ok' : undefined}>{r.active ? t('common.active') : t('common.inactive')}</Badge>, value: (r) => (r.active ? t('common.active') : t('common.inactive')) },
          ]}
        />
      </div>
      <div className="card">
        <DataTable
          title={t('locationMod.title')}
          rows={locations.data}
          empty={{ message: t('empty.locations'), action: { label: t('empty.firstLocation'), onClick: () => setLoc({ active: true }) } }}
          onRow={(r) => setLoc(r)}
          actions={(r) => [{ icon: Pencil, label: t('common.edit'), onClick: () => setLoc(r) }]}
          columns={[
            { key: 'name', label: t('common.name') },
            { key: 'branch', label: t('common.branch'), value: (r) => r.branch.name },
            { key: 'routes', label: t('nav.routes'), value: (r) => r._count.routes, num: true },
            { key: 'notes', label: t('common.notes') },
            { key: 'active', label: t('common.status'), value: (r) => (r.active ? t('common.active') : t('common.inactive')) },
          ]}
        />
      </div>
      {branch && <BranchForm branch={branch} onClose={() => setBranch(null)} onSaved={() => void branches.reload()} />}
      {loc && <AreaForm area={loc} onClose={() => setLoc(null)} onSaved={() => void locations.reload()} />}

    </div>
  );
}
