import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { HandCoins, LoaderCircle, Search, Sparkles, User } from 'lucide-react';
import { get } from '../lib/api';
import { useAiStatus } from '../lib/ai';
import { useAuth } from '../lib/auth';
import { money } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { Badge, ErrorBox, statusTone } from './ui';

interface Hit {
  id: string;
  to: string;
  kind: 'customer' | 'loan' | 'ask';
  title: string;
  sub: string;
  status: string;
  statusLabel: string;
}

/** How many of each kind to show; the list pages have the rest. */
const PER_GROUP = 6;

/** Top-bar search over customers and loans. Opens with the button or Ctrl+K / Cmd+K. */
export function GlobalSearch() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [active, setActive] = useState(0);
  const seq = useRef(0);
  const term = useDebounced(q.trim(), 250);
  const canCustomers = can('customer.view');
  // The loan list and the loan page both allow these rights.
  const canLoans = can('customer.view', 'loan.request', 'loan.approve');
  // With AI on, the typed words can also be asked as a question on the Ask AI page.
  const ai = useAiStatus();
  const canAsk = can('report.view') && !!ai?.enabled;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const my = ++seq.current;
    if (term.length < 2) {
      setHits(null);
      setBusy(false);
      return;
    }
    setBusy(true);
    Promise.all([
      canCustomers ? get<{ rows: { id: string; code: string; name: string; phone: string; status: string }[] }>('/customers', { q: term }) : Promise.resolve({ rows: [] }),
      canLoans ? get<{ rows: { id: string; number: string; status: string; principal: number; customer: { name: string; code: string } }[] }>('/loans', { q: term }) : Promise.resolve({ rows: [] }),
    ])
      .then(([cs, ls]) => {
        if (my !== seq.current) return;
        setError(null);
        setActive(0);
        setHits([
          ...cs.rows.slice(0, PER_GROUP).map((c): Hit => ({ id: c.id, to: `/customers/${c.id}`, kind: 'customer', title: c.name, sub: `${c.code} · ${c.phone}`, status: c.status, statusLabel: t(`customerMod.statuses.${c.status}`) })),
          ...ls.rows.slice(0, PER_GROUP).map((l): Hit => ({ id: l.id, to: `/loans/${l.id}`, kind: 'loan', title: l.number, sub: `${l.customer.name} (${l.customer.code}) · ${money(l.principal)}`, status: l.status, statusLabel: t(`loanMod.statuses.${l.status}`) })),
        ]);
      })
      .catch((e) => my === seq.current && setError(e))
      .finally(() => my === seq.current && setBusy(false));
  }, [term, canCustomers, canLoans, t]);

  if (!canCustomers && !canLoans && !canAsk) return null;

  const close = () => {
    setOpen(false);
    setQ('');
    setHits(null);
    setError(null);
  };
  const go = (h: Hit) => {
    close();
    nav(h.to);
  };
  const askHit: Hit[] = canAsk && term.length >= 2 ? [{ id: 'ask', to: `/ask?${new URLSearchParams({ q: term })}`, kind: 'ask', title: t('ai.web.searchAsk', { q: term }), sub: t('ai.ask.subtitle'), status: '', statusLabel: '' }] : [];
  const list = [...(hits ?? []), ...askHit];
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowDown' && list.length) {
      e.preventDefault();
      setActive((a) => (a + 1) % list.length);
    } else if (e.key === 'ArrowUp' && list.length) {
      e.preventDefault();
      setActive((a) => (a - 1 + list.length) % list.length);
    } else if (e.key === 'Enter' && list[active]) {
      e.preventDefault();
      go(list[active]);
    }
  };
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  const group = (kind: Hit['kind'], label: string) => {
    const rows = list.map((h, i) => ({ h, i })).filter(({ h }) => h.kind === kind);
    if (!rows.length) return null;
    const Icon = kind === 'customer' ? User : kind === 'loan' ? HandCoins : Sparkles;
    return (
      <div role="group" aria-label={label}>
        <div className="gs-group">{label}</div>
        {rows.map(({ h, i }) => (
          <div
            key={h.kind + h.id}
            id={`gs-${i}`}
            role="option"
            aria-selected={i === active}
            className={`gs-item${i === active ? ' on' : ''}`}
            onMouseMove={() => setActive(i)}
            onClick={() => go(h)}
          >
            <Icon aria-hidden />
            <span className="txt">
              <span className="t">{h.title}</span>
              <span className="s">{h.sub}</span>
            </span>
            {h.statusLabel && <Badge tone={statusTone(h.status)}>{h.statusLabel}</Badge>}
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <button type="button" className="btn gs-open" onClick={() => setOpen(true)} aria-label={t('search.open')} title={`${t('search.open')} (${isMac ? '⌘' : 'Ctrl'}+K)`}>
        <Search aria-hidden />
        <span className="gs-label">{t('search.open')}</span>
        <kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
      </button>
      {open && (
        <div className="modal-bg" onMouseDown={(e) => e.target === e.currentTarget && close()}>
          <div className="modal gs" role="dialog" aria-label={t('search.open')}>
            <div className="gs-input">
              {busy ? <LoaderCircle className="spinner" aria-hidden /> : <Search aria-hidden />}
              <input
                autoFocus
                type="search"
                role="combobox"
                aria-expanded={list.length > 0}
                aria-controls="gs-results"
                aria-activedescendant={list.length ? `gs-${active}` : undefined}
                placeholder={t('search.placeholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKeyDown}
              />
            </div>
            {!!error && (
              <div style={{ padding: '10px 12px 0' }}>
                <ErrorBox error={error} />
              </div>
            )}
            <div className="gs-results" id="gs-results" role="listbox">
              {term.length < 2 ? (
                <div className="gs-empty muted">{t('search.hint')}</div>
              ) : hits && !hits.length && !askHit.length ? (
                <div className="gs-empty muted">{t('search.noResults', { q: term })}</div>
              ) : (
                <>
                  {group('customer', t('search.customers'))}
                  {group('loan', t('search.loans'))}
                  {group('ask', t('nav.ask'))}
                </>
              )}
            </div>
            {list.length > 0 && <div className="gs-foot muted">{t('search.keys')}</div>}
          </div>
        </div>
      )}
    </>
  );
}
