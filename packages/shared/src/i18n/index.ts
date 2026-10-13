import en from './en.json';
import ta from './ta.json';
import te from './te.json';
import ml from './ml.json';
import kn from './kn.json';
import hi from './hi.json';

/**
 * Language files live next to this file as <code>.json. To add a language: add the JSON file, import it here
 * and add it to LANGUAGES. `pnpm test` fails if any key in en.json is missing from another language.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const LANGUAGE_CODES = LANGUAGES.map((l) => l.code) as [LanguageCode, ...LanguageCode[]];
export const isLanguage = (code: string | null | undefined): code is LanguageCode => LANGUAGES.some((l) => l.code === code);
/** Locale for dates and month names, e.g. 'ta-IN'. */
export const localeOf = (code: string) => `${isLanguage(code) ? code : 'en'}-IN`;

export const FALLBACK_LANGUAGE: LanguageCode = 'en';

export const resources = {
  en: { translation: en },
  ta: { translation: ta },
  te: { translation: te },
  ml: { translation: ml },
  kn: { translation: kn },
  hi: { translation: hi },
} as const;

type Json = { [k: string]: string | Json };

/** Flattens nested keys: { a: { b: 'x' } } -> ['a.b']. */
export function flattenKeys(obj: Json, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string' ? [`${prefix}${k}`] : flattenKeys(v as Json, `${prefix}${k}.`),
  );
}

/** Keys present in English but missing in the given language. */
export function missingKeys(code: LanguageCode): string[] {
  const base = new Set(flattenKeys(en as Json));
  const other = new Set(flattenKeys(resources[code].translation as Json));
  return [...base].filter((k) => !other.has(k));
}

/** Minimal translator for server-side text (SMS, receipts, PDFs): t('sms.collection', { amount: '₹100' }). */
export function translate(code: string, key: string, vars: Record<string, string | number> = {}): string {
  const lookup = (lang: string): string | undefined => {
    const res = (resources as Record<string, { translation: Json }>)[lang];
    if (!res) return undefined;
    let node: string | Json | undefined = res.translation;
    for (const part of key.split('.')) {
      if (node == null || typeof node === 'string') return undefined;
      node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
  };
  const text = lookup(code) ?? lookup(FALLBACK_LANGUAGE) ?? key;
  return text.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] !== undefined ? String(vars[v]) : `{{${v}}}`));
}
