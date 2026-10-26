"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayIST = exports.weekday = exports.diffDays = exports.addDays = exports.fmtDate = exports.parseDate = void 0;
exports.addMonthsClamped = addMonthsClamped;
exports.periodRange = periodRange;
/** Date-only helpers on 'YYYY-MM-DD' strings, computed in UTC so time zones never shift a day. */
const DAY = 86_400_000;
const parseDate = (d) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d))
        throw new Error(`Invalid date: ${d}`);
    return new Date(`${d}T00:00:00.000Z`);
};
exports.parseDate = parseDate;
const fmtDate = (d) => d.toISOString().slice(0, 10);
exports.fmtDate = fmtDate;
const addDays = (d, n) => (0, exports.fmtDate)(new Date((0, exports.parseDate)(d).getTime() + n * DAY));
exports.addDays = addDays;
const diffDays = (a, b) => Math.round(((0, exports.parseDate)(a).getTime() - (0, exports.parseDate)(b).getTime()) / DAY);
exports.diffDays = diffDays;
const weekday = (d) => (0, exports.parseDate)(d).getUTCDay();
exports.weekday = weekday;
function addMonthsClamped(d, n, dayOfMonth) {
    const base = (0, exports.parseDate)(d);
    const y = base.getUTCFullYear();
    const m = base.getUTCMonth() + n;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return (0, exports.fmtDate)(new Date(Date.UTC(y, m, Math.min(dayOfMonth, lastDay))));
}
/** Today's date in India (IST), as YYYY-MM-DD. */
const todayIST = (now = new Date()) => (0, exports.fmtDate)(new Date(now.getTime() + 330 * 60_000));
exports.todayIST = todayIST;
/** The day, the Monday-to-Sunday week, or the calendar month that contains `d`. */
function periodRange(period, d) {
    if (period === 'DAY')
        return { from: d, to: d };
    if (period === 'WEEK') {
        const from = (0, exports.addDays)(d, -(((0, exports.weekday)(d) + 6) % 7));
        return { from, to: (0, exports.addDays)(from, 6) };
    }
    const from = d.slice(0, 8) + '01';
    return { from, to: (0, exports.addDays)(addMonthsClamped(from, 1, 1), -1) };
}
//# sourceMappingURL=dates.js.map