export declare const parseDate: (d: string) => Date;
export declare const fmtDate: (d: Date) => string;
export declare const addDays: (d: string, n: number) => string;
export declare const diffDays: (a: string, b: string) => number;
export declare const weekday: (d: string) => number;
export declare function addMonthsClamped(d: string, n: number, dayOfMonth: number): string;
/** Today's date in India (IST), as YYYY-MM-DD. */
export declare const todayIST: (now?: Date) => string;
export type SummaryPeriod = 'DAY' | 'WEEK' | 'MONTH';
/** The day, the Monday-to-Sunday week, or the calendar month that contains `d`. */
export declare function periodRange(period: SummaryPeriod, d: string): {
    from: string;
    to: string;
};
