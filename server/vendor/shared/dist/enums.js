"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PL_BASIS = exports.LEDGER_TYPES = exports.DAYBOOK_CATEGORIES_SYSTEM = exports.INVESTOR_TXN_TYPES = exports.INVESTOR_RETURN_TYPES = exports.FUND_SOURCE_TYPES = exports.TENANT_STATUSES = exports.VISIT_OUTCOMES = exports.LOAN_STATUSES = exports.PAYMENT_MODES = exports.PENALTY_TYPES = exports.INTEREST_METHODS = exports.FREQUENCIES = exports.ROLES = void 0;
exports.ROLES = [
    'SUPER_ADMIN',
    'TENANT_ADMIN',
    'BRANCH_MANAGER',
    'LOAN_OFFICER',
    'COLLECTION_AGENT',
    'ACCOUNTANT',
    'AUDITOR',
];
exports.FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];
/**
 * FLAT: interestRate is the total interest for the whole loan, as % of principal.
 * REDUCING: interestRate is the annual rate (EMI on reducing balance).
 * UPFRONT: interestRate % of principal is deducted at disbursement; customer repays the principal.
 */
exports.INTEREST_METHODS = ['FLAT', 'REDUCING', 'UPFRONT'];
exports.PENALTY_TYPES = ['NONE', 'FIXED_PER_DAY', 'PERCENT_PER_DAY'];
exports.PAYMENT_MODES = ['CASH', 'UPI', 'CARD', 'BANK'];
exports.LOAN_STATUSES = [
    'REQUESTED',
    'SENT_BACK',
    'APPROVED',
    'REJECTED',
    'ACTIVE',
    'CLOSED',
    'FORECLOSED',
    'WRITTEN_OFF',
];
exports.VISIT_OUTCOMES = ['PAID', 'PARTIAL', 'NOT_HOME', 'REFUSED', 'PROMISED'];
exports.TENANT_STATUSES = ['ACTIVE', 'SUSPENDED', 'CLOSED'];
exports.FUND_SOURCE_TYPES = ['OWNER_CAPITAL', 'INVESTOR', 'BANK_LOAN', 'OTHER'];
exports.INVESTOR_RETURN_TYPES = ['FIXED_MONTHLY', 'PROFIT_SHARE'];
exports.INVESTOR_TXN_TYPES = ['INVESTMENT', 'RETURN_DUE', 'PAYOUT', 'WITHDRAWAL'];
exports.DAYBOOK_CATEGORIES_SYSTEM = [
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
];
exports.LEDGER_TYPES = ['DISBURSEMENT', 'INSTALMENT', 'PENALTY', 'WAIVER', 'REVERSAL', 'WRITE_OFF', 'OPENING'];
exports.PL_BASIS = ['CASH', 'ACCRUAL'];
//# sourceMappingURL=enums.js.map