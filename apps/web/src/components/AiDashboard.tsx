import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { CircleCheck, LoaderCircle, RefreshCw, ShieldAlert, Sun, TrendingUp } from 'lucide-react';
import { get } from '../lib/api';
import { aiLang, alertValues } from '../lib/ai';
import { dateIN, money } from '../lib/format';
import { useLoad } from '../lib/hooks';
import { AiLabel } from './ai';
import { Badge, ErrorBox, Loading } from './ui';

interface Briefing {
  date: string;
  bullets: string[];
  source: 'ai' | 'rules';
}

/** Morning briefing: a few plain sentences about yesterday and today, by AI when it is on, else from the figures. */
export function BriefingCard({ branchId }: { branchId: string }) {
  const { t, i18n } = useTranslation();
  const language = aiLang(i18n.language);
  const { data, error, loading, reload } = useLoad(() => get<Briefing>('/ai/briefing', { branchId, language }), [branchId, language]);
  return (
    <section className="card briefing" aria-labelledby="brief-title">
      <div className="card-head">
        <span className="chip-icon sm warn">
          <Sun />
        </span>
        <h2 id="brief-title">{t('ai.brief.title')}</h2>
        <button type="button" className="icon-btn ghost" onClick={() => void reload()} disabled={loading} aria-label={t('ai.brief.refresh')} title={t('ai.brief.refresh')}>
          {loading ? <LoaderCircle className="spinner" /> : <RefreshCw />}
        </button>
      </div>
      {data && (
        <div className="brief-src">
          <AiLabel ai={data.source === 'ai'} text={data.source === 'ai' ? t('ai.brief.byAi') : t('ai.brief.byRules')} />
        </div>
      )}
      <ErrorBox error={error} />
      {!data && loading ? (
        <div className="skeleton-lines" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      ) : data ? (
        <ul className="brief-list">
          {data.bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

interface Alert {
  kind: string;
  severity: 'high' | 'medium';
  values: Record<string, string | number>;
  customers?: { id: string; code: string; name: string }[];
}

/** Unusual activity found on our own server: drops, cancellations, reopened days, shared phone or ID, shortages. */
export function AlertsCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const { data, error, loading } = useLoad(() => get<Alert[]>('/ai/alerts', { branchId }), [branchId]);
  return (
    <section className="card" aria-labelledby="alerts-title">
      <div className="card-head">
        <span className="chip-icon sm danger">
          <ShieldAlert />
        </span>
        <h2 id="alerts-title">{t('ai.alerts.title')}</h2>
        {data && data.length > 0 && <span className="count-pill">{data.length}</span>}
      </div>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data && !data.length ? (
        <div className="row muted alerts-none">
          <CircleCheck aria-hidden className="ok" />
          {t('ai.alerts.none')}
        </div>
      ) : (
        <ul className="alert-list">
          {(data ?? []).map((a, i) => (
            <li key={i} className={a.severity}>
              <Badge tone={a.severity === 'high' ? 'danger' : 'warn'}>{t(`ai.alerts.${a.severity}`)}</Badge>
              <div className="txt">
                <div>{t(`ai.alerts.${a.kind}`, alertValues(a.values))}</div>
                {a.customers && a.customers.length > 0 && (
                  <div className="alert-customers">
                    {a.customers.map((c) => (
                      <Link key={c.id} to={`/customers/${c.id}`}>
                        {c.name} <span className="muted">({c.code})</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Forecast {
  from: string;
  to: string;
  days: { date: string; due: number; expected: number; holiday: boolean }[];
  totalDue: number;
  totalExpected: number;
  ratePct: number | null;
  fundBalance: number;
  approvedWaiting: number;
  approvedCount: number;
  freeToLend: number;
}

/** Next 7 days: due and expected collection per day, and how much is free to lend. */
export function ForecastCard({ branchId }: { branchId: string }) {
  const { t } = useTranslation();
  const { data, error, loading } = useLoad(() => get<Forecast>('/ai/forecast', { branchId }), [branchId]);
  const max = data ? Math.max(1, ...data.days.map((d) => Math.max(d.due, d.expected))) : 1;
  return (
    <section className="card" aria-labelledby="forecast-title">
      <div className="card-head">
        <span className="chip-icon sm info">
          <TrendingUp />
        </span>
        <h2 id="forecast-title">{t('ai.forecast.title')}</h2>
      </div>
      <p className="muted" style={{ margin: '-8px 0 12px', fontSize: 12.5 }}>{t('ai.forecast.subtitle')}</p>
      <ErrorBox error={error} />
      {loading && !data ? (
        <Loading />
      ) : data ? (
        <>
          <div className="fc-legend muted">
            <span><i className="sw exp" />{t('ai.forecast.expected')}</span>
            <span><i className="sw due" />{t('ai.forecast.due')}</span>
            {data.ratePct != null && <span className="spacer-l">{t('ai.forecast.rate', { pct: data.ratePct })}</span>}
          </div>
          <ul className="fc-days">
            {data.days.map((d) => {
              const wd = new Date(`${d.date}T00:00:00`).getDay();
              return (
                <li key={d.date} className={d.holiday ? 'holiday' : ''}>
                  <span className="fc-date">
                    <strong>{t(`weekdays.${wd}`)}</strong>
                    <span className="muted">{dateIN(d.date).slice(0, 5)}</span>
                  </span>
                  <span className="fc-bar">
                    {d.holiday ? (
                      <Badge>{t('ai.forecast.holiday')}</Badge>
                    ) : (
                      <span className="track" title={`${t('ai.forecast.due')} ${money(d.due)}`}>
                        <span className="due" style={{ width: `${(d.due / max) * 100}%` }} />
                        <span className="exp" style={{ width: `${(d.expected / max) * 100}%` }} />
                      </span>
                    )}
                  </span>
                  <span className="fc-amt">
                    <strong>{d.holiday ? '-' : money(d.expected)}</strong>
                    {!d.holiday && <span className="muted">{money(d.due)}</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          <dl className="fc-totals">
            <div>
              <dt>{t('ai.forecast.total')}</dt>
              <dd>
                <strong>{money(data.totalExpected)}</strong>
                <span className="muted"> / {money(data.totalDue)}</span>
              </dd>
            </div>
            <div>
              <dt>{t('ai.forecast.fundBalance')}</dt>
              <dd>{money(data.fundBalance)}</dd>
            </div>
            <div>
              <dt>{t('ai.forecast.approvedWaiting')}</dt>
              <dd>
                {money(data.approvedWaiting)}
                {data.approvedCount > 0 && <span className="muted"> · {t('ai.web.loansCount', { count: data.approvedCount })}</span>}
              </dd>
            </div>
            <div className="free">
              <dt>{t('ai.forecast.freeToLend')}</dt>
              <dd>
                <strong>{money(data.freeToLend)}</strong>
              </dd>
            </div>
          </dl>
          <p className="muted fc-note">{t('ai.forecast.note')}</p>
        </>
      ) : null}
    </section>
  );
}
