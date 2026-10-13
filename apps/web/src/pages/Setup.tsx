import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChartColumn, Pencil, Plus, Route as RouteIcon } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AreaForm, BranchForm, type AreaDraft, type BranchDraft } from '../components/structureForms';
import { BranchPicker } from '../components/pickers';
import { Badge, ErrorBox, Loading } from '../components/ui';
import { get } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLoad } from '../lib/hooks';
import { RouteForm } from './Routes';

interface TreeRoute { id: string; name: string; active: boolean; collectionDays: number[]; customerCount: number; noCustomers: boolean }
interface TreeArea extends AreaDraft { id: string; name: string; active: boolean; routeCount: number; customerCount: number; noRoute: boolean; routes: TreeRoute[] }
interface TreeBranch extends BranchDraft { id: string; name: string; code: string; active: boolean; areas: TreeArea[] }
interface Tree { branches: TreeBranch[]; warnings: { areasWithoutRoute: number; routesWithoutCustomers: number } }

/** The setup view: branches, their areas and the routes in each area, with counts, and the places that need attention. */
export default function Setup() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const [branchId, setBranchId] = useState('');
  const tree = useLoad(() => get<Tree>('/structure/tree', { branchId }), [branchId]);
  const [branch, setBranch] = useState<BranchDraft | null>(null);
  const [area, setArea] = useState<AreaDraft | null>(null);
  // A new route starts with its area already chosen.
  const [route, setRoute] = useState<{ branchId: string; locationId: string; locations: { id: string; name: string }[] } | null>(null);
  const canBranch = can('branch.manage');
  const canRoute = can('route.manage');
  const canArea = canBranch || canRoute;
  const reload = () => void tree.reload();

  return (
    <div>
      <div className="page-head">
        <h1>{t('structure.title')}</h1>
        <div className="row">
          <BranchPicker value={branchId} onChange={setBranchId} allowAll />
          {can('report.view') && (
            <Link className="btn" to="/areas"><ChartColumn size={16} /> {t('structure.tracking')}</Link>
          )}
          {canBranch && <button className="btn primary" onClick={() => setBranch({ active: true })}>{t('branch.new')}</button>}
        </div>
      </div>
      <p className="muted">{t('structure.intro')}</p>
      <ErrorBox error={tree.error} />
      {!tree.data && !tree.error && <Loading />}
      {tree.data && (
        <>
          {tree.data.warnings.areasWithoutRoute + tree.data.warnings.routesWithoutCustomers > 0 ? (
            <div className="warn-box" role="status">
              <AlertTriangle />
              <span>{t('structure.warnings', { areas: tree.data.warnings.areasWithoutRoute, routes: tree.data.warnings.routesWithoutCustomers })}</span>
            </div>
          ) : (
            <div className="muted" style={{ marginBottom: 12 }}>{t('structure.noWarnings')}</div>
          )}
          {tree.data.branches.map((b) => {
            const routeIds = new Set(b.areas.flatMap((a) => a.routes.map((r) => r.id)));
            const customers = b.areas.reduce((s, a) => s + a.customerCount, 0);
            return (
              <div className="card" key={b.id}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <h2 style={{ margin: 0 }}>{b.name}</h2>
                  <span className="muted">{b.code}</span>
                  {!b.active && <Badge>{t('common.inactive')}</Badge>}
                  <span className="spacer" />
                  {canBranch && <button className="btn small" onClick={() => setBranch(b)}><Pencil size={14} /> {t('common.edit')}</button>}
                  {canArea && <button className="btn small" onClick={() => setArea({ branchId: b.id, active: true })}><Plus size={14} /> {t('structure.addArea')}</button>}
                </div>
                <div className="muted" style={{ marginBottom: 10 }}>
                  {t('structure.counts', { areas: b.areas.length, routes: routeIds.size, customers })}
                </div>
                {!b.areas.length && <div className="muted">{t('structure.noAreas')}</div>}
                {b.areas.map((a) => (
                  <div key={a.id} style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 12, marginTop: 10, opacity: a.active ? 1 : 0.7 }}>
                    <div className="row">
                      <strong>{a.name}</strong>
                      {!a.active && <Badge>{t('structure.inactive')}</Badge>}
                      {a.noRoute && <Badge tone="warn">{t('structure.noRoute')}</Badge>}
                      <span className="spacer" />
                      <span className="muted">{t('areas.routes')}: {a.routeCount} · {t('areas.customers')}: {a.customerCount}</span>
                      {canArea && <button className="btn small" onClick={() => setArea(a)}><Pencil size={14} /> {t('common.edit')}</button>}
                      {canRoute && (
                        <button className="btn small" onClick={() => setRoute({ branchId: b.id, locationId: a.id, locations: [{ id: a.id, name: a.name }] })}>
                          <Plus size={14} /> {t('structure.addRoute')}
                        </button>
                      )}
                    </div>
                    {!a.routes.length && <div className="muted" style={{ marginTop: 6 }}>{t('structure.noRoute')}</div>}
                    {a.routes.map((r) => (
                      <div key={r.id} className="row" style={{ marginTop: 8, paddingLeft: 12 }}>
                        <RouteIcon size={15} />
                        <Link to={`/routes/${r.id}`}>{r.name}</Link>
                        {!r.active && <Badge>{t('structure.inactive')}</Badge>}
                        {r.noCustomers && <Badge tone="warn">{t('structure.noCustomers')}</Badge>}
                        <span className="spacer" />
                        <span className="muted">{t('areas.customers')}: {r.customerCount}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            );
          })}
        </>
      )}
      {branch && <BranchForm branch={branch} onClose={() => setBranch(null)} onSaved={reload} />}
      {area && <AreaForm area={area} onClose={() => setArea(null)} onSaved={reload} />}
      {route && <RouteForm route={route} onClose={() => setRoute(null)} onSaved={reload} />}
    </div>
  );
}
