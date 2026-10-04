import { createContext, useContext, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { ApiError } from '../lib/api';
import { money } from '../lib/format';

// ---------- Toast ----------
const ToastCtx = createContext<(msg: string) => void>(() => undefined);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<string | null>(null);
  const show = (m: string) => {
    setMsg(m);
    setTimeout(() => setMsg(null), 3000);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && <div className="toast" role="status">{msg}</div>}
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

// ---------- Errors ----------
/** Shows an API error in the user's language when the server sent a known key. */
export function ErrorBox({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const e = error as ApiError;
  const text = e.code && i18n.exists(e.code) && e.code !== 'errors.validation' ? t(e.code) : e.message;
  return (
    <div className="error-box" role="alert">
      {text}
      {e.fields?.length ? (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {e.fields.map((f) => (
            <li key={f.path}>
              {f.path}: {f.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

// ---------- Form bits ----------
export function Field({ label, children, error, full }: { label: string; children: ReactNode; error?: string; full?: boolean }) {
  return (
    <label className={`field${full ? ' full' : ''}`}>
      <span>{label}</span>
      {children}
      {error && <span className="err">{error}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, actions, wide }: { title: string; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(1000px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <h2>{title}</h2>
        {children}
        {actions && <div className="actions">{actions}</div>}
      </div>
    </div>
  );
}

/** A form inside a modal: handles busy state and errors. */
export function FormModal({ title, onClose, onSubmit, children, submitLabel, wide }: { title: string; onClose: () => void; onSubmit: () => Promise<unknown>; children: ReactNode; submitLabel?: string; wide?: boolean }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={title}
      onClose={onClose}
      wide={wide}
      actions={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy ? t('common.loading') : submitLabel ?? t('common.save')}
          </button>
        </>
      }
    >
      <ErrorBox error={error} />
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'brand' }) {
  return <span className={`badge ${tone ?? ''}`}>{children}</span>;
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.key} role="tab" aria-selected={value === i.key} className={value === i.key ? 'on' : ''} onClick={() => onChange(i.key)}>
          {i.label}
        </button>
      ))}
    </div>
  );
}

export const statusTone = (s: string): 'ok' | 'warn' | 'danger' | 'brand' | undefined =>
  ({ ACTIVE: 'ok', APPROVED: 'brand', REQUESTED: 'warn', SENT_BACK: 'warn', REJECTED: 'danger', WRITTEN_OFF: 'danger', BLACKLISTED: 'danger', SUSPENDED: 'danger', CLOSED: undefined, FORECLOSED: undefined })[s] as never;

// ---------- Data table with Excel and PDF export ----------
export interface Column<T> {
  key: string;
  label: string;
  render?: (row: T) => ReactNode;
  /** Value written to Excel; defaults to row[key]. */
  value?: (row: T) => string | number | null | undefined;
  money?: boolean;
  num?: boolean;
  total?: boolean;
}

export function DataTable<T extends object>({ rows, columns, title, empty, onRow }: { rows: T[] | null | undefined; columns: Column<T>[]; title?: string; empty?: string; onRow?: (row: T) => void }) {
  const { t } = useTranslation();
  const list = rows ?? [];
  const raw = (r: T, c: Column<T>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const exportExcel = () => {
    const data = list.map((r) =>
      Object.fromEntries(columns.map((c) => {
        const v = raw(r, c);
        return [c.label, c.money && typeof v === 'number' ? v / 100 : (v as string | number | null | undefined) ?? ''];
      })),
    );
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, (title ?? 'Report').slice(0, 30));
    XLSX.writeFile(wb, `${(title ?? 'report').replace(/[^\w\- ]+/g, '')}.xlsx`);
  };
  const hasTotals = columns.some((c) => c.total);
  return (
    <div>
      <div className="row no-print" style={{ marginBottom: 8 }}>
        {title && <h3 style={{ margin: 0 }}>{title}</h3>}
        <span className="spacer" />
        <span className="muted">{list.length}</span>
        <button className="btn small" onClick={exportExcel} disabled={!list.length}>
          {t('common.exportExcel')}
        </button>
        <button className="btn small" onClick={() => window.print()} disabled={!list.length}>
          {t('common.exportPdf')}
        </button>
      </div>
      {title && <h3 className="print-only">{title}</h3>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.money || c.num ? 'num' : ''}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={(r as { id?: string }).id ?? i} onClick={onRow ? () => onRow(r) : undefined} style={onRow ? { cursor: 'pointer' } : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.money || c.num ? 'num' : ''}>
                    {c.render ? c.render(r) : c.money ? money(raw(r, c) as number) : String(raw(r, c) ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={columns.length} className="muted" style={{ textAlign: 'center', padding: 24 }}>
                  {empty ?? t('common.noData')}
                </td>
              </tr>
            )}
          </tbody>
          {hasTotals && list.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.money || c.num ? 'num' : ''}>
                    {c.total ? (c.money ? money(list.reduce((s, r) => s + Number(raw(r, c) ?? 0), 0)) : list.reduce((s, r) => s + Number(raw(r, c) ?? 0), 0)) : i === 0 ? t('common.total') : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function Loading() {
  const { t } = useTranslation();
  return <div className="muted" style={{ padding: 16 }}>{t('common.loading')}</div>;
}

export function Money({ v }: { v: number | null | undefined }) {
  return <>{money(v)}</>;
}
