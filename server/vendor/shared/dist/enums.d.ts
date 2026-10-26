export declare const ROLES: readonly ["SUPER_ADMIN", "TENANT_ADMIN", "BRANCH_MANAGER", "LOAN_OFFICER", "COLLECTION_AGENT", "ACCOUNTANT", "AUDITOR"];
export type RoleCode = (typeof ROLES)[number];
export declare const FREQUENCIES: readonly ["DAILY", "WEEKLY", "MONTHLY"];
export type Frequency = (typeof FREQUENCIES)[number];
/**
 * FLAT: interestRate is the total interest for the whole loan, as % of principal.
 * REDUCING: interestRate is the annual rate (EMI on reducing balance).
 * UPFRONT: interestRate % of principal is deducted at disbursement; customer repays the principal.
 */
export declare const INTEREST_METHODS: readonly ["FLAT", "REDUCING", "UPFRONT"];
export type InterestMethod = (typeof INTEREST_METHODS)[number];
export declare const PENALTY_TYPES: readonly ["NONE", "FIXED_PER_DAY", "PERCENT_PER_DAY"];
export type PenaltyType = (typeof PENALTY_TYPES)[number];
export declare const PAYMENT_MODES: readonly ["CASH", "UPI", "CARD", "BANK"];
export type PaymentMode = (typeof PAYMENT_MODES)[number];
export declare const LOAN_STATUSES: readonly ["REQUESTED", "SENT_BACK", "APPROVED", "REJECTED", "ACTIVE", "CLOSED", "FORECLOSED", "WRITTEN_OFF"];
export type LoanStatus = (typeof LOAN_STATUSES)[number];
export declare const VISIT_OUTCOMES: readonly ["PAID", "PARTIAL", "NOT_HOME", "REFUSED", "PROMISED"];
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];
export declare const TENANT_STATUSES: readonly ["ACTIVE", "SUSPENDED", "CLOSED"];
export type TenantStatus = (typeof TENANT_STATUSES)[number];
export declare const FUND_SOURCE_TYPES: readonly ["OWNER_CAPITAL", "INVESTOR", "BANK_LOAN", "OTHER"];
export type FundSourceType = (typeof FUND_SOURCE_TYPES)[number];
export declare const INVESTOR_RETURN_TYPES: readonly ["FIXED_MONTHLY", "PROFIT_SHARE"];
export type InvestorReturnType = (typeof INVESTOR_RETURN_TYPES)[number];
export declare const INVESTOR_TXN_TYPES: readonly ["INVESTMENT", "RETURN_DUE", "PAYOUT", "WITHDRAWAL"];
export type InvestorTxnType = (typeof INVESTOR_TXN_TYPES)[number];
export declare const DAYBOOK_CATEGORIES_SYSTEM: readonly ["LOAN_DISBURSEMENT", "COLLECTION", "PROCESSING_FEE", "UPFRONT_INTEREST", "INVESTOR_IN", "INVESTOR_PAYOUT", "INVESTOR_WITHDRAWAL", "CAPITAL_IN", "FUND_TRANSFER_IN", "FUND_TRANSFER_OUT", "REVERSAL"];
export type DaybookSystemCategory = (typeof DAYBOOK_CATEGORIES_SYSTEM)[number];
export declare const LEDGER_TYPES: readonly ["DISBURSEMENT", "INSTALMENT", "PENALTY", "WAIVER", "REVERSAL", "WRITE_OFF", "OPENING"];
export type LedgerType = (typeof LEDGER_TYPES)[number];
export declare const PL_BASIS: readonly ["CASH", "ACCRUAL"];
export type PlBasis = (typeof PL_BASIS)[number];
