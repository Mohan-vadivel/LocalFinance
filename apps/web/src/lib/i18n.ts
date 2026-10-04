import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { FALLBACK_LANGUAGE, resources } from '@localfinance/shared';

const saved = localStorage.getItem('lf.lang');

i18n.use(initReactI18next).init({
  resources,
  lng: saved ?? FALLBACK_LANGUAGE,
  fallbackLng: FALLBACK_LANGUAGE,
  interpolation: { escapeValue: false },
  returnNull: false,
  saveMissing: true,
  missingKeyHandler: (_lngs, _ns, key) => console.warn(`Missing translation: ${key}`),
});

export function setLanguage(code: string) {
  localStorage.setItem('lf.lang', code);
  void i18n.changeLanguage(code);
  document.documentElement.lang = code;
}

export default i18n;
