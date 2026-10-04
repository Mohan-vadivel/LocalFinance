import en from './en.json';
import ta from './ta.json';

/**
 * Language files live next to this file as <code>.json. To add a language: add the JSON file, import it here
 * and add it to LANGUAGES. `pnpm test` fails if any key in en.json is missing from another language.
 */
export const LANGUAGES = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]['code'];

export const FALLBACK_LANGUAGE: LanguageCode = 'en';

export const resources = {
  en: { translation: en },
  ta: { translation: ta },
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
