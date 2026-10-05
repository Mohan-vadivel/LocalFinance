import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleUser, LoaderCircle, MessageSquarePlus, SendHorizontal, Sparkles, TriangleAlert } from 'lucide-react';
import { AiSettingsCard } from '../components/ai';
import { Markdown } from '../components/Markdown';
import { ErrorBox, Loading } from '../components/ui';
import { post } from '../lib/api';
import { aiLang, useAiStatus } from '../lib/ai';
import { useAuth } from '../lib/auth';

interface Turn {
  role: 'user' | 'assistant';
  text: string;
  tools?: string[];
}

/** Friendly names for the data the AI looked at; unknown tools show their own name. */
const TOOL_LABELS: Record<string, string> = {
  places: 'ai.web.tools.places',
  dashboard_today: 'nav.dashboard',
  daily_collection: 'report.dailyCollection',
  pending_list: 'report.pendingList',
  outstanding: 'report.outstanding',
  ageing: 'report.ageing',
  demand_vs_collection: 'report.demandVsCollection',
  agent_performance: 'report.agentPerformance',
  disbursements: 'report.disbursement',
  closed_loans: 'report.closedLoans',
  scheme_wise: 'report.schemeWise',
  location_wise: 'report.locationWise',
  cash_differences: 'report.cashDifference',
  fund_utilisation: 'report.fundUtilisation',
  weekday_collection: 'report.weekday',
  growth: 'report.growth',
  unusual_activity: 'ai.alerts.title',
  cash_forecast: 'ai.forecast.title',
  profit_loss: 'report.profitLoss',
  income: 'report.income',
  find_customers: 'customerMod.title',
  customer_history: 'customerMod.history',
};

const STORE = 'lf.ask';
const loadTurns = (): Turn[] => {
  try {
    const v = JSON.parse(sessionStorage.getItem(STORE) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};
const saveTurns = (turns: Turn[]) => {
  try {
    sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-20)));
  } catch {
    /* storage unavailable: the conversation lasts for this page only */
  }
};

export default function Ask() {
  const { t, i18n } = useTranslation();
  const { can } = useAuth();
  const status = useAiStatus();
  const [params, setParams] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const end = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const started = useRef(false);

  useEffect(() => saveTurns(turns), [turns]);
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [turns.length, busy]);

  const ask = async (question: string) => {
    const text = question.trim();
    if (text.length < 2 || busy) return;
    const history = turns.slice(-8).map(({ role, text: tx }) => ({ role, text: tx }));
    setTurns((x) => [...x, { role: 'user', text }]);
    setQ('');
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ answer: string; tools: string[] }>('/ai/ask', { question: text, language: aiLang(i18n.language), history });
      setTurns((x) => [...x, { role: 'assistant', text: r.answer || t('ai.ask.noAnswer'), tools: r.tools }]);
    } catch (e) {
      // Take the unanswered question back into the box so it can be sent again.
      setTurns((x) => (x[x.length - 1]?.role === 'user' ? x.slice(0, -1) : x));
      setQ(text);
      setError(e);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };

  // A question handed over from the global search (?q=) is asked once AI is known to be on.
  useEffect(() => {
    const fromSearch = params.get('q');
    if (!fromSearch || !status || started.current) return;
    started.current = true;
    setParams({}, { replace: true });
    if (status.enabled) void ask(fromSearch);
    else setQ(fromSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, status]);

  const examples = [t('ai.ask.ex1'), t('ai.ask.ex2'), t('ai.ask.ex3'), t('ai.ask.ex4')];
  const toolList = (tools: string[]) => tools.map((x) => (TOOL_LABELS[x] ? t(TOOL_LABELS[x]) : x.replace(/_/g, ' '))).join(', ');

  return (
    <div className="ask-page">
      <div className="page-head">
        <div>
          <h1>{t('ai.ask.title')}</h1>
          <div className="muted">{t('ai.ask.subtitle')}</div>
        </div>
        {turns.length > 0 && (
          <button className="btn" onClick={() => { setTurns([]); setError(null); }} disabled={busy}>
            <MessageSquarePlus aria-hidden />
            {t('ai.ask.clear')}
          </button>
        )}
      </div>
      {!status ? (
        <Loading />
      ) : !status.enabled ? (
        <>
          <div className="warn-box ask-off">
            <TriangleAlert aria-hidden />
            <div>
              <div>{status.configured ? t('ai.ask.offHint') : t('ai.errors.notConfigured')}</div>
              {status.configured && can('settings.manage') && (
                <Link to="/settings" className="btn small" style={{ marginTop: 8 }}>
                  {t('ai.web.openSettings')}
                </Link>
              )}
            </div>
          </div>
          {!can('settings.manage') && <AiSettingsCard />}
        </>
      ) : (
        <div className="card ask-card">
          <div className="ask-thread" aria-live="polite">
            {turns.length === 0 && (
              <div className="ask-empty">
                <span className="chip-icon">
                  <Sparkles />
                </span>
                <div className="muted">{t('ai.web.tryAsking')}</div>
                <div className="ask-chips">
                  {examples.map((ex) => (
                    <button key={ex} type="button" className="ask-chip" onClick={() => void ask(ex)} disabled={busy}>
                      {ex}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {turns.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                <span className="msg-ico" aria-label={m.role === 'user' ? t('ai.web.you') : t('ai.badge')}>
                  {m.role === 'user' ? <CircleUser aria-hidden /> : <Sparkles aria-hidden />}
                </span>
                <div className="bubble">
                  {m.role === 'user' ? <p className="user-text">{m.text}</p> : <Markdown text={m.text} />}
                  {m.role === 'assistant' && m.tools && m.tools.length > 0 && <div className="msg-tools">{t('ai.ask.usedData', { list: toolList(m.tools) })}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="msg assistant">
                <span className="msg-ico">
                  <Sparkles aria-hidden />
                </span>
                <div className="bubble thinking">
                  <LoaderCircle className="spinner" aria-hidden />
                  {t('ai.ask.thinking')}
                </div>
              </div>
            )}
            <div ref={end} />
          </div>
          <ErrorBox error={error} />
          <form
            className="ask-form"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(q);
            }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={q}
              maxLength={1000}
              aria-label={t('ai.web.question')}
              placeholder={t('ai.ask.placeholder')}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void ask(q);
                }
              }}
            />
            <button type="submit" className="btn primary" disabled={busy || q.trim().length < 2}>
              {busy ? <LoaderCircle className="spinner" aria-hidden /> : <SendHorizontal aria-hidden />}
              {t('ai.ask.send')}
            </button>
          </form>
          <p className="muted ask-note">{t('ai.ask.checkFigures')}</p>
        </div>
      )}
    </div>
  );
}
