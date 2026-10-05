import { distanceMetres } from './loan';

// =====================================================================
// Smart risk score
// =====================================================================

export interface RiskInput {
  /** Loans this person has had in the business (active, closed, foreclosed, written off). */
  loans: number;
  closedLoans: number;
  /** Share of instalments already due that were paid in full on time (after grace). */
  onTimeRatio: number;
  /** The same share over the last 10 instalments only, so a recent slip counts more than an old one. */
  recentOnTimeRatio: number;
  /** Instalments past their date and still unpaid. */
  missed: number;
  maxDaysLate: number;
  /** Days the oldest unpaid instalment of a running loan is late today. */
  currentDaysPastDue: number;
  writtenOff: number;
  blacklisted: boolean;
  /** Running loans besides the one being asked for. */
  activeLoans: number;
  /** Amount being asked for, and the largest loan this person has fully repaid, both in paise. */
  requested?: number | null;
  largestRepaid?: number | null;
}

export type RiskReasonKey =
  | 'newCustomer'
  | 'blacklisted'
  | 'writtenOff'
  | 'onTimeHigh'
  | 'onTimeLow'
  | 'recentSlip'
  | 'recentGood'
  | 'lateNow'
  | 'veryLateBefore'
  | 'missedMany'
  | 'repaidBefore'
  | 'manyActive'
  | 'biggerThanBefore';

export interface RiskReason {
  key: RiskReasonKey;
  /** good raises the score, bad lowers it. */
  tone: 'good' | 'bad';
  /** Numbers for the reason text, e.g. { pct: 92 } or { days: 14 }. */
  values?: Record<string, number>;
}

export interface RiskResult {
  /** 0 (very risky) to 100 (very safe); null for a new customer with no history. */
  score: number | null;
  grade: 'A' | 'B' | 'C' | 'D' | 'NEW';
  reasons: RiskReason[];
}

/**
 * Explainable risk score from a customer's own repayment history in this business. Each factor moves the score up or
 * down and is returned as a reason, so staff can see why. Advisory only: it never blocks an approval.
 */
export function riskScore(h: RiskInput): RiskResult {
  const reasons: RiskReason[] = [];
  if (h.blacklisted) reasons.push({ key: 'blacklisted', tone: 'bad' });
  if (h.loans === 0) {
    reasons.unshift({ key: 'newCustomer', tone: 'bad' });
    return { score: null, grade: h.blacklisted ? 'D' : 'NEW', reasons };
  }
  let s = 60;
  const pct = Math.round(h.onTimeRatio * 100);
  // Overall punctuality: up to +25 at 100% on time, down to -30 at 0%.
  s += h.onTimeRatio >= 0.75 ? (h.onTimeRatio - 0.75) * 100 : (h.onTimeRatio - 0.75) * 40;
  if (h.onTimeRatio >= 0.9) reasons.push({ key: 'onTimeHigh', tone: 'good', values: { pct } });
  else if (h.onTimeRatio < 0.75) reasons.push({ key: 'onTimeLow', tone: 'bad', values: { pct } });

  const recentPct = Math.round(h.recentOnTimeRatio * 100);
  if (h.recentOnTimeRatio + 0.15 < h.onTimeRatio) {
    s -= 12;
    reasons.push({ key: 'recentSlip', tone: 'bad', values: { pct: recentPct } });
  } else if (h.recentOnTimeRatio >= 0.9 && h.onTimeRatio < 0.9) {
    s += 6;
    reasons.push({ key: 'recentGood', tone: 'good', values: { pct: recentPct } });
  }
  if (h.currentDaysPastDue > 0) {
    s -= Math.min(30, 5 + h.currentDaysPastDue);
    reasons.push({ key: 'lateNow', tone: 'bad', values: { days: h.currentDaysPastDue } });
  }
  if (h.maxDaysLate > 30) {
    s -= Math.min(20, h.maxDaysLate / 6);
    reasons.push({ key: 'veryLateBefore', tone: 'bad', values: { days: h.maxDaysLate } });
  }
  if (h.missed >= 3) {
    s -= Math.min(15, h.missed * 2);
    reasons.push({ key: 'missedMany', tone: 'bad', values: { count: h.missed } });
  }
  if (h.closedLoans > 0) {
    s += Math.min(12, h.closedLoans * 4);
    reasons.push({ key: 'repaidBefore', tone: 'good', values: { count: h.closedLoans } });
  }
  if (h.activeLoans >= 2) {
    s -= 8;
    reasons.push({ key: 'manyActive', tone: 'bad', values: { count: h.activeLoans } });
  }
  if (h.requested && h.largestRepaid && h.requested > h.largestRepaid * 1.5) {
    s -= 8;
    reasons.push({ key: 'biggerThanBefore', tone: 'bad', values: { times: Math.round((h.requested / h.largestRepaid) * 10) / 10 } });
  }
  if (h.writtenOff > 0) {
    s = Math.min(s, 20);
    reasons.unshift({ key: 'writtenOff', tone: 'bad', values: { count: h.writtenOff } });
  }
  if (h.blacklisted) s = Math.min(s, 10);
  const score = Math.max(0, Math.min(100, Math.round(s)));
  const grade = score >= 80 ? 'A' : score >= 60 ? 'B' : score >= 40 ? 'C' : 'D';
  // Bad reasons first: they are what an approver needs to look at.
  reasons.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === 'bad' ? -1 : 1));
  return { score, grade, reasons };
}

