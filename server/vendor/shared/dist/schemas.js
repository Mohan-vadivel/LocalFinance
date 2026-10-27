"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.platformSettingsSchema = exports.helpVideoSchema = exports.HELP_VIDEO_LANGUAGES = exports.reportFilterSchema = exports.handoverSchema = exports.dayCloseSchema = exports.salaryPaySchema = exports.salaryAdvanceSchema = exports.salaryRateSchema = exports.expenseCategorySchema = exports.daybookRejectSchema = exports.DAYBOOK_REQUEST_STATUSES = exports.daybookEntrySchema = exports.investorPayoutSchema = exports.investorReturnRunSchema = exports.investmentSchema = exports.investorSchema = exports.fundTransferSchema = exports.fundDepositSchema = exports.fundSchema = exports.reverseCollectionSchema = exports.syncSchema = exports.visitSchema = exports.collectionSchema = exports.waivePenaltySchema = exports.writeOffSchema = exports.forecloseSchema = exports.disburseSchema = exports.loanDecisionSchema = exports.loanRequestSchema = exports.productSchema = exports.customerStatusSchema = exports.customerSchema = exports.staffSchema = exports.roleSchema = exports.routeAssignSchema = exports.routeOrderSchema = exports.routeSchema = exports.locationSchema = exports.branchSchema = exports.updateTenantSchema = exports.createTenantSchema = exports.tenantSettingsSchema = exports.changePasswordSchema = exports.switchTenantSchema = exports.loginSchema = void 0;
const zod_1 = require("zod");
const enums_1 = require("./enums");
const permissions_1 = require("./permissions");
const i18n_1 = require("./i18n");
const id = zod_1.z.string().min(1);
const date = zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const paise = zod_1.z.number().int().nonnegative();
const positivePaise = zod_1.z.number().int().positive();
const phone = zod_1.z.string().regex(/^[0-9+][0-9 -]{6,15}$/, 'Invalid phone number');
const lat = zod_1.z.number().min(-90).max(90);
const lng = zod_1.z.number().min(-180).max(180);
const optStr = zod_1.z.string().trim().max(500).optional().nullable();
/** A calendar date that exists (2026-02-30 is refused). */
const realDate = date.refine((d) => {
    const t = Date.parse(`${d}T00:00:00Z`);
    return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === d;
}, 'Not a real date');
const month = zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
exports.loginSchema = zod_1.z.object({
    login: zod_1.z.string().trim().min(3), // phone or email
    password: zod_1.z.string().min(6),
    tenantId: id.optional(),
    deviceId: zod_1.z.string().max(200).optional(),
});
/** Moving to another business the same phone number has an account in; that account's own password is needed. */
exports.switchTenantSchema = zod_1.z.object({
    tenantId: id,
    password: zod_1.z.string().min(6),
    deviceId: zod_1.z.string().max(200).optional(),
});
exports.changePasswordSchema = zod_1.z.object({
    currentPassword: zod_1.z.string().min(6),
    newPassword: zod_1.z.string().min(8),
});
exports.tenantSettingsSchema = zod_1.z.object({
    currency: zod_1.z.string().length(3).default('INR'),
    defaultLanguage: zod_1.z.string().min(2).max(10).default('en'),
    financialYearStartMonth: zod_1.z.number().int().min(1).max(12).default(4),
    workingDays: zod_1.z.array(zod_1.z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
    holidays: zod_1.z.array(date).default([]),
    paymentOrder: zod_1.z.enum(['PENALTY_FIRST', 'PENALTY_LAST']).default('PENALTY_FIRST'),
    plBasis: zod_1.z.enum(enums_1.PL_BASIS).default('CASH'),
    geoCheckMetres: zod_1.z.number().int().min(0).default(200),
    receiptFooter: zod_1.z.string().max(300).default(''),
    smsTemplates: zod_1.z.record(zod_1.z.string(), zod_1.z.string()).default({}),
    /**
     * AI features that send this business's data to Claude (Anthropic): ask in plain words, the morning briefing write-up,
     * ID card reading and reminder drafts. Off until the owner turns it on. Features that run on our own server are always on.
     */
    aiEnabled: zod_1.z.boolean().default(false),
    /** What the collection receipt SMS tells the customer besides the amount received. */
    smsShowArrears: zod_1.z.boolean().default(true),
    smsShowBalance: zod_1.z.boolean().default(true),
});
exports.createTenantSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    businessId: zod_1.z.string().trim().max(50).optional(),
    ownerName: zod_1.z.string().trim().min(2),
    ownerPhone: phone,
    ownerEmail: zod_1.z.string().email().optional(),
    ownerPassword: zod_1.z.string().min(8),
    plan: zod_1.z.string().default('STANDARD'),
    planExpiresOn: realDate.optional().nullable(),
    maxBranches: zod_1.z.number().int().positive().default(10),
    maxStaff: zod_1.z.number().int().positive().default(100),
    maxActiveLoans: zod_1.z.number().int().positive().default(50_000),
});
exports.updateTenantSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2).optional(),
    plan: zod_1.z.string().optional(),
    planExpiresOn: realDate.optional().nullable(),
    status: zod_1.z.enum(enums_1.TENANT_STATUSES).optional(),
    maxBranches: zod_1.z.number().int().positive().optional(),
    maxStaff: zod_1.z.number().int().positive().optional(),
    maxActiveLoans: zod_1.z.number().int().positive().optional(),
    logoUrl: zod_1.z.string().url().optional().nullable(),
    settings: exports.tenantSettingsSchema.partial().optional(),
});
exports.branchSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    code: zod_1.z.string().trim().min(1).max(20),
    address: optStr,
    lat: lat.optional().nullable(),
    lng: lng.optional().nullable(),
    managerId: id.optional().nullable(),
    active: zod_1.z.boolean().optional(),
});
exports.locationSchema = zod_1.z.object({
    branchId: id,
    name: zod_1.z.string().trim().min(2),
    lat: lat.optional().nullable(),
    lng: lng.optional().nullable(),
    notes: optStr,
    active: zod_1.z.boolean().optional(),
});
/**
 * A route covers one or more areas. locationIds[0] is the main area. `locationId` (one area) is still accepted so
 * older apps keep working; the parsed output always has `locationIds`, with duplicates removed.
 */
