import { createContext, Fragment, useContext, useEffect, useMemo, useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import * as XLSX from 'xlsx';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, CircleAlert, CircleCheck, FileSpreadsheet, Inbox, LoaderCircle, Plus, Printer, Search, X } from 'lucide-react';
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
/** Error codes whose message is replaced by a plainer one, and the next step to suggest. */
const ERROR_TEXT: Record<string, { text?: string; hint?: string }> = {
  'errors.network': { hint: 'errors.hints.network' },
  'errors.notFound': { hint: 'errors.hints.notFound' },
  'errors.dayClosed': { hint: 'errors.hints.dayClosed' },
  'errors.tenantSuspended': { hint: 'errors.hints.tenantSuspended' },
  'errors.forbidden': { hint: 'errors.hints.forbidden' },
  'fund.insufficient': { hint: 'errors.hints.fundInsufficient' },
  'auth.login': { text: 'errors.sessionExpired', hint: 'errors.hints.sessionExpired' },
};

/** Labels for the form fields the API names in validation errors; unknown paths show as sent. */
const FIELD_LABELS: Record<string, string> = {
  name: 'common.name',
  phone: 'common.phone',
  address: 'common.address',
  amount: 'common.amount',
  date: 'common.date',
  mode: 'common.mode',
  note: 'common.notes',
  notes: 'common.notes',
  reason: 'common.reason',
  branchId: 'common.branch',
  locationId: 'common.location',
  routeId: 'common.route',
  productId: 'common.product',
  customerId: 'common.customer',
  loanId: 'common.loan',
  agentId: 'common.agent',
  principal: 'loanMod.principal',
  code: 'branch.code',
  password: 'auth.password',
};

