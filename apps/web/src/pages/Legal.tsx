import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { LANGUAGES, LEGAL_SECTIONS, type LegalPage } from '@localfinance/shared';
import { ArrowLeft, Languages } from 'lucide-react';
import { setLanguage } from '../lib/i18n';

/**
 * Terms and conditions / Privacy policy: public pages (no login needed), the same text as the phone app.
 * DRAFT: both texts still need review by a lawyer (see packages/shared/src/legal.ts).
 */
export default function Legal({ page }: { page: LegalPage }) {
  const { t, i18n } = useTranslation();
  const other: LegalPage = page === 'terms' ? 'privacy' : 'terms';
  useEffect(() => {
    document.title = `${t(`legal.${page}.title`)} · ${t('common.appName')}`;
  }, [page, t]);
  return (
    <div className="legal">
      <header className="legal-top">
        <Link to="/" className="legal-brand">
          <span className="logo-mark">₹</span>
          {t('common.appName')}
        </Link>
        <label className="legal-lang">
          <Languages aria-hidden />
          <select aria-label={t('common.language')} value={i18n.language} onChange={(e) => setLanguage(e.target.value)}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.nativeName}
              </option>
            ))}
          </select>
        </label>
      </header>
      <article className="legal-body card">
        <h1>{t(`legal.${page}.title`)}</h1>
        <p className="muted">{t('legal.updated')}</p>
        <p className="legal-intro">{t(`legal.${page}.intro`)}</p>
        {LEGAL_SECTIONS[page].map((k, i) => (
          <section key={k}>
            <h2>
              {i + 1}. {t(`legal.${page}.${k}.title`)}
            </h2>
            <p>{t(`legal.${page}.${k}.body`)}</p>
          </section>
        ))}
        <p className="muted legal-foot">{t('legal.seeAlso')}</p>
        <nav className="legal-nav">
          <Link to="/" className="btn">
            <ArrowLeft aria-hidden /> {t('common.back')}
          </Link>
          <Link to={`/${other}`} className="btn">
            {t(`legal.${other}.title`)}
          </Link>
        </nav>
      </article>
    </div>
  );
}

/** Small links to the two pages, for the login and settings pages. */
export function LegalLinks() {
  const { t } = useTranslation();
  return (
    <p className="legal-links">
      <Link to="/terms">{t('legal.terms.title')}</Link>
      <span aria-hidden>·</span>
      <Link to="/privacy">{t('legal.privacy.title')}</Link>
    </p>
  );
}
