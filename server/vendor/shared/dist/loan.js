"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AGEING_BUCKETS = exports.instalmentDue = void 0;
exports.dueDates = dueDates;
exports.summarize = summarize;
exports.generateSchedule = generateSchedule;
exports.defaultFirstDue = defaultFirstDue;
exports.penaltyCharged = penaltyCharged;
exports.allocatePayment = allocatePayment;
exports.loanPosition = loanPosition;
exports.ageingBucket = ageingBucket;
exports.riskGrade = riskGrade;
exports.distanceMetres = distanceMetres;
exports.suggestRouteOrder = suggestRouteOrder;
const dates_1 = require("./dates");
const money_1 = require("./money");
const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5, 6];
function isWorking(date, cal) {
    const days = cal.workingDays && cal.workingDays.length ? cal.workingDays : DEFAULT_WORKING_DAYS;
    return days.includes((0, dates_1.weekday)(date)) && !(cal.holidays ?? []).includes(date);
}
function nextWorking(date, cal) {
    let d = date;
    for (let i = 0; i < 400 && !isWorking(d, cal); i++)
        d = (0, dates_1.addDays)(d, 1);
    return d;
}
/** Due dates for each instalment. Daily loans skip off days; weekly and monthly move to the next working day. */
function dueDates(firstDue, frequency, count, cal = {}) {
    const out = [];
    if (frequency === 'DAILY') {
        let d = nextWorking(firstDue, cal);
        while (out.length < count) {
            out.push(d);
            d = nextWorking((0, dates_1.addDays)(d, 1), cal);
        }
        return out;
    }
    const dom = (0, dates_1.parseDate)(firstDue).getUTCDate();
    for (let i = 0; i < count; i++) {
        const nominal = frequency === 'WEEKLY' ? (0, dates_1.addDays)(firstDue, 7 * i) : (0, dates_1.addMonthsClamped)(firstDue, i, dom);
        out.push(nextWorking(nominal, cal));
    }
    return out;
}
/** Splits total into n integer parts; the remainder goes to the last part. */
function split(total, n) {
    const base = Math.floor(total / n);
    const parts = Array(n).fill(base);
    parts[n - 1] += total - base * n;
    return parts;
}
const periodsPerYear = { DAILY: 365, WEEKLY: 52, MONTHLY: 12 };
function summarize(terms) {
    const fee = Math.round((terms.principal * (terms.feePercent ?? 0)) / 100) + (terms.feeFlat ?? 0);
    let totalInterest = 0;
    let upfrontInterest = 0;
    if (terms.interestMethod === 'FLAT')
        totalInterest = Math.round((terms.principal * terms.interestRate) / 100);
    if (terms.interestMethod === 'UPFRONT')
        upfrontInterest = Math.round((terms.principal * terms.interestRate) / 100);
    if (terms.interestMethod === 'REDUCING') {
        totalInterest = generateAmounts(terms).reduce((s, r) => s + r.interestDue, 0);
    }
    const netDisbursed = terms.principal - fee - upfrontInterest;
    if (netDisbursed <= 0)
        throw new Error('Fees and upfront interest exceed the principal');
    return {
        principal: terms.principal,
        fee,
        upfrontInterest,
        netDisbursed,
        totalInterest: totalInterest + upfrontInterest,
        totalRepayable: terms.principal + totalInterest,
    };
}
function generateAmounts(terms) {
    const { principal, tenure } = terms;
    if (!Number.isInteger(principal) || principal <= 0)
        throw new Error('Principal must be a positive amount in paise');
    if (!Number.isInteger(tenure) || tenure <= 0)
        throw new Error('Tenure must be a positive whole number');
    if (terms.interestRate < 0)
        throw new Error('Interest rate cannot be negative');
    if (terms.interestMethod === 'FLAT') {
        const interest = Math.round((principal * terms.interestRate) / 100);
        const p = split(principal, tenure);
        const i = split(interest, tenure);
        return p.map((pd, k) => ({ principalDue: pd, interestDue: i[k] }));
    }
    if (terms.interestMethod === 'UPFRONT') {
        return split(principal, tenure).map((pd) => ({ principalDue: pd, interestDue: 0 }));
    }
    // REDUCING balance EMI
    const r = terms.interestRate / 100 / periodsPerYear[terms.frequency];
    if (r === 0)
        return split(principal, tenure).map((pd) => ({ principalDue: pd, interestDue: 0 }));
    const emi = Math.round((principal * r * Math.pow(1 + r, tenure)) / (Math.pow(1 + r, tenure) - 1));
    const rows = [];
    let balance = principal;
    for (let k = 0; k < tenure; k++) {
        const interestDue = Math.round(balance * r);
        let principalDue = emi - interestDue;
        if (k === tenure - 1 || principalDue > balance)
            principalDue = balance;
        balance -= principalDue;
        rows.push({ principalDue, interestDue });
    }
    return rows;
}
function generateSchedule(terms, firstDue, cal = {}) {
    const amounts = generateAmounts(terms);
    const dates = dueDates(firstDue, terms.frequency, terms.tenure, cal);
    return amounts.map((a, k) => ({
        seq: k + 1,
        dueDate: dates[k],
        principalDue: a.principalDue,
        interestDue: a.interestDue,
        totalDue: a.principalDue + a.interestDue,
    }));
}
/** First due date: one period after disbursement. */
function defaultFirstDue(disbursedOn, frequency) {
    if (frequency === 'DAILY')
        return (0, dates_1.addDays)(disbursedOn, 1);
    if (frequency === 'WEEKLY')
        return (0, dates_1.addDays)(disbursedOn, 7);
    return (0, dates_1.addMonthsClamped)(disbursedOn, 1, (0, dates_1.parseDate)(disbursedOn).getUTCDate());
}
const instalmentDue = (i) => i.principalDue + i.interestDue - i.principalPaid - i.interestPaid;
exports.instalmentDue = instalmentDue;
/** Penalty charged so far: per instalment, for each day it was (or still is) unpaid after the grace days. */
function penaltyCharged(instalments, rule, asOf) {
    if (rule.type === 'NONE' || rule.value <= 0)
        return 0;
    let total = 0;
    for (const ins of instalments) {
        const end = ins.paidOn ?? asOf;
        const daysLate = (0, dates_1.diffDays)(end, ins.dueDate) - rule.graceDays;
        if (daysLate <= 0)
            continue;
        const perDay = rule.type === 'FIXED_PER_DAY' ? rule.value : Math.round(((ins.principalDue + ins.interestDue) * rule.value) / 100);
        total += perDay * daysLate;
    }
    return total;
}
/**
 * Applies a payment to a loan: penalty (first or last), then each instalment oldest first, interest before
 * principal. Paying ahead of schedule simply fills later instalments. Throws if the amount exceeds what is owed.
 */
