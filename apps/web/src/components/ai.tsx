import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Bell, Camera, Copy, LoaderCircle, MessageCircle, MessageSquareText, RefreshCw, ScanLine, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, TriangleAlert } from 'lucide-react';
import { put, post } from '../lib/api';
import { aiLang, refreshAiStatus, useAiStatus } from '../lib/ai';
import { useAuth } from '../lib/auth';
import { dateIN, money } from '../lib/format';
import { Badge, ErrorBox, Modal, statusTone, Tabs } from './ui';

// ---------------------------------------------------------------------------
// Small label for text written by AI (or from plain figures)
// ---------------------------------------------------------------------------
export function AiLabel({ ai, text }: { ai: boolean; text: string }) {
  return (
    <span className={`ai-label${ai ? ' on' : ''}`}>
      {ai && <Sparkles aria-hidden />}
      {text}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Smart risk score: grade, score and the reasons behind it
// ---------------------------------------------------------------------------
export interface RiskReason {
  key: string;
  tone: 'good' | 'bad';
  values?: Record<string, string | number>;
}
export interface RiskSummary {
  grade: string;
  score?: number | null;
  reasons?: RiskReason[];
}

const gradeTone = (g: string) => ({ A: 'ok', B: 'ok', C: 'warn', D: 'danger' } as const)[g as 'A'] ?? 'brand';

/** Grade badge with "72/100" beside it. */
export function RiskBadge({ s }: { s: RiskSummary }) {
  const { t } = useTranslation();
  return (
    <span className="risk-badge">
      <Badge tone={gradeTone(s.grade)}>{t(`history.grades.${s.grade}`)}</Badge>
      {s.score != null && <span className="risk-score" title={t('ai.risk.score')}>{t('ai.risk.outOf', { score: s.score })}</span>}
    </span>
  );
}

function ReasonList({ reasons }: { reasons: RiskReason[] }) {
  const { t } = useTranslation();
  return (
    <ul className="risk-reasons">
      {reasons.map((r) => (
        <li key={r.key} className={r.tone}>
          {r.tone === 'good' ? <ThumbsUp aria-hidden /> : <ThumbsDown aria-hidden />}
          <span>{t(`ai.risk.reasons.${r.key}`, r.values ?? {})}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * The reasons behind the score: the top three inline and all of them behind "Why", plus the advisory line.
 * `compact` shows only the "Why" expander (for table cells).
 */
export function RiskReasons({ s, compact }: { s: RiskSummary; compact?: boolean }) {
  const { t } = useTranslation();
  const reasons = s.reasons ?? [];
  if (!reasons.length) return null;
  const top = reasons.slice(0, 3);
  const rest = reasons.length - top.length;
  return (
    <div className={`risk-box${compact ? ' compact' : ''}`}>
      {!compact && <ReasonList reasons={top} />}
      {(compact || rest > 0) && (
        <details className="risk-why" onClick={(e) => e.stopPropagation()}>
          <summary>
            {t('ai.risk.why')}
            {!compact && ` (${t('ai.web.moreReasons', { count: rest })})`}
          </summary>
          <ReasonList reasons={reasons} />
          {compact && <div className="risk-advisory">{t('ai.risk.advisory')}</div>}
        </details>
      )}
      {!compact && <div className="risk-advisory">{t('ai.risk.advisory')}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payment reminder draft
// ---------------------------------------------------------------------------
interface ReminderDraft {
  text: string;
  phone: string;
  language: 'en' | 'ta';
  source: 'ai' | 'rules';
  overdue: number;
  daysLate: number;
  nextDue: { date: string; amount: number } | null;
}

const tenDigits = (phone: string) => phone.replace(/\D/g, '').slice(-10);

export function ReminderModal({ customer, onClose }: { customer: { id: string; name: string; phone: string; language: string }; onClose: () => void }) {
  const { t } = useTranslation();
  const status = useAiStatus();
  const [tone, setTone] = useState<'gentle' | 'firm'>('gentle');
  const [lang, setLang] = useState<'en' | 'ta'>(aiLang(customer.language));
  const [draft, setDraft] = useState<ReminderDraft | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState<'ok' | 'fail' | null>(null);
  const [round, setRound] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const my = ++seq.current;
    setBusy(true);
    setError(null);
    post<ReminderDraft>(`/ai/customers/${customer.id}/reminder`, { language: lang, tone })
      .then((d) => {
        if (my !== seq.current) return;
        setDraft(d);
        setText(d.text);
      })
      .catch((e) => my === seq.current && setError(e))
      .finally(() => my === seq.current && setBusy(false));
  }, [customer.id, lang, tone, round]);

  const phone = tenDigits(draft?.phone ?? customer.phone);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied('ok');
    } catch {
      setCopied('fail');
    }
    setTimeout(() => setCopied(null), 2500);
  };
  const aiOn = !!status?.enabled;

  return (
    <Modal
      title={`${t('ai.reminder.title')}: ${customer.name}`}
      onClose={onClose}
      actions={
        <div className="reminder-actions">
          <button type="button" className="btn" onClick={() => void copy()} disabled={busy || !text}>
            <Copy aria-hidden />
            {copied === 'ok' ? t('ai.reminder.copied') : t('ai.reminder.copy')}
          </button>
          <a className={`btn${busy || !text ? ' disabled' : ''}`} href={`sms:+91${phone}?body=${encodeURIComponent(text)}`}>
            <MessageSquareText aria-hidden />
            {t('ai.reminder.sms')}
          </a>
          <a className={`btn primary${busy || !text ? ' disabled' : ''}`} href={`https://wa.me/91${phone}?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">
            <MessageCircle aria-hidden />
            {t('ai.reminder.whatsapp')}
          </a>
        </div>
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>{t('ai.reminder.intro')}</p>
      <div className="reminder-opts">
        <div className="opt">
          <span className="opt-label">{t('ai.reminder.language')}</span>
          <Tabs value={lang} onChange={setLang} items={[{ key: 'en', label: 'English' }, { key: 'ta', label: 'தமிழ்' }]} />
        </div>
        {aiOn && (
          <div className="opt">
            <span className="opt-label">{t('ai.web.tone')}</span>
            <Tabs value={tone} onChange={setTone} items={[{ key: 'gentle', label: t('ai.reminder.gentle') }, { key: 'firm', label: t('ai.reminder.firm') }]} />
          </div>
        )}
      </div>
      {draft && (
        <div className="muted reminder-facts">
          {draft.overdue > 0
            ? t('ai.web.reminderOverdue', { amount: money(draft.overdue), days: draft.daysLate })
            : draft.nextDue
              ? t('ai.web.reminderNext', { amount: money(draft.nextDue.amount), date: dateIN(draft.nextDue.date) })
              : t('ai.web.reminderNothing')}
        </div>
      )}
      <ErrorBox error={error} />
      {copied === 'fail' && <div className="error-box">{t('ai.web.copyFailed')}</div>}
      <label className="field">
        <span className="row" style={{ justifyContent: 'space-between' }}>
          <span>{t('ai.web.message')}</span>
          {draft?.source === 'ai' && !busy && <AiLabel ai text={t('ai.reminder.byAi')} />}
        </span>
        <div className="reminder-text">
          <textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} disabled={busy} lang={lang} />
          {busy && (
            <div className="reminder-busy">
              <LoaderCircle className="spinner" aria-hidden />
            </div>
          )}
        </div>
      </label>
      {aiOn && (
        <button type="button" className="btn small ghost" onClick={() => setRound((n) => n + 1)} disabled={busy} style={{ marginTop: 8 }}>
          <RefreshCw aria-hidden />
          {t('ai.reminder.regenerate')}
        </button>
      )}
    </Modal>
  );
}

/** The "Reminder" button on the customer page. */
export function ReminderButton({ customer }: { customer: { id: string; name: string; phone: string; language: string } }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}>
        <Bell aria-hidden />
        {t('ai.reminder.button')}
      </button>
      {open && <ReminderModal customer={customer} onClose={() => setOpen(false)} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Read an ID card photo into the customer form
// ---------------------------------------------------------------------------
export interface IdFields {
  name: string;
  idType: 'AADHAAR' | 'PAN' | 'VOTER_ID' | 'DRIVING_LICENCE' | 'OTHER' | null;
  idNumber: string;
  address: string;
  dateOfBirth: string;
  guardian: string;
}
interface IdRead {
  documentType: string;
  readable: boolean;
  fields: IdFields;
  duplicates: { id: string; code: string; name: string; phone: string; status: string; sameId: boolean; otherBranch: boolean }[];
}

/** Shrinks a photo to at most 1600 px on the long side and returns JPEG (quality 0.8) as base64 without the data: prefix. */
async function shrink(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ReadIdCard({ onFilled }: { onFilled: (f: IdFields) => void }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [res, setRes] = useState<IdRead | null>(null);
  const [badFile, setBadFile] = useState(false);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setRes(null);
    setError(null);
    setBadFile(false);
    if (!file.type.startsWith('image/')) return setBadFile(true);
    setBusy(true);
    try {
      let image: string;
      try {
        image = await shrink(file);
      } catch {
        return setBadFile(true);
      }
      const r = await post<IdRead>('/ai/read-id', { mediaType: 'image/jpeg', image });
      setRes(r);
      if (r.readable) onFilled(r.fields);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="read-id">
      <div className="row">
        <button type="button" className="btn" onClick={() => input.current?.click()} disabled={busy}>
          {busy ? <LoaderCircle className="spinner" aria-hidden /> : <ScanLine aria-hidden />}
          {busy ? t('ai.readId.reading') : t('ai.readId.button')}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void read(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <span className="muted read-id-privacy">
          <Camera aria-hidden />
          {t('ai.readId.privacy')}
        </span>
      </div>
      <ErrorBox error={error} />
      {badFile && <div className="error-box">{t('ai.web.notImage')}</div>}
      {res && !res.readable && (
        <div className="warn-box">
          <TriangleAlert aria-hidden />
          {t('ai.readId.notReadable')}
        </div>
      )}
      {res?.readable && (
        <div className="ok-box read-id-result">
          <div className="notice">
            <Sparkles aria-hidden />
            <div>
              <div>{t('ai.readId.filled')}</div>
              {(res.fields.dateOfBirth || res.fields.guardian) && (
                <div className="read-id-hints">
                  {res.fields.dateOfBirth && <span>{t('ai.readId.dob', { value: /^\d{4}-\d{2}-\d{2}$/.test(res.fields.dateOfBirth) ? dateIN(res.fields.dateOfBirth) : res.fields.dateOfBirth })}</span>}
                  {res.fields.guardian && <span>{t('ai.readId.guardian', { value: res.fields.guardian })}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {res && res.duplicates.length > 0 && (
        <div className="warn-box read-id-dupes">
          <div className="dupes-title">
            <TriangleAlert aria-hidden />
            {t('ai.readId.duplicates')}
          </div>
          <ul>
            {res.duplicates.map((d) => (
              <li key={d.id}>
                <span className="who">
                  <strong>{d.name}</strong> <span className="muted">{d.code} · {d.phone}</span>
                </span>
                <span className="tags">
                  <Badge tone={d.sameId ? 'danger' : 'warn'}>{d.sameId ? t('ai.readId.sameId') : t('ai.readId.sameName')}</Badge>
                  {d.otherBranch && <Badge>{t('ai.readId.otherBranch')}</Badge>}
                  <Badge tone={statusTone(d.status)}>{t(`customerMod.statuses.${d.status}`)}</Badge>
                  {!d.otherBranch && (
                    <Link to={`/customers/${d.id}`} target="_blank" rel="noreferrer">
                      {t('ai.web.open')}
                    </Link>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings: the AI switch and what it means
// ---------------------------------------------------------------------------
export function AiSettingsCard({ onChange }: { onChange?: (on: boolean) => void }) {
  const { t } = useTranslation();
  const { can, profile, reload } = useAuth();
  const status = useAiStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const editable = can('settings.manage') && !profile?.readOnly;
  const on = !!status?.switchedOn;

  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await put('/settings', { settings: { aiEnabled: next } });
      onChange?.(next);
      refreshAiStatus();
      void reload();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card ai-settings" aria-labelledby="ai-settings-title">
      <div className="card-head">
        <span className="chip-icon sm">
          <Sparkles />
        </span>
        <h2 id="ai-settings-title">{t('ai.settings.title')}</h2>
        {status && <Badge tone={status.enabled ? 'ok' : undefined}>{status.enabled ? t('ai.settings.on') : t('ai.settings.off')}</Badge>}
      </div>
      <p className="muted" style={{ marginTop: -6 }}>{t('ai.settings.intro')}</p>
      {status && !status.configured && (
        <div className="warn-box">
          <TriangleAlert aria-hidden />
          {t('ai.settings.notConfigured')}
        </div>
      )}
      <ErrorBox error={error} />
      <label className={`ai-switch${editable ? '' : ' readonly'}`}>
        <input type="checkbox" role="switch" checked={on} disabled={!editable || busy || !status} onChange={(e) => void toggle(e.target.checked)} />
        <span className="track" aria-hidden>
          <span className="thumb" />
        </span>
        <span className="txt">
          <strong>{t('ai.settings.toggle')}</strong>
          {!editable && <span className="muted">{t('ai.web.ownerOnly')}</span>}
        </span>
        {busy && <LoaderCircle className="spinner" aria-hidden />}
      </label>
      <p className="ai-sends">{t('ai.settings.sendsData')}</p>
      <ul className="ai-lists">
        <li>
          <ShieldCheck aria-hidden className="ok" />
          <span>{t('ai.settings.local')}</span>
        </li>
        <li>
          <Sparkles aria-hidden className={on ? 'brand' : ''} />
          <span>{t('ai.settings.cloud')}</span>
        </li>
      </ul>
    </section>
  );
}