// =====================================================================
// Spoken collection entry ("Murugan 500", "முருகன் ஐநூறு ரூபாய்")
// =====================================================================

const EN_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30,
  forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const EN_SCALES: Record<string, number> = { hundred: 100, thousand: 1000, lakh: 100000, lakhs: 100000 };

// Tamil number words by stem, so the joined forms speech typing produces (இருநூற்று, ஆயிரத்து, ஐம்பத்து) also match.
const TA_WORDS: [string, number][] = [
  ['தொள்ளாயிர', 900], ['எண்ணூற', 800], ['எண்ணூறு', 800], ['எழுநூற', 700], ['எழுநூறு', 700], ['அறுநூற', 600], ['அறுநூறு', 600],
  ['ஐநூற', 500], ['ஐநூறு', 500], ['ஐந்நூறு', 500], ['நானூற', 400], ['நானூறு', 400], ['முந்நூற', 300], ['முந்நூறு', 300], ['முன்னூற', 300], ['முன்னூறு', 300],
  ['இருநூற', 200], ['இருநூறு', 200], ['இரநூறு', 200],
  ['தொண்ணூற', 90], ['தொண்ணூறு', 90], ['எண்பத', 80], ['எண்பது', 80], ['எழுபத', 70], ['எழுபது', 70], ['அறுபத', 60], ['அறுபது', 60],
  ['ஐம்பத', 50], ['ஐம்பது', 50], ['நாற்பத', 40], ['நாற்பது', 40], ['முப்பத', 30], ['முப்பது', 30], ['இருபத', 20], ['இருபது', 20],
  ['பத்து', 10], ['பதின', 10], ['ஒன்பது', 9], ['எட்டு', 8], ['ஏழு', 7], ['ஆறு', 6], ['ஐந்து', 5], ['நான்கு', 4], ['மூன்று', 3],
  ['இரண்டு', 2], ['ஒன்று', 1], ['ஒரு', 1],
];
// Scale words must be the whole word, so a name like லட்சுமி is not read as a lakh.
const TA_SCALES: [RegExp, number][] = [[/^லட்ச(ம்|த்து)?$/, 100000], [/^ஆயிர(ம்|த்து)?$/, 1000], [/^நூ(று|ற்று)$/, 100]];
const CURRENCY_WORDS = /^(rs\.?|rupees?|rupee|inr|₹|ரூபாய்|ரூபாய|ரூ\.?|ரூபா)$/i;

/** Reads an amount in rupees from words like "500", "1,500", "five hundred", "ஐநூற்று ஐம்பது". Null when there is none. */
export function parseSpokenAmount(words: string[]): { rupees: number; used: Set<number> } | null {
  const used = new Set<number>();
  // Digits win when present: speech typing usually writes numbers as digits.
  for (let i = 0; i < words.length; i++) {
    const w = words[i].replace(/,/g, '').replace(/^₹/, '');
    if (/^\d+(\.\d{1,2})?$/.test(w)) {
      used.add(i);
      return { rupees: Number(w), used };
    }
  }
  let total = 0;
  let current = 0;
  let found = false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i].toLowerCase();
    if (w === 'and' && found) {
      used.add(i);
      continue;
    }
    if (w in EN_UNITS) {
      current += EN_UNITS[w];
    } else if (w in EN_SCALES) {
      const scale = EN_SCALES[w];
      if (scale === 100) current = (current || 1) * 100;
      else {
        total += (current || 1) * scale;
        current = 0;
      }
    } else {
      const ta = parseTamilNumberWord(words[i]);
      if (ta == null) {
        if (found) break;
        continue;
      }
      if (ta.scale) {
        if (ta.scale === 100) current = (current || 1) * 100;
        else {
          total += (current || 1) * ta.scale;
          current = 0;
        }
      } else current += ta.value;
    }
    found = true;
    used.add(i);
  }
  if (!found) return null;
  return { rupees: total + current, used };
}

