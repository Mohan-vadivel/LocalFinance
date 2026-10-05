export const ROLES = [
  'SUPER_ADMIN',
  'TENANT_ADMIN',
  'BRANCH_MANAGER',
  'LOAN_OFFICER',
  'COLLECTION_AGENT',
  'ACCOUNTANT',
  'AUDITOR',
] as const;
export type RoleCode = (typeof ROLES)[number];

export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/**
 * FLAT: interestRate is the total interest for the whole loan, as % of principal.
 * REDUCING: interestRate is the annual rate (EMI on reducing balance).
 * UPFRONT: interestRate % of principal is deducted at disbursement; customer repays the principal.
 */
export const INTEREST_METHODS = ['FLAT', 'REDUCING', 'UPFRONT'] as const;
export type InterestMethod = (typeof INTEREST_METHODS)[number];

export const PENALTY_TYPES = ['NONE', 'FIXED_PER_DAY', 'PERCENT_PER_DAY'] as const;
export type PenaltyType = (typeof PENALTY_TYPES)[number];

export const PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK'] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const LOAN_STATUSES = [
  'REQUESTED',
  'SENT_BACK',
  'APPROVED',
  'REJECTED',
  'ACTIVE',
  'CLOSED',
  'FORECLOSED',
  'WRITTEN_OFF',
] as const;
export type LoanStatus = (typeof LOAN_STATUSES)[number];

export const VISIT_OUTCOMES = ['PAID', 'PARTIAL', 'NOT_HOME', 'REFUSED', 'PROMISED'] as const;
export type VisitOutcome = (typeof VISIT_OUTCOMES)[number];

export const TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export const FUND_SOURCE_TYPES = ['OWNER_CAPITAL', 'INVESTOR', 'BANK_LOAN', 'OTHER'] as const;
export type FundSourceType = (typeof FUND_SOURCE_TYPES)[number];

export const INVESTOR_RETURN_TYPES = ['FIXED_MONTHLY', 'PROFIT_SHARE'] as const;
export type InvestorReturnType = (typeof INVESTOR_RETURN_TYPES)[number];

export const INVESTOR_TXN_TYPES = ['INVESTMENT', 'RETURN_DUE', 'PAYOUT', 'WITHDRAWAL'] as const;
export type InvestorTxnType = (typeof INVESTOR_TXN_TYPES)[number];

export const DAYBOOK_CATEGORIES_SYSTEM = [
  'LOAN_DISBURSEMENT',
  'COLLECTION',
  'PROCESSING_FEE',
  'UPFRONT_INTEREST',
  'INVESTOR_IN',
  'INVESTOR_PAYOUT',
  'INVESTOR_WITHDRAWAL',
  'CAPITAL_IN',
  'FUND_TRANSFER_IN',
  'FUND_TRANSFER_OUT',
  'REVERSAL',
] as const;
export type DaybookSystemCategory = (typeof DAYBOOK_CATEGORIES_SYSTEM)[number];

export const LEDGER_TYPES = ['DISBURSEMENT', 'INSTALMENT', 'PENALTY', 'WAIVER', 'REVERSAL', 'WRITE_OFF', 'OPENING'] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const PL_BASIS = ['CASH', 'ACCRUAL'] as const;
export type PlBasis = (typeof PL_BASIS)[number];
