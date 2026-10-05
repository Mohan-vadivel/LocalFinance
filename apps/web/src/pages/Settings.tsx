import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, type TenantSettings } from '@localfinance/shared';
import { DataTable, ErrorBox, Field, Loading, useToast } from '../components/ui';
import { get, post, put } from '../lib/api';
import { useAuth } from '../lib/auth';
import { dateIN, dateTime, today } from '../lib/format';
import { useLoad } from '../lib/hooks';

interface SettingsData { id: string; name: string; logoUrl: string | null; status: string; supportAccessUntil: string | null; settings: TenantSettings }

export default function Settings() {
  const { t } = useTranslation();
  const toast = useToast();
  const { reload: reloadProfile } = useAuth();
  const { data, error, reload } = useLoad(() => get<SettingsData>('/settings'), []);
  const [f, setF] = useState<{ name: string; logoUrl: string; s: TenantSettings } | null>(null);
  const [holiday, setHoliday] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [days, setDays] = useState('3');
  useEffect(() => {
    if (data) setF({ name: data.name, logoUrl: data.logoUrl ?? '', s: data.settings });
  }, [data]);
  if (error) return <ErrorBox error={error} />;
  if (!f || !data) return <Loading />;
  const s = f.s;
  const setS = (patch: Partial<TenantSettings>) => setF({ ...f, s: { ...s, ...patch } });

  const save = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      await put('/settings', { name: f.name, logoUrl: f.logoUrl || null, settings: s });
      toast(t('common.saved'));
      void reload();
      void reloadProfile();
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };
  const support = async (n: number) => {
    setSaveError(null);
    try {
      await post('/settings/support-access', { days: n });
      toast(t('common.saved'));
      void reload();
    } catch (e) {
      setSaveError(e);
    }
  };

  const backup = async () => {
    setBusy(true);
    setSaveError(null);
    try {
      const file = await get<unknown>('/settings/backup');
      const url = URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `localfinance-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setSaveError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="page-head">
        <h1>{t('settings.title')}</h1>
        <button className="btn primary" onClick={() => void save()} disabled={busy}>{busy ? t('common.loading') : t('common.save')}</button>
      </div>
      <ErrorBox error={saveError} />
      <div className="card">
        <div className="form">
          <Field label={t('common.name')}><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label={`${t('settings.logo')} (URL)`}><input value={f.logoUrl} onChange={(e) => setF({ ...f, logoUrl: e.target.value })} placeholder="https://" /></Field>
          <Field label={t('settings.defaultLanguage')}>
            <select value={s.defaultLanguage} onChange={(e) => setS({ defaultLanguage: e.target.value })}>
              {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.nativeName}</option>)}
            </select>
          </Field>
          <Field label={t('settings.fyStart')}>
            <select value={s.financialYearStartMonth} onChange={(e) => setS({ financialYearStartMonth: Number(e.target.value) })}>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => <option key={m} value={m}>{new Date(2000, m - 1, 1).toLocaleString('en-IN', { month: 'long' })}</option>)}
            </select>
          </Field>
          <Field label={t('settings.paymentOrder')}>
            <select value={s.paymentOrder} onChange={(e) => setS({ paymentOrder: e.target.value as TenantSettings['paymentOrder'] })}>
              {['PENALTY_FIRST', 'PENALTY_LAST'].map((o) => <option key={o} value={o}>{t(`settings.paymentOrders.${o}`)}</option>)}
            </select>
          </Field>
          <Field label={t('settings.plBasis')}>
            <select value={s.plBasis} onChange={(e) => setS({ plBasis: e.target.value as TenantSettings['plBasis'] })}>
              {['CASH', 'ACCRUAL'].map((o) => <option key={o} value={o}>{t(`pl.bases.${o}`)}</option>)}
            </select>
          </Field>
          <Field label={t('settings.geoCheck')}><input type="number" min="0" value={s.geoCheckMetres} onChange={(e) => setS({ geoCheckMetres: Number(e.target.value) })} /></Field>
          <Field label={t('settings.receiptFooter')} full><input maxLength={300} value={s.receiptFooter} onChange={(e) => setS({ receiptFooter: e.target.value })} /></Field>
          <Field label={t('settings.workingDays')} full>
            <div className="row">
              {[1, 2, 3, 4, 5, 6, 0].map((d) => (
                <label key={d} className="field inline">
                  <input type="checkbox" checked={s.workingDays.includes(d)} onChange={(e) => setS({ workingDays: e.target.checked ? [...s.workingDays, d] : s.workingDays.filter((x) => x !== d) })} />
                  {t(`weekdays.${d}`)}
                </label>
              ))}
            </div>
          </Field>
          <Field label={t('settings.holidays')} full>
            <div className="row">
              <input type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} />
              <button type="button" className="btn small" disabled={!holiday || s.holidays.includes(holiday)} onClick={() => { setS({ holidays: [...s.holidays, holiday].sort() }); setHoliday(''); }}>{t('common.create')}</button>
              {s.holidays.map((h) => (
                <span key={h} className="badge">
                  {dateIN(h)}{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); setS({ holidays: s.holidays.filter((x) => x !== h) }); }}>×</a>
                </span>
              ))}
            </div>
          </Field>
        </div>
        <p className="muted">{t('settings.holidayHelp')}</p>
      </div>
      <div className="card">
        <h3>{t('settings.smsTemplates')}</h3>
        <p className="muted">{t('settings.smsHelp')}</p>
        <div className="form">
          {['collection', 'disbursement', 'reminder'].map((k) => (
            <Field key={k} label={t(`settings.sms.${k}`)} full>
              <textarea rows={2} placeholder={t(`sms.${k}`)} value={s.smsTemplates[k] ?? ''} onChange={(e) => setS({ smsTemplates: { ...s.smsTemplates, [k]: e.target.value } })} />
            </Field>
          ))}
        </div>
      </div>
      <div className="card">
        <h3>{t('settings.supportAccess')}</h3>
        <p className="muted">{t('settings.supportHelp')}</p>
        <div className="row">
          <span>{data.supportAccessUntil && new Date(data.supportAccessUntil) > new Date() ? `${t('settings.supportUntil')} ${dateTime(data.supportAccessUntil)}` : t('settings.supportOff')}</span>
          <span className="spacer" />
          <input type="number" min="1" max="30" value={days} onChange={(e) => setDays(e.target.value)} style={{ width: 80 }} />
          <button className="btn" onClick={() => void support(Number(days))}>{t('settings.grantSupport')}</button>
          {data.supportAccessUntil && <button className="btn" onClick={() => void support(0)}>{t('settings.revokeSupport')}</button>}
        </div>
      </div>
      <div className="card">
        <h3>{t('settings.backup')}</h3>
        <p className="muted">{t('settings.backupHelp')}</p>
        <button className="btn" disabled={busy} onClick={() => void backup()}>{t('settings.downloadBackup')}</button>
      </div>
    </div>
  );
}

export function Audit() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState('');
  const [page, setPage] = useState(1);
  const { data, error } = useLoad(() => get<{ total: number; rows: { id: string; createdAt: string; userName?: string; action: string; entity: string; entityId: string | null; before: unknown; after: unknown; ip?: string | null }[] }>('/audit', { entity, page }), [entity, page]);
  const pages = data ? Math.max(1, Math.ceil(data.total / 100)) : 1;
  return (
    <div>
      <div className="page-head">
        <h1>{t('audit.title')}</h1>
        <select value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {['Customer', 'Loan', 'Collection', 'User', 'Role', 'Fund', 'Investment', 'Investor', 'DaybookEntry', 'DayClose', 'Handover', 'LoanProduct', 'Settings', 'Branch', 'Location', 'Route', 'Tenant'].map((e) => <option key={e} value={e}>{e}</option>)}
        </select>
      </div>
      <ErrorBox error={error} />
      <div className="card">
        <DataTable
          title={t('audit.title')}
          rows={data?.rows}
          columns={[
            { key: 'createdAt', label: t('audit.time'), value: (r) => dateTime(r.createdAt) },
            { key: 'userName', label: t('audit.actor') },
            { key: 'action', label: t('audit.action') },
            { key: 'entity', label: t('audit.entity'), value: (r) => `${r.entity} ${r.entityId ? r.entityId.slice(-8) : ''}` },
            { key: 'after', label: t('audit.details'), value: (r) => (r.after ? JSON.stringify(r.after).slice(0, 300) : ''), render: (r) => <code style={{ fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{r.after ? JSON.stringify(r.after).slice(0, 300) : ''}</code> },
          ]}
        />
        {pages > 1 && (
          <div className="row no-print" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t('common.back')}</button>
            <span>{page} / {pages}</span>
            <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t('common.next')}</button>
          </div>
        )}
      </div>
    </div>
  );
}