/** One Tamil word to a value, or to a scale (நூறு, ஆயிரம், லட்சம்). Joined forms like இருநூற்றைம்பது are split greedily. */
function parseTamilNumberWord(word: string): { value: number; scale?: number } | null {
  let rest = word.replace(/[.,]/g, '');
  if (!/[஀-௿]/.test(rest)) return null;
  let value = 0;
  let matched = false;
  let guard = 0;
  while (rest.length && guard++ < 6) {
    const scale = TA_SCALES.find(([re]) => re.test(rest));
    if (scale && !matched) {
      return { value: 0, scale: scale[1] };
    }
    const hit = TA_WORDS.find(([s]) => rest.startsWith(s));
    if (!hit) break;
    value += hit[1];
    matched = true;
    rest = rest.slice(hit[0].length).replace(/^(்று|்|ு|த்து|ம்)/, '');
  }
  if (!matched) return null;
  // "ஆயிரத்து" style endings on a joined word mean thousands.
  if (/^ஆயிர(ம்|த்து)?$/.test(rest)) return { value: 0, scale: 1000 };
  // Anything else left means this was a word that only starts like a number, such as the name ஆறுமுகம்.
  if (rest.length) return null;
  return { value };
}

const TA_LETTERS: Record<string, string> = {
  அ: 'a', ஆ: 'a', இ: 'i', ஈ: 'i', உ: 'u', ஊ: 'u', எ: 'e', ஏ: 'e', ஐ: 'ai', ஒ: 'o', ஓ: 'o', ஔ: 'au',
  க: 'k', ங: 'n', ச: 's', ஞ: 'n', ட: 't', ண: 'n', த: 't', ந: 'n', ப: 'p', ம: 'm', ய: 'y', ர: 'r', ல: 'l', வ: 'v', ழ: 'l',
  ள: 'l', ற: 'r', ன: 'n', ஜ: 'j', ஷ: 's', ஸ: 's', ஹ: 'h', 'ா': 'a', 'ி': 'i', 'ீ': 'i', 'ு': 'u', 'ூ': 'u', 'ெ': 'e', 'ே': 'e',
  'ை': 'ai', 'ொ': 'o', 'ோ': 'o', 'ௌ': 'au', '்': '',
};

/** Rough Tamil to Latin letters, so a Tamil spoken name can match a name saved in English. */
export function tamilToLatin(s: string): string {
  let out = '';
  const chars = [...s];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const m = TA_LETTERS[c];
    if (m === undefined) {
      out += c;
      continue;
    }
    out += m;
    // A consonant with no vowel sign or virama after it carries an inherent "a".
    const isConsonant = /[கஙசஞடணதநபமயரலவழளறனஜஷஸஹ]/.test(c);
    const next = chars[i + 1];
    if (isConsonant && (next === undefined || !/[ா-்]/.test(next))) out += 'a';
  }
  return out;
}

/** Consonant skeleton used for fuzzy name matching: spelling and accent differences mostly vanish. */
export function nameKey(s: string): string {
  return tamilToLatin(s.toLowerCase())
    .normalize('NFKD')
    .replace(/[^a-z]/g, '')
    .replace(/th/g, 't').replace(/dh/g, 't').replace(/d/g, 't').replace(/zh/g, 'l').replace(/sh|ch|c|j|z/g, 's')
    .replace(/g/g, 'k').replace(/b/g, 'p').replace(/w/g, 'v').replace(/f/g, 'p').replace(/q/g, 'k').replace(/x/g, 'ks')
    .replace(/[aeiouy]/g, '')
    .replace(/(.)\1+/g, '$1');
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Normalised Levenshtein distance on the skeletons.
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - dp[a.length][b.length] / Math.max(a.length, b.length);
}

export interface SpokenMatch<T> {
  customer: T;
  /** 0 to 1; 1 is an exact match on the name or customer code. */
  score: number;
}

export interface SpokenEntry<T> {
  /** Amount in paise, or null when none was heard. */
  amount: number | null;
  /** Best customer matches, best first (at most 3). */
  matches: SpokenMatch<T>[];
  /** The words that were taken as the name. */
  heard: string;
}

/**
 * Reads a spoken or typed collection like "Murugan 500" or "முருகன் ஐநூறு ரூபாய்" against the customers of a route.
 * Works offline: it only uses the route list already on the phone. The agent always confirms before anything is saved.
 */
