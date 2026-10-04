import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES } from '@localfinance/shared';
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
      <form
        className="box"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h1>₹ {t('common.appName')}</h1>
        <ErrorBox error={error} />
        {choices ? (
          <>
            <h3>{t('auth.chooseTenant')}</h3>
            {choices.map((c) => (
              <button key={c.tenantId} type="button" className="btn" onClick={() => void submit(c.tenantId)}>
                {c.name}
              </button>
            ))}
          </>
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
        <select aria-label={t('common.language')} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.nativeName}
            </option>
          ))}
        </select>
      </form>
    </div>
  );
}