function allocatePayment(amount, instalments, penaltyOutstanding, order = 'PENALTY_FIRST') {
    if (!Number.isInteger(amount) || amount <= 0)
        throw new Error('Amount must be a positive amount in paise');
    const owed = instalments.reduce((s, i) => s + (0, exports.instalmentDue)(i), 0) + Math.max(0, penaltyOutstanding);
    if (amount > owed)
        throw new Error(`Amount is more than the outstanding balance of ${(0, money_1.formatINR)(owed)}`);
    let left = amount;
    const res = { penalty: 0, interest: 0, principal: 0, perInstalment: [] };
    const takePenalty = () => {
        const p = Math.min(left, Math.max(0, penaltyOutstanding));
        res.penalty += p;
        left -= p;
    };
    if (order === 'PENALTY_FIRST')
        takePenalty();
    const sorted = [...instalments].sort((a, b) => a.seq - b.seq);
    for (const ins of sorted) {
        if (left <= 0)
            break;
        const iDue = ins.interestDue - ins.interestPaid;
        const pDue = ins.principalDue - ins.principalPaid;
        if (iDue + pDue <= 0)
            continue;
        const i = Math.min(left, iDue);
        left -= i;
        const p = Math.min(left, pDue);
        left -= p;
        res.interest += i;
        res.principal += p;
        res.perInstalment.push({ id: ins.id, interest: i, principal: p, fullyPaid: i === iDue && p === pDue });
    }
    if (order === 'PENALTY_LAST' && left > 0)
        takePenalty();
    return res;
}
function loanPosition(instalments, penalty, asOf) {
    let principalOutstanding = 0;
    let interestOutstanding = 0;
    let overdue = 0;
    let dueToday = 0;
    let oldest = null;
    for (const i of instalments) {
        const pd = i.principalDue - i.principalPaid;
        const id = i.interestDue - i.interestPaid;
        principalOutstanding += pd;
        interestOutstanding += id;
        if (pd + id > 0) {
            if (i.dueDate < asOf) {
                overdue += pd + id;
                if (!oldest || i.dueDate < oldest)
                    oldest = i.dueDate;
            }
            else if (i.dueDate === asOf)
                dueToday += pd + id;
        }
    }
    const penaltyOutstanding = Math.max(0, penalty.charged - penalty.paid - penalty.waived);
    return {
        principalOutstanding,
        interestOutstanding,
        penaltyOutstanding,
        totalOutstanding: principalOutstanding + interestOutstanding + penaltyOutstanding,
        overdue,
        dueToday,
        daysPastDue: oldest ? (0, dates_1.diffDays)(asOf, oldest) : 0,
    };
}
exports.AGEING_BUCKETS = [
    { key: 'd1_7', min: 1, max: 7 },
    { key: 'd8_30', min: 8, max: 30 },
    { key: 'd31_90', min: 31, max: 90 },
    { key: 'd90_plus', min: 91, max: Infinity },
];
function ageingBucket(daysPastDue) {
    const b = exports.AGEING_BUCKETS.find((x) => daysPastDue >= x.min && daysPastDue <= x.max);
    return b ? b.key : null;
}
/** Risk grade from repayment history: A best, D worst. Advisory only. */
function riskGrade(h) {
    if (h.loans === 0)
        return 'NEW';
    if (h.writtenOff > 0 || h.maxDaysLate > 90)
        return 'D';
    if (h.onTimeRatio >= 0.9 && h.maxDaysLate <= 7)
        return 'A';
    if (h.onTimeRatio >= 0.75 && h.maxDaysLate <= 30)
        return 'B';
    return 'C';
}
/** Haversine distance in metres. */
function distanceMetres(a, b) {
    const R = 6_371_000;
    const rad = (x) => (x * Math.PI) / 180;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
/** Nearest-neighbour visiting order from a start point; returns ids in order. */
function suggestRouteOrder(start, stops) {
    const located = stops.filter((s) => s.lat != null && s.lng != null);
    const unlocated = stops.filter((s) => s.lat == null || s.lng == null).map((s) => s.id);
    const order = [];
    let cur = start ?? (located[0] ? { lat: located[0].lat, lng: located[0].lng } : null);
    const left = [...located];
    while (left.length && cur) {
        let best = 0;
        let bestD = Infinity;
        left.forEach((s, k) => {
            const d = distanceMetres(cur, s);
            if (d < bestD) {
                bestD = d;
                best = k;
            }
        });
        const [next] = left.splice(best, 1);
        order.push(next.id);
        cur = { lat: next.lat, lng: next.lng };
    }
    return [...order, ...unlocated];
}
//# sourceMappingURL=loan.js.map