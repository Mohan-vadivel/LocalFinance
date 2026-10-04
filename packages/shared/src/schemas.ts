import { z } from 'zod';
import {
  FREQUENCIES,
  FUND_SOURCE_TYPES,
  INTEREST_METHODS,
  INVESTOR_RETURN_TYPES,
  PAYMENT_MODES,
  PENALTY_TYPES,
  PL_BASIS,
  ROLES,
  TENANT_STATUSES,
  VISIT_OUTCOMES,
} from './enums';
import { PERMISSIONS } from './permissions';

const id = z.string().min(1);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const paise = z.number().int().nonnegative();
const positivePaise = z.number().int().positive();
const phone = z.string().regex(/^[0-9+][0-9 -]{6,15}$/, 'Invalid phone number');
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const optStr = z.string().trim().max(500).optional().nullable();

export const loginSchema = z.object({
  login: z.string().trim().min(3), // phone or email
  password: z.string().min(6),
  tenantId: id.optional(),
  deviceId: z.string().max(200).optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(6),
  newPassword: z.string().min(8),
});

export const tenantSettingsSchema = z.object({
  currency: z.string().length(3).default('INR'),
  defaultLanguage: z.string().min(2).max(10).default('en'),
  financialYearStartMonth: z.number().int().min(1).max(12).default(4),
  workingDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  holidays: z.array(date).default([]),
  paymentOrder: z.enum(['PENALTY_FIRST', 'PENALTY_LAST']).default('PENALTY_FIRST'),
  plBasis: z.enum(PL_BASIS).default('CASH'),
  geoCheckMetres: z.number().int().min(0).default(200),
  receiptFooter: z.string().max(300).default(''),
  smsTemplates: z.record(z.string(), z.string()).default({}),
});
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;

export const createTenantSchema = z.object({
  name: z.string().trim().min(2),
  businessId: z.string().trim().max(50).optional(),
  ownerName: z.string().trim().min(2),
  ownerPhone: phone,
  ownerEmail: z.string().email().optional(),
  ownerPassword: z.string().min(8),
  plan: z.string().default('STANDARD'),
  maxBranches: z.number().int().positive().default(10),
  maxStaff: z.number().int().positive().default(100),
  maxActiveLoans: z.number().int().positive().default(50_000),
});
export const updateTenantSchema = z.object({
  name: z.string().trim().min(2).optional(),
  plan: z.string().optional(),
  status: z.enum(TENANT_STATUSES).optional(),
  maxBranches: z.number().int().positive().optional(),
  maxStaff: z.number().int().positive().optional(),
  maxActiveLoans: z.number().int().positive().optional(),
  logoUrl: z.string().url().optional().nullable(),
  settings: tenantSettingsSchema.partial().optional(),
});

export const branchSchema = z.object({
  name: z.string().trim().min(2),
  code: z.string().trim().min(1).max(20),
  address: optStr,
  lat: lat.optional().nullable(),
  lng: lng.optional().nullable(),
  managerId: id.optional().nullable(),
  active: z.boolean().optional(),
});

export const locationSchema = z.object({
  branchId: id,
  name: z.string().trim().min(2),
  lat: lat.optional().nullable(),
  lng: lng.optional().nullable(),
  notes: optStr,
  active: z.boolean().optional(),
});

export const routeSchema = z.object({
  locationId: id,
  name: z.string().trim().min(2),
  collectionDays: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5, 6]),
  active: z.boolean().optional(),
});
export const routeOrderSchema = z.object({ customerIds: z.array(id) });
export const routeAssignSchema = z.object({
  userId: id,
  fromDate: date,
  toDate: date.optional().nullable(),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2),
  baseRole: z.enum(ROLES),
  permissions: z.array(z.enum(PERMISSIONS)),
});

export const staffSchema = z.object({
  name: z.string().trim().min(2),
  phone,
  email: z.string().email().optional().nullable(),
  password: z.string().min(8).optional(),
  roleId: id,
  branchIds: z.array(id).min(1),
  approvalLimit: paise.default(0),
  language: z.string().default('en'),
  photoUrl: z.string().optional().nullable(),
  idProof: optStr,
  active: z.boolean().optional(),
});

export const customerSchema = z.object({
  name: z.string().trim().min(2),
  phone,
  altPhone: phone.optional().nullable(),
  address: z.string().trim().min(3),
  landmark: optStr,
  lat: lat.optional().nullable(),
  lng: lng.optional().nullable(),
  photoUrl: optStr,
  idType: z.enum(['AADHAAR', 'PAN', 'VOTER_ID', 'DRIVING_LICENCE', 'OTHER']).optional().nullable(),
  idNumber: z.string().trim().max(30).optional().nullable(),
  occupation: optStr,
  monthlyIncome: paise.optional().nullable(),
  language: z.string().default('en'),
  locationId: id,
  routeId: id.optional().nullable(),
  routeSeq: z.number().int().positive().optional().nullable(),
  guarantorName: optStr,
  guarantorPhone: phone.optional().nullable(),
  guarantorRelation: optStr,
  /** Client-generated id for offline-created customers (prevents duplicates on retry). */
  clientRef: z.string().max(100).optional(),
});
export const customerStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'BLACKLISTED', 'CLOSED']),
  reason: z.string().trim().min(3).optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(2),
  frequency: z.enum(FREQUENCIES),
  minAmount: positivePaise,
  maxAmount: positivePaise,
  tenure: z.number().int().positive().max(1000),
  interestMethod: z.enum(INTEREST_METHODS),
  interestRate: z.number().min(0).max(500),
  feePercent: z.number().min(0).max(50).default(0),
  feeFlat: paise.default(0),
  penaltyType: z.enum(PENALTY_TYPES).default('NONE'),
  penaltyValue: z.number().min(0).default(0),
  graceDays: z.number().int().min(0).default(0),
  active: z.boolean().optional(),
});

