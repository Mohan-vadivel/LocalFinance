"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toRupees = exports.toPaise = void 0;
exports.formatINR = formatINR;
exports.upiPayLink = upiPayLink;
/** All money is stored as integer paise. */
const toPaise = (rupees) => Math.round(rupees * 100);
exports.toPaise = toPaise;
const toRupees = (paise) => paise / 100;
exports.toRupees = toRupees;
/** Indian grouping: 1,00,000.00 */
function formatINR(paise, opts = {}) {
    const { symbol = true, decimals = true } = opts;
    const negative = paise < 0;
    const abs = Math.abs(paise);
    const whole = Math.floor(abs / 100).toString();
    const fraction = (abs % 100).toString().padStart(2, '0');
    const last3 = whole.slice(-3);
    const rest = whole.slice(0, -3);
    const grouped = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3 : last3;
    const body = decimals ? `${grouped}.${fraction}` : grouped;
    return `${negative ? '-' : ''}${symbol ? '₹' : ''}${body}`;
}
/**
 * A UPI payment link ("upi://pay", the NPCI deep link). UPI apps open it with the payee, amount and note filled in;
 * the same text in a QR code can be scanned by any UPI app.
 */
function upiPayLink(p) {
    const q = [`pa=${p.upiId}`, `pn=${encodeURIComponent(p.name)}`];
    if (p.amount && p.amount > 0)
        q.push(`am=${(p.amount / 100).toFixed(2)}`);
    q.push('cu=INR');
    if (p.note)
        q.push(`tn=${encodeURIComponent(p.note.slice(0, 80))}`);
    return `upi://pay?${q.join('&')}`;
}
//# sourceMappingURL=money.js.map