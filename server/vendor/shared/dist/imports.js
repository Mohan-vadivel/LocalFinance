"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasTamil = exports.importRequestSchema = exports.importRowSchema = exports.IMPORT_MAX_ROWS = exports.IMPORT_REQUIRED = exports.IMPORT_FIELDS = void 0;
exports.importText = importText;
exports.importAmount = importAmount;
exports.importCount = importCount;
exports.importDate = importDate;
exports.importPhone = importPhone;
const zod_1 = require("zod");
/**
 * Bringing customers and running loans over from another system (Excel or CSV). The web app maps the sheet's
 * columns to these fields and sends the raw cell values; the API parses and checks them with the helpers below,
 * so the preview and the import agree.
 */
exports.IMPORT_FIELDS = [
    'accountNo',
    'name',
    'nameTamil',
    'phone',
    'altPhone',
    'address',
    'occupation',
    'idNumber',
    'line',
    'loanAmount',
    'totalPayable',
    'loanDate',
    'instalment',
    'tenure',
    'firstDueDate',
    'maturityDate',
    'received',
    'balance',
];
exports.IMPORT_REQUIRED = ['accountNo', 'name', 'phone', 'loanAmount', 'loanDate'];
exports.IMPORT_MAX_ROWS = 5000;
const cell = zod_1.z.union([zod_1.z.string().max(500), zod_1.z.number()]).nullable().optional();
exports.importRowSchema = zod_1.z.object({
    /** Row number in the spreadsheet, for messages. */
    rowNo: zod_1.z.number().int().positive(),
    ...Object.fromEntries(exports.IMPORT_FIELDS.map((f) => [f, cell])),
});
exports.importRequestSchema = zod_1.z.object({
    /** Branch of the default line; also preferred when a line name exists in more than one branch. */
    branchId: zod_1.z.string().min(1).optional().nullable(),
    /** Line (route) for rows without a Line column value. */
    routeId: zod_1.z.string().min(1).optional().nullable(),
    productId: zod_1.z.string().min(1),
    /** Fund that future collections on the imported loans are paid into (optional). */
    fundId: zod_1.z.string().min(1).optional().nullable(),
    fileName: zod_1.z.string().max(200).optional().nullable(),
    /** Import the good rows and leave out rows with errors (otherwise any error stops the import). */
    skipErrors: zod_1.z.boolean().default(false),
    rows: zod_1.z.array(exports.importRowSchema).min(1).max(exports.IMPORT_MAX_ROWS),
});
const blank = (v) => v == null || (typeof v === 'string' && v.trim() === '');
function importText(v) {
    if (blank(v))
        return null;
    const s = String(v).replace(/\s+/g, ' ').trim();
    // Spreadsheets turn account numbers like 12 into 12.0 sometimes.
    return typeof v === 'number' && Number.isInteger(v) ? String(v) : s;
}
/** Rupees as typed in a sheet ("1,000", "₹ 1000.50", 1000) to paise. null when blank, NaN when not a number. */
function importAmount(v) {
    if (blank(v))
        return null;
    if (typeof v === 'number')
        return Number.isFinite(v) ? Math.round(v * 100) : NaN;
    const s = v.replace(/(rs\.?|inr|₹|,|\s|\/-)/gi, '');
    if (!/^-?\d+(\.\d+)?$/.test(s))
        return NaN;
    return Math.round(Number(s) * 100);
}
/** A whole number (instalment count). null when blank, NaN when not a whole number. */
function importCount(v) {
    if (blank(v))
        return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, '') || 'x');
    return Number.isInteger(n) ? n : NaN;
}
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const pad2 = (n) => String(n).padStart(2, '0');
function ymd(y, m, d) {
    if (y < 100)
        y += 2000;
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d || y < 1990 || y > 2100)
        return 'invalid';
    return `${y}-${pad2(m)}-${pad2(d)}`;
}
/**
 * Dates as Indian sheets have them: DD-MM-YYYY, DD/MM/YY, DD.MM.YYYY, 05-Jan-2026, YYYY-MM-DD, or an Excel date
 * serial number. null when blank, 'invalid' when it cannot be read.
 */
function importDate(v) {
    if (blank(v))
        return null;
    if (typeof v === 'number') {
        if (!Number.isFinite(v) || v < 20000 || v > 80000)
            return 'invalid';
        // Excel serial: days since 1899-12-30.
        const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86_400_000);
        return d.toISOString().slice(0, 10);
    }
    const s = v.trim().replace(/[ T]\d{1,2}:\d{2}.*$/, ''); // drop a time part
    let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
    if (m)
        return ymd(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
    if (m)
        return ymd(+m[3], +m[2], +m[1]);
    m = s.match(/^(\d{1,2})[-/. ]?([a-z]{3})[a-z]*[-/. ,]*(\d{2}|\d{4})$/i);
    if (m && MONTHS.includes(m[2].toLowerCase()))
        return ymd(+m[3], MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
    if (/^\d{5}(\.\d+)?$/.test(s))
        return importDate(Number(s));
    return 'invalid';
}
/** Phone to the form the app stores: digits only, Indian +91 / 0 prefixes removed. */
function importPhone(v) {
    if (blank(v))
        return null;
    let d = String(typeof v === 'number' ? Math.round(v) : v).replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91'))
        d = d.slice(2);
    if (d.length === 11 && d.startsWith('0'))
        d = d.slice(1);
    return d;
}
const hasTamil = (s) => /[஀-௿]/.test(s);
exports.hasTamil = hasTamil;
//# sourceMappingURL=imports.js.map