/** Shows an API error in plain words in the user's language, with a next step where there is an obvious one. */
export function ErrorBox({ error }: { error: unknown }) {
  const { t, i18n } = useTranslation();
  if (!error) return null;
  const e = error as ApiError;
  const known = e.code ? ERROR_TEXT[e.code] : undefined;
  const serverFault = !e.code && (e.status ?? 0) >= 500;
  // Validation errors carry a specific English message from the server; other known codes have a translation.
  const text = known?.text
    ? t(known.text)
    : serverFault
      ? t('errors.server')
      : e.code && i18n.exists(e.code) && e.code !== 'errors.validation'
        ? t(e.code)
        : e.fields?.length
          ? t('errors.checkFields')
          : e.message;
  const hint = known?.hint ?? (serverFault ? 'errors.hints.server' : undefined);
  return (
    <div className="error-box" role="alert">
      <div className="notice">
        <CircleAlert aria-hidden />
        <div>
          {text}
          {hint && <div style={{ marginTop: 2, opacity: 0.85 }}>{t(hint)}</div>}
        </div>
      </div>
      {e.fields?.length ? (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {e.fields.map((f) => {
            const label = FIELD_LABELS[f.path.split('.').pop() ?? ''];
            return (
              <li key={f.path}>
                {label ? t(label) : f.path}: {f.message}
              </li>
            );
          })}
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

/** What an empty table says, with an optional button for the obvious next step (e.g. "Create your first branch"). */
export interface EmptyState {
  message: string;
  action?: { label: string; onClick: () => void };
}

const PAGE_SIZES = [10, 25, 50, 100] as const;
const PAGE_SIZE_KEY = 'lf.pageSize';
const savedPageSize = () => {
  try {
    const n = Number(localStorage.getItem(PAGE_SIZE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? n : 25;
  } catch {
    return 25;
  }
};

/** Rows to show while printing: every row, not just the page on screen. */
function usePrinting() {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);
  return printing;
}

/**
 * Page buttons under a table: "Showing 26–50 of 312", rows per page, and first / previous / numbered / next / last.
 * Used by DataTable (pages in the browser) and by the lists the server pages (customers, loans, collections).
 */
export function Pager({ page, pages, total, pageSize, onPage, onPageSize }: { page: number; pages: number; total?: number; pageSize?: number; onPage: (p: number) => void; onPageSize?: (n: number) => void }) {
  const { t } = useTranslation();
  if (pages <= 1 && !onPageSize) return null;
  const nums: (number | '…')[] = [];
  for (let p = 1; p <= pages; p++) {
    if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  const from = pageSize && total !== undefined ? Math.min(total, (page - 1) * pageSize + 1) : null;
  const to = pageSize && total !== undefined ? Math.min(total, page * pageSize) : null;
  return (
    <nav className="pager no-print" aria-label={t('table.pages')}>
      <span className="pager-info">{from !== null && to !== null ? t('table.showing', { from, to, total }) : total !== undefined ? t('table.total', { total }) : null}</span>
      {onPageSize && pageSize && (
        <label className="pager-size">
          <span>{t('table.perPage')}</span>
          <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
            {PAGE_SIZES.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      {pages > 1 && (
        <span className="pager-btns">
          <button type="button" className="pg" disabled={page <= 1} onClick={() => onPage(1)} aria-label={t('table.first')} title={t('table.first')}><ChevronsLeft aria-hidden /></button>
          <button type="button" className="pg" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label={t('table.prev')} title={t('table.prev')}><ChevronLeft aria-hidden /></button>
          {nums.map((n, i) =>
            n === '…' ? <span key={`e${i}`} className="pg-gap">…</span> : (
              <button type="button" key={n} className={`pg num${n === page ? ' on' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{n}</button>
            ),
          )}
          <button type="button" className="pg" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label={t('table.next')} title={t('table.next')}><ChevronRight aria-hidden /></button>
          <button type="button" className="pg" disabled={page >= pages} onClick={() => onPage(pages)} aria-label={t('table.last')} title={t('table.last')}><ChevronsRight aria-hidden /></button>
        </span>
      )}
    </nav>
  );
}

/**
 * Table with search, sorting by column, pages, totals and Excel / print export. Search and sorting work on all rows;
 * the screen shows one page; totals, Excel and print cover every row that matches the search.
 */
export function DataTable<T extends object>({ rows, columns: cols, title, empty, onRow, actions, paged = true }: { rows: T[] | null | undefined; columns: Column<T>[]; title?: string; empty?: string | EmptyState; onRow?: (row: T) => void; actions?: (row: T) => RowAction[]; paged?: boolean }) {
  // paged={false}: the server pages this list (customers, loans, collections), so it brings its own Pager and search.
  const { t, i18n } = useTranslation();
  const all = rows ?? [];
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(savedPageSize);
  const printing = usePrinting();
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
    try {
      localStorage.setItem(PAGE_SIZE_KEY, String(n));
    } catch {
      /* private mode */
    }
  };
  // While rows are still loading (null) keep the neutral message so a "create" button does not flash.
  const emptyState: EmptyState = rows == null || !empty ? { message: t('common.noData') } : typeof empty === 'string' ? { message: empty } : empty;
  const columns: Column<T>[] = actions ? [...cols, { key: '__actions', label: t('common.actions'), render: (r) => <RowActions actions={actions(r)} /> }] : cols;
  const raw = (r: T, c: Column<T>) => (c.value ? c.value(r) : (r as Record<string, unknown>)[c.key]);
  const dataCols = cols.filter((c) => c.key !== 'actions' && c.key !== '__actions');
  const sortable = (c: Column<T>) => c.key !== 'actions' && c.key !== '__actions' && dataCols.includes(c) && (c.value || ['string', 'number'].includes(typeof all.map((r) => raw(r, c)).find((v) => v != null)));

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = needle ? all.filter((r) => dataCols.some((c) => String(raw(r, c) ?? '').toLowerCase().includes(needle))) : all;
    if (sort) {
      const c = dataCols.find((x) => x.key === sort.key);
      if (c) {
        const coll = new Intl.Collator(i18n.language, { numeric: true, sensitivity: 'base' });
        out = [...out].sort((a, b) => {
          const x = raw(a, c), y = raw(b, c);
          if (x == null || x === '') return 1;
          if (y == null || y === '') return -1;
          return (typeof x === 'number' && typeof y === 'number' ? x - y : coll.compare(String(x), String(y))) * sort.dir;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, q, sort, i18n.language]);

  const pages = paged ? Math.max(1, Math.ceil(list.length / pageSize)) : 1;
  const cur = Math.min(page, pages);
  // Back to the first page when the search, the sort or the number of rows changes (not on every new array).
  useEffect(() => setPage(1), [q, sort, all.length]);
  const shown = !paged || printing ? list : list.slice((cur - 1) * pageSize, cur * pageSize);
  const onSort = (c: Column<T>) => setSort((s) => (s?.key !== c.key ? { key: c.key, dir: 1 } : s.dir === 1 ? { key: c.key, dir: -1 } : null));

  const exportExcel = () => {
    const data = list.map((r) =>
      Object.fromEntries(dataCols.map((c) => {
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
  const cls = (c: Column<T>) => (c.money || c.num ? 'num' : c.key === '__actions' || c.key === 'actions' ? 'actions-col no-print' : '');
  return (
    <div>
      <div className="dt-toolbar no-print">
        {title && <h3>{title}</h3>}
        {paged && <span className="count-pill">{q ? `${list.length} / ${all.length}` : all.length}</span>}
        <span className="spacer" />
        {paged && all.length > 10 && (
          <label className="dt-search">
            <Search aria-hidden />
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('table.search')} aria-label={t('table.search')} />
          </label>
        )}
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
              {columns.map((c) => {
                const on = sort?.key === c.key;
                return (
                  <th key={c.key} className={cls(c)} aria-sort={on ? (sort.dir === 1 ? 'ascending' : 'descending') : undefined}>
                    {sortable(c) ? (
                      <button type="button" className={`th-sort${on ? ' on' : ''}`} onClick={() => onSort(c)} title={t('table.sort')}>
                        {c.label}
                        {on ? sort.dir === 1 ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden /> : <ArrowUpDown aria-hidden className="idle" />}
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={(r as { id?: string }).id ?? i} onClick={onRow ? () => onRow(r) : undefined} className={onRow ? 'clickable' : undefined}>
                {columns.map((c) => (
                  <td key={c.key} className={cls(c)}>
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
                    <span>{q && all.length ? t('table.noMatch', { q }) : emptyState.message}</span>
                    {!q && emptyState.action && (
                      <button type="button" className="btn primary small no-print" onClick={emptyState.action.onClick}>
                        <Plus aria-hidden />
                        {emptyState.action.label}
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          {hasTotals && list.length > 0 && (
            <tfoot>
              <tr>
                {columns.map((c, i) => (
                  <td key={c.key} className={cls(c)}>
                    {c.total ? (c.money ? money(list.reduce((s, r) => s + Number(raw(r, c) ?? 0), 0)) : list.reduce((s, r) => s + Number(raw(r, c) ?? 0), 0)) : i === 0 ? t('common.total') : ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      {paged && list.length > PAGE_SIZES[0] && <Pager page={cur} pages={pages} total={list.length} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
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

// ---------- Review step before money moves ----------
export interface ConfirmRow {
  label: string;
  value: ReactNode;
  strong?: boolean;
}

/** Read-back of what is about to be saved; rows with no value are left out. */
export function ConfirmPanel({ rows, note }: { rows: ConfirmRow[]; note?: ReactNode }) {
  return (
    <div className="confirm-panel">
      <dl className="kv">
        {rows
          .filter((r) => r.value !== null && r.value !== undefined && r.value !== '')
          .map((r) => (
            <Fragment key={r.label}>
              <dt>{r.label}</dt>
              <dd>{r.strong ? <strong>{r.value}</strong> : r.value}</dd>
            </Fragment>
          ))}
      </dl>
      {note}
    </div>
  );
}

/**
 * A FormModal with a second step: the form, then a read-back of `review()` with Back / Confirm.
 * `validate` throws to keep the user on the form; server errors show on the review step.
 */
export function ConfirmFormModal({ title, onClose, onSubmit, children, submitLabel, wide, review, validate, danger }: { title: string; onClose: () => void; onSubmit: () => Promise<unknown>; children: ReactNode; submitLabel?: string; wide?: boolean; review: () => ConfirmRow[]; validate?: () => void; danger?: boolean }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const next = () => {
    setError(null);
    try {
      validate?.();
      setStep('confirm');
    } catch (e) {
      setError(e);
    }
  };
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
  const confirming = step === 'confirm';
  return (
    <Modal
      title={confirming ? `${t('confirm.title')}: ${title}` : title}
      onClose={() => !busy && onClose()}
      wide={wide && !confirming}
      actions={
        confirming ? (
          <>
            <button className="btn" onClick={() => { setError(null); setStep('form'); }} disabled={busy}>
              {t('common.back')}
            </button>
            <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={submit} disabled={busy} autoFocus>
              {busy ? t('common.loading') : submitLabel ?? t('common.confirm')}
            </button>
          </>
        ) : (
          <>
            <button className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
            <button className="btn primary" onClick={next}>
              {t('confirm.review')}
            </button>
          </>
        )
      }
    >
      <ErrorBox error={error} />
      {confirming ? (
        <>
          <p className="muted" style={{ marginTop: 0 }}>{t('confirm.check')}</p>
          <ConfirmPanel rows={review()} />
        </>
      ) : (
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          {children}
          <button type="submit" hidden />
        </form>
      )}
    </Modal>
  );
}

// ---------- Printing one document (receipt, repayment card, statement) ----------
/** Hidden on screen; printDoc(id) prints this alone, with the rest of the app hidden. */
export function PrintDoc({ id, children }: { id: string; children: ReactNode }) {
  return createPortal(
    <div className="print-doc" id={`print-${id}`}>
      {children}
    </div>,
    document.body,
  );
}

export function printDoc(id: string) {
  const el = document.getElementById(`print-${id}`);
  if (!el) return;
  document.body.classList.add('print-doc-on');
  el.classList.add('on');
  const done = () => {
    document.body.classList.remove('print-doc-on');
    el.classList.remove('on');
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  window.print();
}

/** Letterhead for a printed document: business name, document title and when it was printed. */
export function DocHead({ business, title, sub }: { business: string; title: string; sub?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <div className="doc-head">
      <h1>{business}</h1>
      <h2>{title}</h2>
      {sub && <div>{sub}</div>}
      <div className="doc-printed">{t('print.printedOn')} {new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</div>
    </div>
  );
}
