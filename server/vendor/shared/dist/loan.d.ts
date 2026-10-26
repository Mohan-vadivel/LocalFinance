import type { Frequency, InterestMethod, PenaltyType } from './enums';
export interface LoanTerms {
    principal: number;
    frequency: Frequency;
    tenure: number;
    interestMethod: InterestMethod;
    /** FLAT/UPFRONT: % of principal for the whole loan. REDUCING: annual %. */
    interestRate: number;
    /** Processing fee as % of principal (feePercent) plus a flat amount in paise (feeFlat). */
    feePercent?: number;
    feeFlat?: number;
}
export interface Calendar {
    /** Weekdays that are working days, 0 = Sunday. Defaults to Monday to Saturday. */
    workingDays?: number[];
    /** Holiday dates, YYYY-MM-DD. */
    holidays?: string[];
}
export interface ScheduleRow {
    seq: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    totalDue: number;
}
export interface DisbursementSummary {
    principal: number;
    fee: number;
    upfrontInterest: number;
    /** Cash actually handed to the customer. */
    netDisbursed: number;
    totalInterest: number;
    totalRepayable: number;
}
/** Due dates for each instalment. Daily loans skip off days; weekly and monthly move to the next working day. */
export declare function dueDates(firstDue: string, frequency: Frequency, count: number, cal?: Calendar): string[];
export declare function summarize(terms: LoanTerms): DisbursementSummary;
export declare function generateSchedule(terms: LoanTerms, firstDue: string, cal?: Calendar): ScheduleRow[];
/** First due date: one period after disbursement. */
export declare function defaultFirstDue(disbursedOn: string, frequency: Frequency): string;
export interface InstalmentState {
    id: string;
    seq: number;
    dueDate: string;
    principalDue: number;
    interestDue: number;
    principalPaid: number;
    interestPaid: number;
    /** Date the instalment was fully paid, if it was. */
    paidOn?: string | null;
}
export interface PenaltyRule {
    type: PenaltyType;
    /** FIXED_PER_DAY: paise per day late. PERCENT_PER_DAY: % of the instalment per day late. */
    value: number;
    graceDays: number;
}
export declare const instalmentDue: (i: InstalmentState) => number;
/** Penalty charged so far: per instalment, for each day it was (or still is) unpaid after the grace days. */
export declare function penaltyCharged(instalments: InstalmentState[], rule: PenaltyRule, asOf: string): number;
export interface Allocation {
    penalty: number;
    interest: number;
    principal: number;
    perInstalment: {
        id: string;
        interest: number;
        principal: number;
        fullyPaid: boolean;
    }[];
}
export type PaymentOrder = 'PENALTY_FIRST' | 'PENALTY_LAST';
/**
 * Applies a payment to a loan: penalty (first or last), then each instalment oldest first, interest before
 * principal. Paying ahead of schedule simply fills later instalments. Throws if the amount exceeds what is owed.
 */
export declare function allocatePayment(amount: number, instalments: InstalmentState[], penaltyOutstanding: number, order?: PaymentOrder): Allocation;
export interface LoanPosition {
    principalOutstanding: number;
    interestOutstanding: number;
    penaltyOutstanding: number;
    totalOutstanding: number;
    /** Amount due up to and including asOf that is still unpaid. */
    overdue: number;
    dueToday: number;
    /** Days since the oldest unpaid due date (0 if nothing is overdue). */
    daysPastDue: number;
}
export declare function loanPosition(instalments: InstalmentState[], penalty: {
    charged: number;
    paid: number;
    waived: number;
}, asOf: string): LoanPosition;
export declare const AGEING_BUCKETS: readonly [{
    readonly key: "d1_7";
    readonly min: 1;
    readonly max: 7;
}, {
    readonly key: "d8_30";
    readonly min: 8;
    readonly max: 30;
}, {
    readonly key: "d31_90";
    readonly min: 31;
    readonly max: 90;
}, {
    readonly key: "d90_plus";
    readonly min: 91;
    readonly max: number;
}];
export declare function ageingBucket(daysPastDue: number): (typeof AGEING_BUCKETS)[number]['key'] | null;
/** Risk grade from repayment history: A best, D worst. Advisory only. */
export declare function riskGrade(h: {
    loans: number;
    onTimeRatio: number;
    maxDaysLate: number;
    writtenOff: number;
}): 'A' | 'B' | 'C' | 'D' | 'NEW';
/** Haversine distance in metres. */
export declare function distanceMetres(a: {
    lat: number;
    lng: number;
}, b: {
    lat: number;
    lng: number;
}): number;
/** Nearest-neighbour visiting order from a start point; returns ids in order. */
export declare function suggestRouteOrder<T extends {
    id: string;
    lat: number | null;
    lng: number | null;
}>(start: {
    lat: number;
    lng: number;
} | null, stops: T[]): string[];
