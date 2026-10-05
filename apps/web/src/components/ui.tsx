import { createContext, useContext, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { CircleAlert, CircleCheck, FileSpreadsheet, Inbox, LoaderCircle, Printer, X } from 'lucide-react';
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
      {msg && (
        <div className="toast" role="status">
          <CircleCheck aria-hidden />
          <span>{msg}</span>
        </div>
      )}
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
      <div className="notice">
        <CircleAlert aria-hidden />
        <div>{text}</div>
      </div>
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
  const { t } = useTranslation();
  return (
    <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={wide ? { width: 'min(1000px, 100%)' } : undefined} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn ghost" onClick={onClose} aria-label={t('common.close')}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
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

/** `icon` and `tone` are optional: they add a small tinted icon chip next to the label. */
export function Stat({ label, value, sub, icon, tone }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'info' }) {
  return (
    <div className="stat">
      <div className="top">
        <div className="label">{label}</div>
        {icon && <span className={`chip-icon sm ${tone ?? ''}`}>{icon}</span>}
      </div>
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
// ---------- Row action icons ----------
export interface RowAction {
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  label: string;
  onClick: () => void;
  tone?: 'danger' | 'primary';
  hidden?: boolean;
  disabled?: boolean;
}

/** A square icon button for one action on a row; the label shows as a tooltip and is read by screen readers. */
export function IconBtn({ icon: Icon, label, onClick, tone, disabled }: Omit<RowAction, 'hidden'>) {
  return (
    <button
      type="button"
      className={`icon-btn row-act ${tone ?? ''}`}
      aria-label={label}
      data-tip={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <Icon aria-hidden />
    </button>
  );
}

export function RowActions({ actions }: { actions: RowAction[] }) {
  return (
    <div className="row-actions no-print">
      {actions.filter((a) => !a.hidden).map((a) => <IconBtn key={a.label} {...a} />)}
    </div>
  );
}

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

export function DataTable<T extends object>({ rows, columns: cols, title, empty, onRow, actions }: { rows: T[] | null | undefined; columns: Column<T>[]; title?: string; empty?: string; onRow?: (row: T) => void; actions?: (row: T) => RowAction[] }) {
  const { t } = useTranslation();
  const list = rows ?? [];
  const columns: Column<T>[] = actions ? [...cols, { key: '__actions', label: t('common.actions'), render: (r) => <RowActions actions={actions(r)} /> }] : cols;
  const raw = (r: T, c: Column<T>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const exportExcel = () => {
    const data = list.map((r) =>
      Object.fromEntries(cols.filter((c) => c.key !== 'actions').map((c) => {
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
      <div className="dt-toolbar no-print">
        {title && <h3>{title}</h3>}
        <span className="count-pill">{list.length}</span>
        <span className="spacer" />
        <button className="btn small" onClick={exportExcel} disabled={!list.length}>
          <FileSpreadsheet aria-hidden />
          {t('common.exportExcel')}
        </button>
        <button className="btn small" onClick={() => window.print()} disabled={!list.length}>
          <Printer aria-hidden />
          {t('common.exportPdf')}
        </button>
      </div>
      {title && <h3 className="print-only">{title}</h3>}
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key} className={c.money || c.num ? 'num' : c.key === '__actions' || c.key === 'actions' ? 'actions-col no-print' : ''}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r, i) => (
              <tr key={(r as { id?: string }).id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'clickable' : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={c.money || c.num ? 'num' : c.key === '__actions' || c.key === 'actions' ? 'actions-col no-print' : ''}>
                    {c.render ? c.render(r) : c.money ? money(raw(r, c) as number) : String(raw(r, c) ?? '')}
                  </td>
                ))}
              </tr>
            ))}
            {!list.length && (
              <tr>
                <td colSpan={columns.length} className="empty">
                  <div className="empty-state">
                    <span className="ico">
                      <Inbox aria-hidden />
                    </span>
                    <span>{empty ?? t('common.noData')}</span>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {hasTotals && list.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={c.money || c.num ? 'num' : c.key === '__actions' || c.key === 'actions' ? 'actions-col no-print' : ''}>
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
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spinner" aria-hidden />
      <span>{t('common.loading')}</span>
    </div>
  );
}

export function Money({ v }: { v: number | null | undefined }) {
  return <>{money(v)}</>;
}