exports.routeSchema = zod_1.z
    .object({
    locationIds: zod_1.z.array(id).min(1, 'Choose at least one area').max(20).optional(),
    locationId: id.optional(),
    name: zod_1.z.string().trim().min(2),
    collectionDays: zod_1.z.array(zod_1.z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
    active: zod_1.z.boolean().optional(),
})
    .refine((r) => (r.locationIds?.length ?? 0) > 0 || !!r.locationId, { message: 'Choose at least one area', path: ['locationIds'] })
    .transform(({ locationIds, locationId, ...rest }) => ({ ...rest, locationIds: [...new Set(locationIds?.length ? locationIds : [locationId])] }));
exports.routeOrderSchema = zod_1.z.object({ customerIds: zod_1.z.array(id) });
exports.routeAssignSchema = zod_1.z.object({
    userId: id,
    fromDate: date,
    toDate: date.optional().nullable(),
});
exports.roleSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    baseRole: zod_1.z.enum(enums_1.ROLES),
    permissions: zod_1.z.array(zod_1.z.enum(permissions_1.PERMISSIONS)),
});
exports.staffSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    phone,
    email: zod_1.z.string().email().optional().nullable(),
    password: zod_1.z.string().min(8).optional(),
    roleId: id,
    branchIds: zod_1.z.array(id).min(1),
    approvalLimit: paise.default(0),
    language: zod_1.z.string().default('en'),
    photoUrl: zod_1.z.string().optional().nullable(),
    idProof: optStr,
    active: zod_1.z.boolean().optional(),
});
exports.customerSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    phone,
    altPhone: phone.optional().nullable(),
    address: zod_1.z.string().trim().min(3),
    landmark: optStr,
    lat: lat.optional().nullable(),
    lng: lng.optional().nullable(),
    photoUrl: optStr,
    idType: zod_1.z.enum(['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'OTHER']).optional().nullable(),
    idNumber: zod_1.z.string().trim().max(30).optional().nullable(),
    occupation: optStr,
    monthlyIncome: paise.optional().nullable(),
    language: zod_1.z.string().default('en'),
    locationId: id,
    routeId: id.optional().nullable(),
    routeSeq: zod_1.z.number().int().positive().optional().nullable(),
    guarantorName: optStr,
    guarantorPhone: phone.optional().nullable(),
    guarantorRelation: optStr,
    /** Client-generated id for offline-created customers (prevents duplicates on retry). */
    clientRef: zod_1.z.string().max(100).optional(),
});
exports.customerStatusSchema = zod_1.z.object({
    status: zod_1.z.enum(['ACTIVE', 'BLACKLISTED', 'CLOSED']),
    reason: zod_1.z.string().trim().min(3).optional(),
});
exports.productSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    frequency: zod_1.z.enum(enums_1.FREQUENCIES),
    minAmount: positivePaise,
    maxAmount: positivePaise,
    tenure: zod_1.z.number().int().positive().max(1000),
    interestMethod: zod_1.z.enum(enums_1.INTEREST_METHODS),
    interestRate: zod_1.z.number().min(0).max(500),
    feePercent: zod_1.z.number().min(0).max(50).default(0),
    feeFlat: paise.default(0),
    penaltyType: zod_1.z.enum(enums_1.PENALTY_TYPES).default('NONE'),
    penaltyValue: zod_1.z.number().min(0).default(0),
    graceDays: zod_1.z.number().int().min(0).default(0),
    active: zod_1.z.boolean().optional(),
});
exports.loanRequestSchema = zod_1.z.object({
    customerId: id,
    productId: id,
    principal: positivePaise,
    /**
     * Documentation or processing fee for this loan, in paise, in place of the product's fee. It is kept from the cash
     * paid out (a 10,000 loan with a 100 fee pays out 9,900) and the customer still repays the full principal. Left
     * out, the product's fee applies.
     */
    processingFee: paise.optional().nullable(),
    purpose: optStr,
    notes: optStr,
    clientRef: zod_1.z.string().max(100).optional(),
});
exports.loanDecisionSchema = zod_1.z.object({
    decision: zod_1.z.enum(['APPROVE', 'REJECT', 'SEND_BACK']),
    reason: zod_1.z.string().trim().max(500).optional(),
});
exports.disburseSchema = zod_1.z.object({
    disbursedOn: date,
    firstDueDate: date.optional(),
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    fundId: id,
    reference: optStr,
});
exports.forecloseSchema = zod_1.z.object({
    date,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    amount: positivePaise,
    /** Interest not yet due that is forgiven on early closure. */
    interestWaived: paise.default(0),
    reason: optStr,
});
exports.writeOffSchema = zod_1.z.object({ date, reason: zod_1.z.string().trim().min(3) });
exports.waivePenaltySchema = zod_1.z.object({ amount: positivePaise, reason: zod_1.z.string().trim().min(3) });
exports.collectionSchema = zod_1.z.object({
    loanId: id,
    amount: positivePaise,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    upiRef: optStr,
    collectedAt: zod_1.z.string().datetime().optional(),
    lat: lat.optional().nullable(),
    lng: lng.optional().nullable(),
    /** Unique id generated on the phone; a retried sync with the same id is ignored. */
    clientRef: zod_1.z.string().min(8).max(100),
    note: optStr,
    /** Office entry on behalf of the agent who collected the money (needs handover or reversal rights). */
    agentId: id.optional(),
});
exports.visitSchema = zod_1.z.object({
    customerId: id,
    loanId: id.optional().nullable(),
    outcome: zod_1.z.enum(enums_1.VISIT_OUTCOMES),
    promiseDate: date.optional().nullable(),
    note: optStr,
    lat: lat.optional().nullable(),
    lng: lng.optional().nullable(),
    visitedAt: zod_1.z.string().datetime().optional(),
    clientRef: zod_1.z.string().min(8).max(100),
});
exports.syncSchema = zod_1.z.object({
    collections: zod_1.z.array(exports.collectionSchema).default([]),
    visits: zod_1.z.array(exports.visitSchema).default([]),
});
exports.reverseCollectionSchema = zod_1.z.object({ reason: zod_1.z.string().trim().min(3) });
exports.fundSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    sourceType: zod_1.z.enum(enums_1.FUND_SOURCE_TYPES),
    branchId: id,
    investorId: id.optional().nullable(),
});
exports.fundDepositSchema = zod_1.z.object({
    amount: positivePaise,
    date,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    note: optStr,
});
exports.fundTransferSchema = zod_1.z.object({
    fromFundId: id,
    toFundId: id.optional().nullable(),
    /** Give cash float to an agent (toUserId) instead of to another fund. */
    toUserId: id.optional().nullable(),
    amount: positivePaise,
    date,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    note: optStr,
});
exports.investorSchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    phone,
    address: optStr,
    idProof: optStr,
    bankDetails: optStr,
    nominee: optStr,
    agreementUrl: optStr,
});
exports.investmentSchema = zod_1.z.object({
    investorId: id,
    amount: positivePaise,
    date,
    branchId: id,
    fundId: id,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    returnType: zod_1.z.enum(enums_1.INVESTOR_RETURN_TYPES),
    /** FIXED_MONTHLY: % per month. PROFIT_SHARE: % of the branch's net profit before investor returns. */
    returnRate: zod_1.z.number().min(0).max(100),
    payoutFrequencyMonths: zod_1.z.number().int().min(1).max(12).default(1),
    maturityDate: date.optional().nullable(),
});
exports.investorReturnRunSchema = zod_1.z.object({ periodStart: date, periodEnd: date });
exports.investorPayoutSchema = zod_1.z.object({
    investmentId: id,
    amount: positivePaise,
    date,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    kind: zod_1.z.enum(['PAYOUT', 'WITHDRAWAL']),
    fundId: id,
    note: optStr,
});
exports.daybookEntrySchema = zod_1.z.object({
    branchId: id,
    date,
    direction: zod_1.z.enum(['IN', 'OUT']),
    categoryId: id,
    amount: positivePaise,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    particulars: zod_1.z.string().trim().min(2).max(300),
    billUrl: optStr,
});
exports.DAYBOOK_REQUEST_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'];
exports.daybookRejectSchema = zod_1.z.object({
    reason: zod_1.z.string().trim().min(3).max(300),
    /** Who must answer for the rejected amount; the person who entered it when omitted. */
    responsibleId: id.optional(),
});
exports.expenseCategorySchema = zod_1.z.object({
    name: zod_1.z.string().trim().min(2),
    kind: zod_1.z.enum(['EXPENSE', 'INCOME', 'DRAWING', 'BANK']),
});
/** Staff salaries: the monthly amount, advances paid against it, and each month's payment net of advances. */
exports.salaryRateSchema = zod_1.z.object({ amount: paise });
exports.salaryAdvanceSchema = zod_1.z.object({
    userId: id,
    branchId: id,
    date,
    amount: positivePaise,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    note: optStr,
});
exports.salaryPaySchema = zod_1.z.object({
    userId: id,
    branchId: id,
    month,
    date,
    mode: zod_1.z.enum(enums_1.PAYMENT_MODES),
    /** Advances to take back from this payment; all that is outstanding (up to the salary) when omitted. */
    advanceDeduct: paise.optional(),
    note: optStr,
});
exports.dayCloseSchema = zod_1.z.object({ branchId: id, date });
exports.handoverSchema = zod_1.z.object({
    agentId: id,
    branchId: id,
    date,
    received: paise,
    note: optStr,
});
exports.reportFilterSchema = zod_1.z.object({
    from: date.optional(),
    to: date.optional(),
    branchId: id.optional(),
    locationId: id.optional(),
    routeId: id.optional(),
    agentId: id.optional(),
    productId: id.optional(),
});
exports.HELP_VIDEO_LANGUAGES = i18n_1.LANGUAGE_CODES;
exports.helpVideoSchema = zod_1.z.object({
    title: zod_1.z.string().trim().min(2).max(120),
    language: zod_1.z.enum(exports.HELP_VIDEO_LANGUAGES),
    url: zod_1.z
        .string()
        .trim()
        .url()
        .refine((u) => /^https:\/\/((www|m)\.)?(youtube\.com|youtu\.be)\//i.test(u), 'Use a YouTube link'),
});
/** Settings for the whole platform, edited by the Super Admin: support contacts, help videos and plan renewal by UPI. */
exports.platformSettingsSchema = zod_1.z.object({
    supportPhone: phone.nullable(),
    supportEmail: zod_1.z.string().trim().email().nullable(),
    supportHours: zod_1.z.string().trim().max(200).nullable(),
    helpVideos: zod_1.z.array(exports.helpVideoSchema).max(50),
    upiId: zod_1.z
        .string()
        .trim()
        .regex(/^[\w.-]{2,256}@[A-Za-z][\w]{1,64}$/, 'Invalid UPI ID')
        .nullable(),
    upiName: zod_1.z.string().trim().min(2).max(60),
    yearlyPrice: paise,
});
//# sourceMappingURL=schemas.js.map