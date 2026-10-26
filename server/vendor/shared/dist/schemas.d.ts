import { z } from 'zod';
export declare const loginSchema: z.ZodObject<{
    login: z.ZodString;
    password: z.ZodString;
    tenantId: z.ZodOptional<z.ZodString>;
    deviceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    login: string;
    password: string;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
}, {
    login: string;
    password: string;
    tenantId?: string | undefined;
    deviceId?: string | undefined;
}>;
/** Moving to another business the same phone number has an account in; that account's own password is needed. */
export declare const switchTenantSchema: z.ZodObject<{
    tenantId: z.ZodString;
    password: z.ZodString;
    deviceId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    password: string;
    tenantId: string;
    deviceId?: string | undefined;
}, {
    password: string;
    tenantId: string;
    deviceId?: string | undefined;
}>;
export declare const changePasswordSchema: z.ZodObject<{
    currentPassword: z.ZodString;
    newPassword: z.ZodString;
}, "strip", z.ZodTypeAny, {
    currentPassword: string;
    newPassword: string;
}, {
    currentPassword: string;
    newPassword: string;
}>;
export declare const tenantSettingsSchema: z.ZodObject<{
    currency: z.ZodDefault<z.ZodString>;
    defaultLanguage: z.ZodDefault<z.ZodString>;
    financialYearStartMonth: z.ZodDefault<z.ZodNumber>;
    workingDays: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    holidays: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    paymentOrder: z.ZodDefault<z.ZodEnum<["PENALTY_FIRST", "PENALTY_LAST"]>>;
    plBasis: z.ZodDefault<z.ZodEnum<["CASH", "ACCRUAL"]>>;
    geoCheckMetres: z.ZodDefault<z.ZodNumber>;
    receiptFooter: z.ZodDefault<z.ZodString>;
    smsTemplates: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>;
    /**
     * AI features that send this business's data to Claude (Anthropic): ask in plain words, the morning briefing write-up,
     * ID card reading and reminder drafts. Off until the owner turns it on. Features that run on our own server are always on.
     */
    aiEnabled: z.ZodDefault<z.ZodBoolean>;
    /** What the collection receipt SMS tells the customer besides the amount received. */
    smsShowArrears: z.ZodDefault<z.ZodBoolean>;
    smsShowBalance: z.ZodDefault<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    defaultLanguage: string;
    workingDays: number[];
    holidays: string[];
    paymentOrder: "PENALTY_FIRST" | "PENALTY_LAST";
    plBasis: "CASH" | "ACCRUAL";
    receiptFooter: string;
    smsTemplates: Record<string, string>;
    smsShowArrears: boolean;
    smsShowBalance: boolean;
    currency: string;
    financialYearStartMonth: number;
    geoCheckMetres: number;
    aiEnabled: boolean;
}, {
    defaultLanguage?: string | undefined;
    workingDays?: number[] | undefined;
    holidays?: string[] | undefined;
    paymentOrder?: "PENALTY_FIRST" | "PENALTY_LAST" | undefined;
    plBasis?: "CASH" | "ACCRUAL" | undefined;
    receiptFooter?: string | undefined;
    smsTemplates?: Record<string, string> | undefined;
    smsShowArrears?: boolean | undefined;
    smsShowBalance?: boolean | undefined;
    currency?: string | undefined;
    financialYearStartMonth?: number | undefined;
    geoCheckMetres?: number | undefined;
    aiEnabled?: boolean | undefined;
}>;
export type TenantSettings = z.infer<typeof tenantSettingsSchema>;
export declare const createTenantSchema: z.ZodObject<{
    name: z.ZodString;
    businessId: z.ZodOptional<z.ZodString>;
    ownerName: z.ZodString;
    ownerPhone: z.ZodString;
    ownerEmail: z.ZodOptional<z.ZodString>;
    ownerPassword: z.ZodString;
    plan: z.ZodDefault<z.ZodString>;
    planExpiresOn: z.ZodNullable<z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>>;
    maxBranches: z.ZodDefault<z.ZodNumber>;
    maxStaff: z.ZodDefault<z.ZodNumber>;
    maxActiveLoans: z.ZodDefault<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    name: string;
    plan: string;
    ownerName: string;
    ownerPhone: string;
    ownerPassword: string;
    maxBranches: number;
    maxStaff: number;
    maxActiveLoans: number;
    businessId?: string | undefined;
    ownerEmail?: string | undefined;
    planExpiresOn?: string | null | undefined;
}, {
    name: string;
    ownerName: string;
    ownerPhone: string;
    ownerPassword: string;
    plan?: string | undefined;
    businessId?: string | undefined;
    ownerEmail?: string | undefined;
    maxBranches?: number | undefined;
    maxStaff?: number | undefined;
    maxActiveLoans?: number | undefined;
    planExpiresOn?: string | null | undefined;
}>;
export declare const updateTenantSchema: z.ZodObject<{
    name: z.ZodOptional<z.ZodString>;
    plan: z.ZodOptional<z.ZodString>;
    planExpiresOn: z.ZodNullable<z.ZodOptional<z.ZodEffects<z.ZodString, string, string>>>;
    status: z.ZodOptional<z.ZodEnum<["ACTIVE", "SUSPENDED", "CLOSED"]>>;
    maxBranches: z.ZodOptional<z.ZodNumber>;
    maxStaff: z.ZodOptional<z.ZodNumber>;
    maxActiveLoans: z.ZodOptional<z.ZodNumber>;
    logoUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    settings: z.ZodOptional<z.ZodObject<{
        currency: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        defaultLanguage: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        financialYearStartMonth: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        workingDays: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>>;
        holidays: z.ZodOptional<z.ZodDefault<z.ZodArray<z.ZodString, "many">>>;
        paymentOrder: z.ZodOptional<z.ZodDefault<z.ZodEnum<["PENALTY_FIRST", "PENALTY_LAST"]>>>;
        plBasis: z.ZodOptional<z.ZodDefault<z.ZodEnum<["CASH", "ACCRUAL"]>>>;
        geoCheckMetres: z.ZodOptional<z.ZodDefault<z.ZodNumber>>;
        receiptFooter: z.ZodOptional<z.ZodDefault<z.ZodString>>;
        smsTemplates: z.ZodOptional<z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodString>>>;
        aiEnabled: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        smsShowArrears: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
        smsShowBalance: z.ZodOptional<z.ZodDefault<z.ZodBoolean>>;
    }, "strip", z.ZodTypeAny, {
        defaultLanguage?: string | undefined;
        workingDays?: number[] | undefined;
        holidays?: string[] | undefined;
        paymentOrder?: "PENALTY_FIRST" | "PENALTY_LAST" | undefined;
        plBasis?: "CASH" | "ACCRUAL" | undefined;
        receiptFooter?: string | undefined;
        smsTemplates?: Record<string, string> | undefined;
        smsShowArrears?: boolean | undefined;
        smsShowBalance?: boolean | undefined;
        currency?: string | undefined;
        financialYearStartMonth?: number | undefined;
        geoCheckMetres?: number | undefined;
        aiEnabled?: boolean | undefined;
    }, {
        defaultLanguage?: string | undefined;
        workingDays?: number[] | undefined;
        holidays?: string[] | undefined;
        paymentOrder?: "PENALTY_FIRST" | "PENALTY_LAST" | undefined;
        plBasis?: "CASH" | "ACCRUAL" | undefined;
        receiptFooter?: string | undefined;
        smsTemplates?: Record<string, string> | undefined;
        smsShowArrears?: boolean | undefined;
        smsShowBalance?: boolean | undefined;
        currency?: string | undefined;
        financialYearStartMonth?: number | undefined;
        geoCheckMetres?: number | undefined;
        aiEnabled?: boolean | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    name?: string | undefined;
    status?: "ACTIVE" | "CLOSED" | "SUSPENDED" | undefined;
    settings?: {
        defaultLanguage?: string | undefined;
        workingDays?: number[] | undefined;
        holidays?: string[] | undefined;
        paymentOrder?: "PENALTY_FIRST" | "PENALTY_LAST" | undefined;
        plBasis?: "CASH" | "ACCRUAL" | undefined;
        receiptFooter?: string | undefined;
        smsTemplates?: Record<string, string> | undefined;
        smsShowArrears?: boolean | undefined;
        smsShowBalance?: boolean | undefined;
        currency?: string | undefined;
        financialYearStartMonth?: number | undefined;
        geoCheckMetres?: number | undefined;
        aiEnabled?: boolean | undefined;
    } | undefined;
    plan?: string | undefined;
    maxBranches?: number | undefined;
    maxStaff?: number | undefined;
    maxActiveLoans?: number | undefined;
    planExpiresOn?: string | null | undefined;
    logoUrl?: string | null | undefined;
}, {
    name?: string | undefined;
    status?: "ACTIVE" | "CLOSED" | "SUSPENDED" | undefined;
    settings?: {
        defaultLanguage?: string | undefined;
        workingDays?: number[] | undefined;
        holidays?: string[] | undefined;
        paymentOrder?: "PENALTY_FIRST" | "PENALTY_LAST" | undefined;
        plBasis?: "CASH" | "ACCRUAL" | undefined;
        receiptFooter?: string | undefined;
        smsTemplates?: Record<string, string> | undefined;
        smsShowArrears?: boolean | undefined;
        smsShowBalance?: boolean | undefined;
        currency?: string | undefined;
        financialYearStartMonth?: number | undefined;
        geoCheckMetres?: number | undefined;
        aiEnabled?: boolean | undefined;
    } | undefined;
    plan?: string | undefined;
    maxBranches?: number | undefined;
    maxStaff?: number | undefined;
    maxActiveLoans?: number | undefined;
    planExpiresOn?: string | null | undefined;
    logoUrl?: string | null | undefined;
}>;
export declare const branchSchema: z.ZodObject<{
    name: z.ZodString;
    code: z.ZodString;
    address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    managerId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    code: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    address?: string | null | undefined;
    active?: boolean | undefined;
    managerId?: string | null | undefined;
}, {
    name: string;
    code: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    address?: string | null | undefined;
    active?: boolean | undefined;
    managerId?: string | null | undefined;
}>;
export declare const locationSchema: z.ZodObject<{
    branchId: z.ZodString;
    name: z.ZodString;
    lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    branchId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    active?: boolean | undefined;
    notes?: string | null | undefined;
}, {
    name: string;
    branchId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    active?: boolean | undefined;
    notes?: string | null | undefined;
}>;
/**
 * A route covers one or more areas. locationIds[0] is the main area. `locationId` (one area) is still accepted so
 * older apps keep working; the parsed output always has `locationIds`, with duplicates removed.
 */
export declare const routeSchema: z.ZodEffects<z.ZodEffects<z.ZodObject<{
    locationIds: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    locationId: z.ZodOptional<z.ZodString>;
    name: z.ZodString;
    collectionDays: z.ZodDefault<z.ZodArray<z.ZodNumber, "many">>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    collectionDays: number[];
    active?: boolean | undefined;
    locationIds?: string[] | undefined;
    locationId?: string | undefined;
}, {
    name: string;
    active?: boolean | undefined;
    collectionDays?: number[] | undefined;
    locationIds?: string[] | undefined;
    locationId?: string | undefined;
}>, {
    name: string;
    collectionDays: number[];
    active?: boolean | undefined;
    locationIds?: string[] | undefined;
    locationId?: string | undefined;
}, {
    name: string;
    active?: boolean | undefined;
    collectionDays?: number[] | undefined;
    locationIds?: string[] | undefined;
    locationId?: string | undefined;
}>, {
    locationIds: string[];
    name: string;
    collectionDays: number[];
    active?: boolean | undefined;
}, {
    name: string;
    active?: boolean | undefined;
    collectionDays?: number[] | undefined;
    locationIds?: string[] | undefined;
    locationId?: string | undefined;
}>;
export declare const routeOrderSchema: z.ZodObject<{
    customerIds: z.ZodArray<z.ZodString, "many">;
}, "strip", z.ZodTypeAny, {
    customerIds: string[];
}, {
    customerIds: string[];
}>;
export declare const routeAssignSchema: z.ZodObject<{
    userId: z.ZodString;
    fromDate: z.ZodString;
    toDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    fromDate: string;
    userId: string;
    toDate?: string | null | undefined;
}, {
    fromDate: string;
    userId: string;
    toDate?: string | null | undefined;
}>;
export declare const roleSchema: z.ZodObject<{
    name: z.ZodString;
    baseRole: z.ZodEnum<["SUPER_ADMIN", "TENANT_ADMIN", "BRANCH_MANAGER", "LOAN_OFFICER", "COLLECTION_AGENT", "ACCOUNTANT", "AUDITOR"]>;
    permissions: z.ZodArray<z.ZodEnum<["tenant.manage", "settings.manage", "branch.manage", "staff.manage", "customer.create", "customer.edit", "customer.view", "loan.request", "loan.approve", "loan.disburse", "loan.manage", "fund.manage", "investor.manage", "salary.manage", "route.manage", "collection.record", "collection.reverse", "handover.verify", "daybook.manage", "daybook.view", "daybook.request", "daybook.approve", "report.view", "pl.view", "audit.view"]>, "many">;
}, "strip", z.ZodTypeAny, {
    name: string;
    baseRole: "SUPER_ADMIN" | "TENANT_ADMIN" | "BRANCH_MANAGER" | "LOAN_OFFICER" | "COLLECTION_AGENT" | "ACCOUNTANT" | "AUDITOR";
    permissions: ("tenant.manage" | "settings.manage" | "branch.manage" | "staff.manage" | "customer.create" | "customer.edit" | "customer.view" | "loan.request" | "loan.approve" | "loan.disburse" | "loan.manage" | "fund.manage" | "investor.manage" | "salary.manage" | "route.manage" | "collection.record" | "collection.reverse" | "handover.verify" | "daybook.manage" | "daybook.view" | "daybook.request" | "daybook.approve" | "report.view" | "pl.view" | "audit.view")[];
}, {
    name: string;
    baseRole: "SUPER_ADMIN" | "TENANT_ADMIN" | "BRANCH_MANAGER" | "LOAN_OFFICER" | "COLLECTION_AGENT" | "ACCOUNTANT" | "AUDITOR";
    permissions: ("tenant.manage" | "settings.manage" | "branch.manage" | "staff.manage" | "customer.create" | "customer.edit" | "customer.view" | "loan.request" | "loan.approve" | "loan.disburse" | "loan.manage" | "fund.manage" | "investor.manage" | "salary.manage" | "route.manage" | "collection.record" | "collection.reverse" | "handover.verify" | "daybook.manage" | "daybook.view" | "daybook.request" | "daybook.approve" | "report.view" | "pl.view" | "audit.view")[];
}>;
export declare const staffSchema: z.ZodObject<{
    name: z.ZodString;
    phone: z.ZodString;
    email: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    password: z.ZodOptional<z.ZodString>;
    roleId: z.ZodString;
    branchIds: z.ZodArray<z.ZodString, "many">;
    approvalLimit: z.ZodDefault<z.ZodNumber>;
    language: z.ZodDefault<z.ZodString>;
    photoUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    idProof: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    name: string;
    phone: string;
    language: string;
    approvalLimit: number;
    roleId: string;
    branchIds: string[];
    active?: boolean | undefined;
    password?: string | undefined;
    idProof?: string | null | undefined;
    email?: string | null | undefined;
    photoUrl?: string | null | undefined;
}, {
    name: string;
    phone: string;
    roleId: string;
    branchIds: string[];
    active?: boolean | undefined;
    language?: string | undefined;
    password?: string | undefined;
    approvalLimit?: number | undefined;
    idProof?: string | null | undefined;
    email?: string | null | undefined;
    photoUrl?: string | null | undefined;
}>;
export declare const customerSchema: z.ZodObject<{
    name: z.ZodString;
    phone: z.ZodString;
    altPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    address: z.ZodString;
    landmark: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    photoUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    idType: z.ZodNullable<z.ZodOptional<z.ZodEnum<["AADHAAR", "PAN", "VOTER_ID", "DRIVING_LICENCE", "OTHER"]>>>;
    idNumber: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    occupation: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    monthlyIncome: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    language: z.ZodDefault<z.ZodString>;
    locationId: z.ZodString;
    routeId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    routeSeq: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    guarantorName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guarantorPhone: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    guarantorRelation: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Client-generated id for offline-created customers (prevents duplicates on retry). */
    clientRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    phone: string;
    address: string;
    language: string;
    locationId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    altPhone?: string | null | undefined;
    occupation?: string | null | undefined;
    idNumber?: string | null | undefined;
    routeId?: string | null | undefined;
    landmark?: string | null | undefined;
    idType?: "OTHER" | "PAN" | "AADHAAR" | "VOTER_ID" | "DRIVING_LICENCE" | null | undefined;
    monthlyIncome?: number | null | undefined;
    guarantorName?: string | null | undefined;
    guarantorPhone?: string | null | undefined;
    routeSeq?: number | null | undefined;
    photoUrl?: string | null | undefined;
    guarantorRelation?: string | null | undefined;
    clientRef?: string | undefined;
}, {
    name: string;
    phone: string;
    address: string;
    locationId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    altPhone?: string | null | undefined;
    occupation?: string | null | undefined;
    idNumber?: string | null | undefined;
    routeId?: string | null | undefined;
    language?: string | undefined;
    landmark?: string | null | undefined;
    idType?: "OTHER" | "PAN" | "AADHAAR" | "VOTER_ID" | "DRIVING_LICENCE" | null | undefined;
    monthlyIncome?: number | null | undefined;
    guarantorName?: string | null | undefined;
    guarantorPhone?: string | null | undefined;
    routeSeq?: number | null | undefined;
    photoUrl?: string | null | undefined;
    guarantorRelation?: string | null | undefined;
    clientRef?: string | undefined;
}>;
export declare const customerStatusSchema: z.ZodObject<{
    status: z.ZodEnum<["ACTIVE", "BLACKLISTED", "CLOSED"]>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    status: "ACTIVE" | "CLOSED" | "BLACKLISTED";
    reason?: string | undefined;
}, {
    status: "ACTIVE" | "CLOSED" | "BLACKLISTED";
    reason?: string | undefined;
}>;
export declare const productSchema: z.ZodObject<{
    name: z.ZodString;
    frequency: z.ZodEnum<["DAILY", "WEEKLY", "MONTHLY"]>;
    minAmount: z.ZodNumber;
    maxAmount: z.ZodNumber;
    tenure: z.ZodNumber;
    interestMethod: z.ZodEnum<["FLAT", "REDUCING", "UPFRONT"]>;
    interestRate: z.ZodNumber;
    feePercent: z.ZodDefault<z.ZodNumber>;
    feeFlat: z.ZodDefault<z.ZodNumber>;
    penaltyType: z.ZodDefault<z.ZodEnum<["NONE", "FIXED_PER_DAY", "PERCENT_PER_DAY"]>>;
    penaltyValue: z.ZodDefault<z.ZodNumber>;
    graceDays: z.ZodDefault<z.ZodNumber>;
    active: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    tenure: number;
    name: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    minAmount: number;
    maxAmount: number;
    interestMethod: "FLAT" | "REDUCING" | "UPFRONT";
    interestRate: number;
    feePercent: number;
    feeFlat: number;
    penaltyType: "NONE" | "FIXED_PER_DAY" | "PERCENT_PER_DAY";
    penaltyValue: number;
    graceDays: number;
    active?: boolean | undefined;
}, {
    tenure: number;
    name: string;
    frequency: "DAILY" | "WEEKLY" | "MONTHLY";
    minAmount: number;
    maxAmount: number;
    interestMethod: "FLAT" | "REDUCING" | "UPFRONT";
    interestRate: number;
    active?: boolean | undefined;
    feePercent?: number | undefined;
    feeFlat?: number | undefined;
    penaltyType?: "NONE" | "FIXED_PER_DAY" | "PERCENT_PER_DAY" | undefined;
    penaltyValue?: number | undefined;
    graceDays?: number | undefined;
}>;
export declare const loanRequestSchema: z.ZodObject<{
    customerId: z.ZodString;
    productId: z.ZodString;
    principal: z.ZodNumber;
    purpose: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    notes: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    clientRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    principal: number;
    productId: string;
    customerId: string;
    notes?: string | null | undefined;
    purpose?: string | null | undefined;
    clientRef?: string | undefined;
}, {
    principal: number;
    productId: string;
    customerId: string;
    notes?: string | null | undefined;
    purpose?: string | null | undefined;
    clientRef?: string | undefined;
}>;
export declare const loanDecisionSchema: z.ZodObject<{
    decision: z.ZodEnum<["APPROVE", "REJECT", "SEND_BACK"]>;
    reason: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    decision: "APPROVE" | "REJECT" | "SEND_BACK";
    reason?: string | undefined;
}, {
    decision: "APPROVE" | "REJECT" | "SEND_BACK";
    reason?: string | undefined;
}>;
export declare const disburseSchema: z.ZodObject<{
    disbursedOn: z.ZodString;
    firstDueDate: z.ZodOptional<z.ZodString>;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    fundId: z.ZodString;
    reference: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    fundId: string;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    disbursedOn: string;
    firstDueDate?: string | undefined;
    reference?: string | null | undefined;
}, {
    fundId: string;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    disbursedOn: string;
    firstDueDate?: string | undefined;
    reference?: string | null | undefined;
}>;
export declare const forecloseSchema: z.ZodObject<{
    date: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    amount: z.ZodNumber;
    /** Interest not yet due that is forgiven on early closure. */
    interestWaived: z.ZodDefault<z.ZodNumber>;
    reason: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    interestWaived: number;
    reason?: string | null | undefined;
}, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    reason?: string | null | undefined;
    interestWaived?: number | undefined;
}>;
export declare const writeOffSchema: z.ZodObject<{
    date: z.ZodString;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    date: string;
    reason: string;
}, {
    date: string;
    reason: string;
}>;
export declare const waivePenaltySchema: z.ZodObject<{
    amount: z.ZodNumber;
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    amount: number;
    reason: string;
}, {
    amount: number;
    reason: string;
}>;
export declare const collectionSchema: z.ZodObject<{
    loanId: z.ZodString;
    amount: z.ZodNumber;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    upiRef: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    collectedAt: z.ZodOptional<z.ZodString>;
    lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    /** Unique id generated on the phone; a retried sync with the same id is ignored. */
    clientRef: z.ZodString;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Office entry on behalf of the agent who collected the money (needs handover or reversal rights). */
    agentId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    clientRef: string;
    loanId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    upiRef?: string | null | undefined;
    note?: string | null | undefined;
    collectedAt?: string | undefined;
    agentId?: string | undefined;
}, {
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    clientRef: string;
    loanId: string;
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    upiRef?: string | null | undefined;
    note?: string | null | undefined;
    collectedAt?: string | undefined;
    agentId?: string | undefined;
}>;
export declare const visitSchema: z.ZodObject<{
    customerId: z.ZodString;
    loanId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    outcome: z.ZodEnum<["PAID", "PARTIAL", "NOT_HOME", "REFUSED", "PROMISED"]>;
    promiseDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
    visitedAt: z.ZodOptional<z.ZodString>;
    clientRef: z.ZodString;
}, "strip", z.ZodTypeAny, {
    clientRef: string;
    customerId: string;
    outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    promiseDate?: string | null | undefined;
    note?: string | null | undefined;
    loanId?: string | null | undefined;
    visitedAt?: string | undefined;
}, {
    clientRef: string;
    customerId: string;
    outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
    lat?: number | null | undefined;
    lng?: number | null | undefined;
    promiseDate?: string | null | undefined;
    note?: string | null | undefined;
    loanId?: string | null | undefined;
    visitedAt?: string | undefined;
}>;
export declare const syncSchema: z.ZodObject<{
    collections: z.ZodDefault<z.ZodArray<z.ZodObject<{
        loanId: z.ZodString;
        amount: z.ZodNumber;
        mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
        upiRef: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        collectedAt: z.ZodOptional<z.ZodString>;
        lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        /** Unique id generated on the phone; a retried sync with the same id is ignored. */
        clientRef: z.ZodString;
        note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        /** Office entry on behalf of the agent who collected the money (needs handover or reversal rights). */
        agentId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        amount: number;
        mode: "CASH" | "UPI" | "CARD" | "BANK";
        clientRef: string;
        loanId: string;
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        upiRef?: string | null | undefined;
        note?: string | null | undefined;
        collectedAt?: string | undefined;
        agentId?: string | undefined;
    }, {
        amount: number;
        mode: "CASH" | "UPI" | "CARD" | "BANK";
        clientRef: string;
        loanId: string;
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        upiRef?: string | null | undefined;
        note?: string | null | undefined;
        collectedAt?: string | undefined;
        agentId?: string | undefined;
    }>, "many">>;
    visits: z.ZodDefault<z.ZodArray<z.ZodObject<{
        customerId: z.ZodString;
        loanId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        outcome: z.ZodEnum<["PAID", "PARTIAL", "NOT_HOME", "REFUSED", "PROMISED"]>;
        promiseDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
        lat: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        lng: z.ZodNullable<z.ZodOptional<z.ZodNumber>>;
        visitedAt: z.ZodOptional<z.ZodString>;
        clientRef: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        clientRef: string;
        customerId: string;
        outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        promiseDate?: string | null | undefined;
        note?: string | null | undefined;
        loanId?: string | null | undefined;
        visitedAt?: string | undefined;
    }, {
        clientRef: string;
        customerId: string;
        outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        promiseDate?: string | null | undefined;
        note?: string | null | undefined;
        loanId?: string | null | undefined;
        visitedAt?: string | undefined;
    }>, "many">>;
}, "strip", z.ZodTypeAny, {
    collections: {
        amount: number;
        mode: "CASH" | "UPI" | "CARD" | "BANK";
        clientRef: string;
        loanId: string;
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        upiRef?: string | null | undefined;
        note?: string | null | undefined;
        collectedAt?: string | undefined;
        agentId?: string | undefined;
    }[];
    visits: {
        clientRef: string;
        customerId: string;
        outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        promiseDate?: string | null | undefined;
        note?: string | null | undefined;
        loanId?: string | null | undefined;
        visitedAt?: string | undefined;
    }[];
}, {
    collections?: {
        amount: number;
        mode: "CASH" | "UPI" | "CARD" | "BANK";
        clientRef: string;
        loanId: string;
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        upiRef?: string | null | undefined;
        note?: string | null | undefined;
        collectedAt?: string | undefined;
        agentId?: string | undefined;
    }[] | undefined;
    visits?: {
        clientRef: string;
        customerId: string;
        outcome: "PAID" | "PARTIAL" | "NOT_HOME" | "REFUSED" | "PROMISED";
        lat?: number | null | undefined;
        lng?: number | null | undefined;
        promiseDate?: string | null | undefined;
        note?: string | null | undefined;
        loanId?: string | null | undefined;
        visitedAt?: string | undefined;
    }[] | undefined;
}>;
export declare const reverseCollectionSchema: z.ZodObject<{
    reason: z.ZodString;
}, "strip", z.ZodTypeAny, {
    reason: string;
}, {
    reason: string;
}>;
export declare const fundSchema: z.ZodObject<{
    name: z.ZodString;
    sourceType: z.ZodEnum<["OWNER_CAPITAL", "INVESTOR", "BANK_LOAN", "OTHER"]>;
    branchId: z.ZodString;
    investorId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    branchId: string;
    sourceType: "OWNER_CAPITAL" | "INVESTOR" | "BANK_LOAN" | "OTHER";
    investorId?: string | null | undefined;
}, {
    name: string;
    branchId: string;
    sourceType: "OWNER_CAPITAL" | "INVESTOR" | "BANK_LOAN" | "OTHER";
    investorId?: string | null | undefined;
}>;
export declare const fundDepositSchema: z.ZodObject<{
    amount: z.ZodNumber;
    date: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    note?: string | null | undefined;
}, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    note?: string | null | undefined;
}>;
export declare const fundTransferSchema: z.ZodObject<{
    fromFundId: z.ZodString;
    toFundId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Give cash float to an agent (toUserId) instead of to another fund. */
    toUserId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    amount: z.ZodNumber;
    date: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    fromFundId: string;
    note?: string | null | undefined;
    toFundId?: string | null | undefined;
    toUserId?: string | null | undefined;
}, {
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    fromFundId: string;
    note?: string | null | undefined;
    toFundId?: string | null | undefined;
    toUserId?: string | null | undefined;
}>;
export declare const investorSchema: z.ZodObject<{
    name: z.ZodString;
    phone: z.ZodString;
    address: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    idProof: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    bankDetails: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    nominee: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    agreementUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    name: string;
    phone: string;
    address?: string | null | undefined;
    idProof?: string | null | undefined;
    bankDetails?: string | null | undefined;
    nominee?: string | null | undefined;
    agreementUrl?: string | null | undefined;
}, {
    name: string;
    phone: string;
    address?: string | null | undefined;
    idProof?: string | null | undefined;
    bankDetails?: string | null | undefined;
    nominee?: string | null | undefined;
    agreementUrl?: string | null | undefined;
}>;
export declare const investmentSchema: z.ZodObject<{
    investorId: z.ZodString;
    amount: z.ZodNumber;
    date: z.ZodString;
    branchId: z.ZodString;
    fundId: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    returnType: z.ZodEnum<["FIXED_MONTHLY", "PROFIT_SHARE"]>;
    /** FIXED_MONTHLY: % per month. PROFIT_SHARE: % of the branch's net profit before investor returns. */
    returnRate: z.ZodNumber;
    payoutFrequencyMonths: z.ZodDefault<z.ZodNumber>;
    maturityDate: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    fundId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    returnType: "FIXED_MONTHLY" | "PROFIT_SHARE";
    returnRate: number;
    investorId: string;
    payoutFrequencyMonths: number;
    maturityDate?: string | null | undefined;
}, {
    branchId: string;
    fundId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    returnType: "FIXED_MONTHLY" | "PROFIT_SHARE";
    returnRate: number;
    investorId: string;
    maturityDate?: string | null | undefined;
    payoutFrequencyMonths?: number | undefined;
}>;
export declare const investorReturnRunSchema: z.ZodObject<{
    periodStart: z.ZodString;
    periodEnd: z.ZodString;
}, "strip", z.ZodTypeAny, {
    periodStart: string;
    periodEnd: string;
}, {
    periodStart: string;
    periodEnd: string;
}>;
export declare const investorPayoutSchema: z.ZodObject<{
    investmentId: z.ZodString;
    amount: z.ZodNumber;
    date: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    kind: z.ZodEnum<["PAYOUT", "WITHDRAWAL"]>;
    fundId: z.ZodString;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    fundId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    investmentId: string;
    kind: "PAYOUT" | "WITHDRAWAL";
    note?: string | null | undefined;
}, {
    fundId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    investmentId: string;
    kind: "PAYOUT" | "WITHDRAWAL";
    note?: string | null | undefined;
}>;
export declare const daybookEntrySchema: z.ZodObject<{
    branchId: z.ZodString;
    date: z.ZodString;
    direction: z.ZodEnum<["IN", "OUT"]>;
    categoryId: z.ZodString;
    amount: z.ZodNumber;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    particulars: z.ZodString;
    billUrl: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    particulars: string;
    direction: "IN" | "OUT";
    categoryId: string;
    billUrl?: string | null | undefined;
}, {
    branchId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    particulars: string;
    direction: "IN" | "OUT";
    categoryId: string;
    billUrl?: string | null | undefined;
}>;
export declare const DAYBOOK_REQUEST_STATUSES: readonly ["PENDING", "APPROVED", "REJECTED"];
export declare const daybookRejectSchema: z.ZodObject<{
    reason: z.ZodString;
    /** Who must answer for the rejected amount; the person who entered it when omitted. */
    responsibleId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    reason: string;
    responsibleId?: string | undefined;
}, {
    reason: string;
    responsibleId?: string | undefined;
}>;
export declare const expenseCategorySchema: z.ZodObject<{
    name: z.ZodString;
    kind: z.ZodEnum<["EXPENSE", "INCOME", "DRAWING", "BANK"]>;
}, "strip", z.ZodTypeAny, {
    name: string;
    kind: "BANK" | "EXPENSE" | "INCOME" | "DRAWING";
}, {
    name: string;
    kind: "BANK" | "EXPENSE" | "INCOME" | "DRAWING";
}>;
/** Staff salaries: the monthly amount, advances paid against it, and each month's payment net of advances. */
export declare const salaryRateSchema: z.ZodObject<{
    amount: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    amount: number;
}, {
    amount: number;
}>;
export declare const salaryAdvanceSchema: z.ZodObject<{
    userId: z.ZodString;
    branchId: z.ZodString;
    date: z.ZodString;
    amount: z.ZodNumber;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    userId: string;
    note?: string | null | undefined;
}, {
    branchId: string;
    date: string;
    amount: number;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    userId: string;
    note?: string | null | undefined;
}>;
export declare const salaryPaySchema: z.ZodObject<{
    userId: z.ZodString;
    branchId: z.ZodString;
    month: z.ZodString;
    date: z.ZodString;
    mode: z.ZodEnum<["CASH", "UPI", "CARD", "BANK"]>;
    /** Advances to take back from this payment; all that is outstanding (up to the salary) when omitted. */
    advanceDeduct: z.ZodOptional<z.ZodNumber>;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    date: string;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    month: string;
    userId: string;
    note?: string | null | undefined;
    advanceDeduct?: number | undefined;
}, {
    branchId: string;
    date: string;
    mode: "CASH" | "UPI" | "CARD" | "BANK";
    month: string;
    userId: string;
    note?: string | null | undefined;
    advanceDeduct?: number | undefined;
}>;
export declare const dayCloseSchema: z.ZodObject<{
    branchId: z.ZodString;
    date: z.ZodString;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    date: string;
}, {
    branchId: string;
    date: string;
}>;
export declare const handoverSchema: z.ZodObject<{
    agentId: z.ZodString;
    branchId: z.ZodString;
    date: z.ZodString;
    received: z.ZodNumber;
    note: z.ZodNullable<z.ZodOptional<z.ZodString>>;
}, "strip", z.ZodTypeAny, {
    received: number;
    branchId: string;
    date: string;
    agentId: string;
    note?: string | null | undefined;
}, {
    received: number;
    branchId: string;
    date: string;
    agentId: string;
    note?: string | null | undefined;
}>;
export declare const reportFilterSchema: z.ZodObject<{
    from: z.ZodOptional<z.ZodString>;
    to: z.ZodOptional<z.ZodString>;
    branchId: z.ZodOptional<z.ZodString>;
    locationId: z.ZodOptional<z.ZodString>;
    routeId: z.ZodOptional<z.ZodString>;
    agentId: z.ZodOptional<z.ZodString>;
    productId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    branchId?: string | undefined;
    routeId?: string | undefined;
    productId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    locationId?: string | undefined;
    agentId?: string | undefined;
}, {
    branchId?: string | undefined;
    routeId?: string | undefined;
    productId?: string | undefined;
    from?: string | undefined;
    to?: string | undefined;
    locationId?: string | undefined;
    agentId?: string | undefined;
}>;
export type ReportFilter = z.infer<typeof reportFilterSchema>;
export declare const HELP_VIDEO_LANGUAGES: ["en" | "ta" | "te" | "ml" | "kn" | "hi", ...("en" | "ta" | "te" | "ml" | "kn" | "hi")[]];
export declare const helpVideoSchema: z.ZodObject<{
    title: z.ZodString;
    language: z.ZodEnum<["en" | "ta" | "te" | "ml" | "kn" | "hi", ...("en" | "ta" | "te" | "ml" | "kn" | "hi")[]]>;
    url: z.ZodEffects<z.ZodString, string, string>;
}, "strip", z.ZodTypeAny, {
    language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
    title: string;
    url: string;
}, {
    language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
    title: string;
    url: string;
}>;
export type HelpVideo = z.infer<typeof helpVideoSchema>;
/** Settings for the whole platform, edited by the Super Admin: support contacts, help videos and plan renewal by UPI. */
export declare const platformSettingsSchema: z.ZodObject<{
    supportPhone: z.ZodNullable<z.ZodString>;
    supportEmail: z.ZodNullable<z.ZodString>;
    supportHours: z.ZodNullable<z.ZodString>;
    helpVideos: z.ZodArray<z.ZodObject<{
        title: z.ZodString;
        language: z.ZodEnum<["en" | "ta" | "te" | "ml" | "kn" | "hi", ...("en" | "ta" | "te" | "ml" | "kn" | "hi")[]]>;
        url: z.ZodEffects<z.ZodString, string, string>;
    }, "strip", z.ZodTypeAny, {
        language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
        title: string;
        url: string;
    }, {
        language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
        title: string;
        url: string;
    }>, "many">;
    upiId: z.ZodNullable<z.ZodString>;
    upiName: z.ZodString;
    yearlyPrice: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    upiId: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    supportHours: string | null;
    upiName: string;
    yearlyPrice: number;
    helpVideos: {
        language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
        title: string;
        url: string;
    }[];
}, {
    upiId: string | null;
    supportPhone: string | null;
    supportEmail: string | null;
    supportHours: string | null;
    upiName: string;
    yearlyPrice: number;
    helpVideos: {
        language: "en" | "ta" | "te" | "ml" | "kn" | "hi";
        title: string;
        url: string;
    }[];
}>;
export type PlatformSettings = z.infer<typeof platformSettingsSchema>;