export function parseSpokenEntry<T extends { id: string; name: string; code?: string | null }>(text: string, customers: T[]): SpokenEntry<T> {
  const words = text
    .replace(/[^\p{L}\p{M}\p{N}₹.,\s-]/gu, ' ')
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const amount = parseSpokenAmount(words);
  const nameWords = words.filter((w, i) => !amount?.used.has(i) && !CURRENCY_WORDS.test(w) && !/^(paid|gave|collected|kodutharu|கொடுத்தார்|கட்டினார்|வசூல்)$/i.test(w));
  const heard = nameWords.join(' ');
  const key = nameKey(heard);
  const scored = customers
    .map((c) => {
      const code = (c.code ?? '').toLowerCase();
      if (code && nameWords.some((w) => w.toLowerCase() === code || code.endsWith('-' + w.toLowerCase()))) return { customer: c, score: 1 };
      const full = nameKey(c.name);
      // A spoken first name should match a saved "Murugan S" or "S. Murugan".
      const parts = c.name.split(/[\s.]+/).filter((p) => p.length > 1).map(nameKey);
      const best = Math.max(similarity(key, full), ...parts.map((p) => similarity(key, p)));
      return { customer: c, score: best };
    })
    .filter((m) => m.score >= 0.65)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  return { amount: amount ? Math.round(amount.rupees * 100) : null, matches: scored, heard };
}

// =====================================================================
// Smart visit order
// =====================================================================

export interface VisitStop {
  id: string;
  lat: number | null;
  lng: number | null;
  pin: string; // PAID | PARTIAL | MISSED | NOTHING_DUE | PENDING
  dueNow: number;
  daysPastDue: number;
  /** Promise-to-pay date still open (YYYY-MM-DD), if any. */
  promiseDate?: string | null;
  /** Hour of day (0 to 23, IST) this customer usually pays at, if known. */
  usualHour?: number | null;
}

export type VisitReasonKey = 'promiseToday' | 'promiseMissed' | 'late' | 'usualTime' | 'dueToday' | 'nearby' | 'done';
export interface VisitPlanItem {
  id: string;
  reasons: { key: VisitReasonKey; values?: Record<string, number> }[];
}

/**
 * Suggests who to visit first: open promises and long-late customers first, then those who usually pay around now,
 * then the rest by nearest next. Done or nothing-due customers go last. Runs on the phone, offline.
 */
export function smartVisitOrder(stops: VisitStop[], opts: { today: string; hour: number; here?: { lat: number; lng: number } | null }): VisitPlanItem[] {
  const open = stops.filter((s) => s.pin === 'PENDING' || s.pin === 'PARTIAL' || s.pin === 'MISSED');
  const done = stops.filter((s) => !open.includes(s));
  const priority = (s: VisitStop) => {
    let p = 0;
    if (s.promiseDate && s.promiseDate === opts.today) p += 60;
    else if (s.promiseDate && s.promiseDate < opts.today) p += 40;
    p += Math.min(40, s.daysPastDue * 2);
    if (s.usualHour != null) {
      const gap = s.usualHour - opts.hour;
      // Due within the next two hours: go now. Already past their usual time: still a bit higher.
      if (gap >= 0 && gap <= 2) p += 25;
      else if (gap < 0 && gap >= -2) p += 10;
    }
    if (s.pin === 'MISSED') p -= 15; // already called on today, try again later
    return p;
  };
  // Bands of 20 points keep the order stable; inside a band go by distance so the agent doesn't zig-zag.
  const bands = new Map<number, VisitStop[]>();
  for (const s of open) {
    const b = Math.floor(priority(s) / 20);
    bands.set(b, [...(bands.get(b) ?? []), s]);
  }
  let here = opts.here ?? null;
  const ordered: VisitStop[] = [];
  for (const b of [...bands.keys()].sort((x, y) => y - x)) {
    const group = bands.get(b)!;
    const located = group.filter((s) => s.lat != null && s.lng != null) as (VisitStop & { lat: number; lng: number })[];
    const rest = group.filter((s) => s.lat == null || s.lng == null).sort((x, y) => priority(y) - priority(x));
    while (located.length) {
      let k = 0;
      if (here) {
        let best = Infinity;
        located.forEach((s, i) => {
          const d = distanceMetres(here!, s);
          if (d < best) {
            best = d;
            k = i;
          }
        });
      } else located.sort((x, y) => priority(y) - priority(x));
      const [next] = located.splice(k, 1);
      ordered.push(next);
      here = { lat: next.lat, lng: next.lng };
    }
    ordered.push(...rest);
  }
  const plan = ordered.map((s): VisitPlanItem => {
    const reasons: VisitPlanItem['reasons'] = [];
    if (s.promiseDate === opts.today) reasons.push({ key: 'promiseToday' });
    else if (s.promiseDate && s.promiseDate < opts.today) reasons.push({ key: 'promiseMissed' });
    if (s.daysPastDue > 0) reasons.push({ key: 'late', values: { days: s.daysPastDue } });
    if (s.usualHour != null && Math.abs(s.usualHour - opts.hour) <= 2) reasons.push({ key: 'usualTime', values: { hour: s.usualHour } });
    if (!reasons.length) reasons.push({ key: s.dueNow > 0 ? 'dueToday' : 'nearby' });
    return { id: s.id, reasons };
  });
  return [...plan, ...done.map((s) => ({ id: s.id, reasons: [{ key: 'done' as const }] }))];
}