export const loanRequestSchema = z.object({
  customerId: id,
  productId: id,
  principal: positivePaise,
  purpose: optStr,
  notes: optStr,
  clientRef: z.string().max(100).optional(),
});
export const loanDecisionSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT', 'SEND_BACK']),
  reason: z.string().trim().max(500).optional(),
});
export const disburseSchema = z.object({
  disbursedOn: date,
  firstDueDate: date.optional(),
  mode: z.enum(PAYMENT_MODES),
  fundId: id,
  reference: optStr,
});
export const forecloseSchema = z.object({
  date,
  mode: z.enum(PAYMENT_MODES),
  amount: positivePaise,
  /** Interest not yet due that is forgiven on early closure. */
  interestWaived: paise.default(0),
  reason: optStr,
});
export const writeOffSchema = z.object({ date, reason: z.string().trim().min(3) });
export const waivePenaltySchema = z.object({ amount: positivePaise, reason: z.string().trim().min(3) });

export const collectionSchema = z.object({
  loanId: id,
  amount: positivePaise,
  mode: z.enum(PAYMENT_MODES),
  upiRef: optStr,
  collectedAt: z.string().datetime().optional(),
  lat: lat.optional().nullable(),
  lng: lng.optional().nullable(),
  /** Unique id generated on the phone; a retried sync with the same id is ignored. */
  clientRef: z.string().min(8).max(100),
  note: optStr,
});
export const visitSchema = z.object({
  customerId: id,
  loanId: id.optional().nullable(),
  outcome: z.enum(VISIT_OUTCOMES),
  promiseDate: date.optional().nullable(),
  note: optStr,
  lat: lat.optional().nullable(),
  lng: lng.optional().nullable(),
  visitedAt: z.string().datetime().optional(),
  clientRef: z.string().min(8).max(100),
});
export const syncSchema = z.object({
  collections: z.array(collectionSchema).default([]),
  visits: z.array(visitSchema).default([]),
});
export const reverseCollectionSchema = z.object({ reason: z.string().trim().min(3) });

export const fundSchema = z.object({
  name: z.string().trim().min(2),
  sourceType: z.enum(FUND_SOURCE_TYPES),
  branchId: id,
  investorId: id.optional().nullable(),
});
export const fundDepositSchema = z.object({
  amount: positivePaise,
  date,
  mode: z.enum(PAYMENT_MODES),
  note: optStr,
});
export const fundTransferSchema = z.object({
  fromFundId: id,
  toFundId: id.optional().nullable(),
  /** Give cash float to an agent (toUserId) instead of to another fund. */
  toUserId: id.optional().nullable(),
  amount: positivePaise,
  date,
  mode: z.enum(PAYMENT_MODES),
  note: optStr,
});

export const investorSchema = z.object({
  name: z.string().trim().min(2),
  phone,
  address: optStr,
  idProof: optStr,
  bankDetails: optStr,
  nominee: optStr,
  agreementUrl: optStr,
});
export const investmentSchema = z.object({
  investorId: id,
  amount: positivePaise,
  date,
  branchId: id,
  fundId: id,
  mode: z.enum(PAYMENT_MODES),
  returnType: z.enum(INVESTOR_RETURN_TYPES),
  /** FIXED_MONTHLY: % per month. PROFIT_SHARE: % of the branch's net profit before investor returns. */
  returnRate: z.number().min(0).max(100),
  payoutFrequencyMonths: z.number().int().min(1).max(12).default(1),
  maturityDate: date.optional().nullable(),
});
export const investorReturnRunSchema = z.object({ periodStart: date, periodEnd: date });
export const investorPayoutSchema = z.object({
  investmentId: id,
  amount: positivePaise,
  date,
  mode: z.enum(PAYMENT_MODES),
  kind: z.enum(['PAYOUT', 'WITHDRAWAL']),
  fundId: id,
  note: optStr,
});

export const daybookEntrySchema = z.object({
  branchId: id,
  date,
  direction: z.enum(['IN', 'OUT']),
  categoryId: id,
  amount: positivePaise,
  mode: z.enum(PAYMENT_MODES),
  particulars: z.string().trim().min(2).max(300),
  billUrl: optStr,
});
export const expenseCategorySchema = z.object({
  name: z.string().trim().min(2),
  kind: z.enum(['EXPENSE', 'INCOME', 'DRAWING', 'BANK']),
});
export const dayCloseSchema = z.object({ branchId: id, date });

export const handoverSchema = z.object({
  agentId: id,
  branchId: id,
  date,
  received: paise,
  note: optStr,
});

export const reportFilterSchema = z.object({
  from: date.optional(),
  to: date.optional(),
  branchId: id.optional(),
  locationId: id.optional(),
  routeId: id.optional(),
  agentId: id.optional(),
  productId: id.optional(),
});
export type ReportFilter = z.infer<typeof reportFilterSchema>;
