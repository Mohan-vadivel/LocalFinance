import { z } from 'zod';
/**
 * Bringing customers and running loans over from another system (Excel or CSV). The web app maps the sheet's
 * columns to these fields and sends the raw cell values; the API parses and checks them with the helpers below,
 * so the preview and the import agree.
 */
export declare const IMPORT_FIELDS: readonly ["accountNo", "name", "nameTamil", "phone", "altPhone", "address", "occupation", "idNumber", "line", "loanAmount", "totalPayable", "loanDate", "instalment", "tenure", "firstDueDate", "maturityDate", "received", "balance"];
export type ImportField = (typeof IMPORT_FIELDS)[number];
export declare const IMPORT_REQUIRED: ImportField[];
export declare const IMPORT_MAX_ROWS = 5000;
export declare const importRowSchema: z.ZodObject<{
    tenure: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    accountNo: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    name: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    nameTamil: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    phone: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    altPhone: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    address: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    occupation: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    idNumber: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    line: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    loanAmount: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    totalPayable: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    loanDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    instalment: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    firstDueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    maturityDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    received: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    balance: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
    /** Row number in the spreadsheet, for messages. */
    rowNo: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    rowNo: number;
    tenure?: string | number | null | undefined;
    accountNo?: string | number | null | undefined;
    name?: string | number | null | undefined;
    nameTamil?: string | number | null | undefined;
    phone?: string | number | null | undefined;
    altPhone?: string | number | null | undefined;
    address?: string | number | null | undefined;
    occupation?: string | number | null | undefined;
    idNumber?: string | number | null | undefined;
    line?: string | number | null | undefined;
    loanAmount?: string | number | null | undefined;
    totalPayable?: string | number | null | undefined;
    loanDate?: string | number | null | undefined;
    instalment?: string | number | null | undefined;
    firstDueDate?: string | number | null | undefined;
    maturityDate?: string | number | null | undefined;
    received?: string | number | null | undefined;
    balance?: string | number | null | undefined;
}, {
    rowNo: number;
    tenure?: string | number | null | undefined;
    accountNo?: string | number | null | undefined;
    name?: string | number | null | undefined;
    nameTamil?: string | number | null | undefined;
    phone?: string | number | null | undefined;
    altPhone?: string | number | null | undefined;
    address?: string | number | null | undefined;
    occupation?: string | number | null | undefined;
    idNumber?: string | number | null | undefined;
    line?: string | number | null | undefined;
    loanAmount?: string | number | null | undefined;
    totalPayable?: string | number | null | undefined;
    loanDate?: string | number | null | undefined;
    instalment?: string | number | null | undefined;
    firstDueDate?: string | number | null | undefined;
    maturityDate?: string | number | null | undefined;
    received?: string | number | null | undefined;
    balance?: string | number | null | undefined;
}>;
export type ImportRow = z.infer<typeof importRowSchema>;
export declare const importRequestSchema: z.ZodObject<{
    /** Branch of the default line; also preferred when a line name exists in more than one branch. */
    branchId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Line (route) for rows without a Line column value. */
    routeId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    productId: z.ZodString;
    /** Fund that future collections on the imported loans are paid into (optional). */
    fundId: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    fileName: z.ZodNullable<z.ZodOptional<z.ZodString>>;
    /** Import the good rows and leave out rows with errors (otherwise any error stops the import). */
    skipErrors: z.ZodDefault<z.ZodBoolean>;
    rows: z.ZodArray<z.ZodObject<{
        tenure: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        accountNo: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        name: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        nameTamil: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        phone: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        altPhone: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        address: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        occupation: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        idNumber: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        line: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        loanAmount: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        totalPayable: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        loanDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        instalment: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        firstDueDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        maturityDate: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        received: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        balance: z.ZodOptional<z.ZodNullable<z.ZodUnion<[z.ZodString, z.ZodNumber]>>>;
        /** Row number in the spreadsheet, for messages. */
        rowNo: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        rowNo: number;
        tenure?: string | number | null | undefined;
        accountNo?: string | number | null | undefined;
        name?: string | number | null | undefined;
        nameTamil?: string | number | null | undefined;
        phone?: string | number | null | undefined;
        altPhone?: string | number | null | undefined;
        address?: string | number | null | undefined;
        occupation?: string | number | null | undefined;
        idNumber?: string | number | null | undefined;
        line?: string | number | null | undefined;
        loanAmount?: string | number | null | undefined;
        totalPayable?: string | number | null | undefined;
        loanDate?: string | number | null | undefined;
        instalment?: string | number | null | undefined;
        firstDueDate?: string | number | null | undefined;
        maturityDate?: string | number | null | undefined;
        received?: string | number | null | undefined;
        balance?: string | number | null | undefined;
    }, {
        rowNo: number;
        tenure?: string | number | null | undefined;
        accountNo?: string | number | null | undefined;
        name?: string | number | null | undefined;
        nameTamil?: string | number | null | undefined;
        phone?: string | number | null | undefined;
        altPhone?: string | number | null | undefined;
        address?: string | number | null | undefined;
        occupation?: string | number | null | undefined;
        idNumber?: string | number | null | undefined;
        line?: string | number | null | undefined;
        loanAmount?: string | number | null | undefined;
        totalPayable?: string | number | null | undefined;
        loanDate?: string | number | null | undefined;
        instalment?: string | number | null | undefined;
        firstDueDate?: string | number | null | undefined;
        maturityDate?: string | number | null | undefined;
        received?: string | number | null | undefined;
        balance?: string | number | null | undefined;
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    productId: string;
    skipErrors: boolean;
    rows: {
        rowNo: number;
        tenure?: string | number | null | undefined;
        accountNo?: string | number | null | undefined;
        name?: string | number | null | undefined;
        nameTamil?: string | number | null | undefined;
        phone?: string | number | null | undefined;
        altPhone?: string | number | null | undefined;
        address?: string | number | null | undefined;
        occupation?: string | number | null | undefined;
        idNumber?: string | number | null | undefined;
        line?: string | number | null | undefined;
        loanAmount?: string | number | null | undefined;
        totalPayable?: string | number | null | undefined;
        loanDate?: string | number | null | undefined;
        instalment?: string | number | null | undefined;
        firstDueDate?: string | number | null | undefined;
        maturityDate?: string | number | null | undefined;
        received?: string | number | null | undefined;
        balance?: string | number | null | undefined;
    }[];
    branchId?: string | null | undefined;
    routeId?: string | null | undefined;
    fundId?: string | null | undefined;
    fileName?: string | null | undefined;
}, {
    productId: string;
    rows: {
        rowNo: number;
        tenure?: string | number | null | undefined;
        accountNo?: string | number | null | undefined;
        name?: string | number | null | undefined;
        nameTamil?: string | number | null | undefined;
        phone?: string | number | null | undefined;
        altPhone?: string | number | null | undefined;
        address?: string | number | null | undefined;
        occupation?: string | number | null | undefined;
        idNumber?: string | number | null | undefined;
        line?: string | number | null | undefined;
        loanAmount?: string | number | null | undefined;
        totalPayable?: string | number | null | undefined;
        loanDate?: string | number | null | undefined;
        instalment?: string | number | null | undefined;
        firstDueDate?: string | number | null | undefined;
        maturityDate?: string | number | null | undefined;
        received?: string | number | null | undefined;
        balance?: string | number | null | undefined;
    }[];
    branchId?: string | null | undefined;
    routeId?: string | null | undefined;
    fundId?: string | null | undefined;
    fileName?: string | null | undefined;
    skipErrors?: boolean | undefined;
}>;
export type ImportRequest = z.infer<typeof importRequestSchema>;
export declare function importText(v: string | number | null | undefined): string | null;
/** Rupees as typed in a sheet ("1,000", "₹ 1000.50", 1000) to paise. null when blank, NaN when not a number. */
export declare function importAmount(v: string | number | null | undefined): number | null;
/** A whole number (instalment count). null when blank, NaN when not a whole number. */
export declare function importCount(v: string | number | null | undefined): number | null;
/**
 * Dates as Indian sheets have them: DD-MM-YYYY, DD/MM/YY, DD.MM.YYYY, 05-Jan-2026, YYYY-MM-DD, or an Excel date
 * serial number. null when blank, 'invalid' when it cannot be read.
 */
export declare function importDate(v: string | number | null | undefined): string | null | 'invalid';
/** Phone to the form the app stores: digits only, Indian +91 / 0 prefixes removed. */
export declare function importPhone(v: string | number | null | undefined): string | null;
export declare const hasTamil: (s: string) => boolean;
