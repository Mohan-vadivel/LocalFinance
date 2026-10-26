"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.resources = exports.FALLBACK_LANGUAGE = exports.localeOf = exports.isLanguage = exports.LANGUAGE_CODES = exports.LANGUAGES = void 0;
exports.flattenKeys = flattenKeys;
exports.missingKeys = missingKeys;
exports.translate = translate;
const en_json_1 = __importDefault(require("./en.json"));
const ta_json_1 = __importDefault(require("./ta.json"));
const te_json_1 = __importDefault(require("./te.json"));
const ml_json_1 = __importDefault(require("./ml.json"));
const kn_json_1 = __importDefault(require("./kn.json"));
const hi_json_1 = __importDefault(require("./hi.json"));
/**
 * Language files live next to this file as <code>.json. To add a language: add the JSON file, import it here
 * and add it to LANGUAGES. `pnpm test` fails if any key in en.json is missing from another language.
 */
exports.LANGUAGES = [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
    { code: 'te', name: 'Telugu', nativeName: 'తెలుగు' },
    { code: 'ml', name: 'Malayalam', nativeName: 'മലയാളം' },
    { code: 'kn', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
    { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
];
exports.LANGUAGE_CODES = exports.LANGUAGES.map((l) => l.code);
const isLanguage = (code) => exports.LANGUAGES.some((l) => l.code === code);
exports.isLanguage = isLanguage;
/** Locale for dates and month names, e.g. 'ta-IN'. */
const localeOf = (code) => `${(0, exports.isLanguage)(code) ? code : 'en'}-IN`;
exports.localeOf = localeOf;
exports.FALLBACK_LANGUAGE = 'en';
exports.resources = {
    en: { translation: en_json_1.default },
    ta: { translation: ta_json_1.default },
    te: { translation: te_json_1.default },
    ml: { translation: ml_json_1.default },
    kn: { translation: kn_json_1.default },
    hi: { translation: hi_json_1.default },
};
/** Flattens nested keys: { a: { b: 'x' } } -> ['a.b']. */
function flattenKeys(obj, prefix = '') {
    return Object.entries(obj).flatMap(([k, v]) => typeof v === 'string' ? [`${prefix}${k}`] : flattenKeys(v, `${prefix}${k}.`));
}
/** Keys present in English but missing in the given language. */
function missingKeys(code) {
    const base = new Set(flattenKeys(en_json_1.default));
    const other = new Set(flattenKeys(exports.resources[code].translation));
    return [...base].filter((k) => !other.has(k));
}
/** Minimal translator for server-side text (SMS, receipts, PDFs): t('sms.collection', { amount: '₹100' }). */
function translate(code, key, vars = {}) {
    const lookup = (lang) => {
        const res = exports.resources[lang];
        if (!res)
            return undefined;
        let node = res.translation;
        for (const part of key.split('.')) {
            if (node == null || typeof node === 'string')
                return undefined;
            node = node[part];
        }
        return typeof node === 'string' ? node : undefined;
    };
    const text = lookup(code) ?? lookup(exports.FALLBACK_LANGUAGE) ?? key;
    return text.replace(/\{\{(\w+)\}\}/g, (_, v) => (vars[v] !== undefined ? String(vars[v]) : `{{${v}}}`));
}
//# sourceMappingURL=index.js.map