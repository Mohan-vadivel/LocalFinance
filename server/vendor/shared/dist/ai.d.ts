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
export type RiskReasonKey = 'newCustomer' | 'blacklisted' | 'writtenOff' | 'onTimeHigh' | 'onTimeLow' | 'recentSlip' | 'recentGood' | 'lateNow' | 'veryLateBefore' | 'missedMany' | 'repaidBefore' | 'manyActive' | 'biggerThanBefore';
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
export declare function riskScore(h: RiskInput): RiskResult;
/** Reads an amount in rupees from words like "500", "1,500", "five hundred", "ஐநூற்று ஐம்பது". Null when there is none. */
export declare function parseSpokenAmount(words: string[]): {
    rupees: number;
    used: Set<number>;
} | null;
/** Rough Tamil to Latin letters, so a Tamil spoken name can match a name saved in English. */
export declare function tamilToLatin(s: string): string;
/** Consonant skeleton used for fuzzy name matching: spelling and accent differences mostly vanish. */
export declare function nameKey(s: string): string;
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
export declare function parseSpokenEntry<T extends {
    id: string;
    name: string;
    code?: string | null;
}>(text: string, customers: T[]): SpokenEntry<T>;
export interface VisitStop {
    id: string;
    lat: number | null;
    lng: number | null;
    pin: string;
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
    reasons: {
        key: VisitReasonKey;
        values?: Record<string, number>;
    }[];
}
/**
 * Suggests who to visit first: open promises and long-late customers first, then those who usually pay around now,
 * then the rest by nearest next. Done or nothing-due customers go last. Runs on the phone, offline.
 */
export declare function smartVisitOrder(stops: VisitStop[], opts: {
    today: string;
    hour: number;
    here?: {
        lat: number;
        lng: number;
    } | null;
}): VisitPlanItem[];
