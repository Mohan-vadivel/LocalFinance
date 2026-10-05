import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@localfinance/shared';
import { BookOpen, Building2, ChevronRight, Languages, Route, TrendingUp, Users } from 'lucide-react';
import { ErrorBox, Field } from '../components/ui';
import { useAuth } from '../lib/auth';
import { setLanguage } from '../lib/i18n';

export default function Login() {
  const { t, i18n } = useTranslation();
  const { login } = useAuth();
  const [id, setId] = useState('');
  const [pw, setPw] = useState('');
  const [choices, setChoices] = useState<{ tenantId: string; name: string }[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (tenantId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await login(id, pw, tenantId);
      if (r.chooseTenant) setChoices(r.chooseTenant);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <aside className="brand-panel" aria-hidden>
        <div className="brand-top">
          <span className="logo-mark">₹</span>
          {t('common.appName')}
        </div>
        <div className="hero">
          <h1>
            {t('nav.loans')} · {t('nav.collections')} · {t('nav.reports')}
          </h1>
          <div className="features">
            <span>
              <Users /> {t('nav.customers')}
            </span>
            <span>
              <Route /> {t('nav.routes')}
            </span>
            <span>
              <BookOpen /> {t('nav.daybook')}
            </span>
            <span>
              <TrendingUp /> {t('nav.profitLoss')}
            </span>
          </div>
        </div>
        <div className="mock">
          <div className="bars">
            <i />
            <i />
          </div>
          <svg viewBox="0 0 400 110" preserveAspectRatio="none">
            <defs>
              <linearGradient id="lf-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#5eead4" stopOpacity="0.45" />
                <stop offset="1" stopColor="#5eead4" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M0 92 C40 84 60 70 100 74 S160 52 200 56 S260 30 300 36 S360 14 400 10 L400 110 L0 110 Z" fill="url(#lf-area)" />
            <path d="M0 92 C40 84 60 70 100 74 S160 52 200 56 S260 30 300 36 S360 14 400 10" fill="none" stroke="#5eead4" strokeWidth="2.5" />
          </svg>
        </div>
      </aside>
      <div className="form-side">
        <form
          className="box"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2>{choices ? t('auth.chooseTenant') : t('auth.login')}</h2>
          <ErrorBox error={error} />
          {choices ? (
            <div className="tenant-list">
              {choices.map((c) => (
                <button key={c.tenantId} type="button" className="btn" onClick={() => void submit(c.tenantId)}>
                  <span className="row">
                    <Building2 aria-hidden />
                    {c.name}
                  </span>
                  <ChevronRight aria-hidden />
                </button>
              ))}
            </div>
          ) : (
            <>
              <Field label={t('auth.loginId')}>
                <input autoFocus value={id} onChange={(e) => setId(e.target.value)} autoComplete="username" required />
              </Field>
              <Field label={t('auth.password')}>
                <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required />
              </Field>
              <button className="btn primary" disabled={busy}>
                {busy ? t('common.loading') : t('auth.login')}
              </button>
            </>
          )}
          <div className="lang-row">
            <Languages aria-hidden />
            <select aria-label={t('common.language')} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nativeName}
                </option>
              ))}
            </select>
          </div>
        </form>
      </div>
    </div>
  );
}
