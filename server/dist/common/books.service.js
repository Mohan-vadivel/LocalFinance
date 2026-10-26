"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.penaltyRule = exports.toState = exports.BooksService = void 0;
exports.positionOf = positionOf;
exports.dayFiguresOf = dayFiguresOf;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const errors_1 = require("./errors");
const pad = (n, w = 6) => String(n).padStart(w, '0');
/**
 * Shared bookkeeping: numbering, fund balances, customer ledger and the day book. Every money operation in
 * the app goes through here inside one database transaction, so the fund, ledger and day book never disagree.
 */
let BooksService = class BooksService {
    async nextNumber(tx, tenantId, field) {
        const t = await tx.tenant.update({ where: { id: tenantId }, data: { [field]: { increment: 1 } } });
        return t[field];
    }
    async receiptNo(tx, tenantId) {
        return `R${pad(await this.nextNumber(tx, tenantId, 'receiptSeq'), 7)}`;
    }
    /** Adds (positive) or takes (negative) money from a fund; refuses to go below zero. */
    async moveFund(tx, p) {
        if (p.amount === 0)
            return;
        if (p.amount < 0) {
            const r = await tx.fund.updateMany({
                where: { id: p.fundId, tenantId: p.tenantId, balance: { gte: -p.amount } },
                data: { balance: { increment: p.amount } },
            });
            if (r.count !== 1)
                throw (0, errors_1.bad)('Not enough money in this fund', 'fund.insufficient');
        }
        else {
            const r = await tx.fund.updateMany({ where: { id: p.fundId, tenantId: p.tenantId }, data: { balance: { increment: p.amount } } });
            if (r.count !== 1)
                throw (0, errors_1.bad)('Fund not found', 'errors.notFound');
        }
        const fund = await tx.fund.findUniqueOrThrow({ where: { id: p.fundId } });
        await tx.fundTxn.create({
            data: {
                tenantId: p.tenantId,
                fundId: p.fundId,
                date: p.date,
                type: p.type,
                amount: p.amount,
                balance: fund.balance,
                refId: p.refId,
                note: p.note,
                createdById: p.userId,
            },
        });
    }
    /** Customer ledger: balance is what the customer owes on the loan (principal + scheduled interest). */
    async ledger(tx, p) {
        const last = await tx.ledgerEntry.findFirst({ where: { loanId: p.loanId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        const balance = (last?.balance ?? 0) + (p.debit ?? 0) - (p.credit ?? 0);
        return tx.ledgerEntry.create({
            data: {
                tenantId: p.tenantId,
                loanId: p.loanId,
                customerId: p.customerId,
                date: p.date,
                type: p.type,
                description: p.description,
                debit: p.debit ?? 0,
                credit: p.credit ?? 0,
                balance,
                refId: p.refId,
            },
        });
    }
    async isClosed(tx, branchId, date) {
        // Branch ids reach here only after the caller's ownership checks; the close must also be in the branch's own business.
        const c = await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date } } });
        if (!c)
            return false;
        const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { tenantId: true } });
        return branch?.tenantId === c.tenantId;
    }
    /**
     * Posts a day book line. Automatic lines for a day that is already closed (for example an offline collection
     * synced late) land on today instead, with the original date in the particulars.
     */
    async daybook(tx, p) {
        if (p.amount <= 0)
            return null;
        let date = p.date;
        let particulars = p.particulars;
        if (await this.isClosed(tx, p.branchId, date)) {
            if (p.source === 'MANUAL')
                throw (0, errors_1.bad)('That day is already closed', 'errors.dayClosed');
            const today = (0, shared_1.todayIST)();
            if (today !== date && !(await this.isClosed(tx, p.branchId, today))) {
                particulars = `${particulars} (for ${date})`;
                date = today;
            }
            else {
                throw (0, errors_1.bad)('That day is already closed', 'errors.dayClosed');
            }
        }
        const voucherNo = `V${pad(await this.nextNumber(tx, p.tenantId, 'voucherSeq'), 7)}`;
        return tx.daybookEntry.create({
            data: {
                tenantId: p.tenantId,
                branchId: p.branchId,
                date,
                voucherNo,
                direction: p.direction,
                categoryId: p.categoryId,
                systemCategory: p.systemCategory,
                amount: p.amount,
                mode: p.mode,
                particulars,
                billUrl: p.billUrl ?? null,
                source: p.source ?? 'AUTO',
                refType: p.refType,
                refId: p.refId,
                createdById: p.userId,
            },
        });
    }
};
exports.BooksService = BooksService;
exports.BooksService = BooksService = __decorate([
    (0, common_1.Injectable)()
], BooksService);
const toState = (i) => ({
    id: i.id,
    seq: i.seq,
    dueDate: i.dueDate,
    principalDue: i.principalDue,
    interestDue: i.interestDue,
    principalPaid: i.principalPaid,
    interestPaid: i.interestPaid,
    paidOn: i.paidOn,
});
exports.toState = toState;
const penaltyRule = (l) => ({
    type: l.penaltyType,
    value: l.penaltyValue,
    graceDays: l.graceDays,
});
exports.penaltyRule = penaltyRule;
/** Current position of a loan from its instalments. */
function positionOf(loan, asOf = (0, shared_1.todayIST)()) {
    const states = loan.instalments.map(exports.toState);
    const charged = loan.status === 'ACTIVE' ? (0, shared_1.penaltyCharged)(states, (0, exports.penaltyRule)(loan), asOf) : loan.penaltyPaid + loan.penaltyWaived;
    return (0, shared_1.loanPosition)(states, { charged, paid: loan.penaltyPaid, waived: loan.penaltyWaived }, asOf);
}
/**
 * What one active loan owes on a day: the instalments due that day, and what is overdue. The dashboard and the area
 * summary both add these up, so they always agree.
 */
function dayFiguresOf(loan, today = (0, shared_1.todayIST)()) {
    const p = positionOf(loan, today);
    const dueToday = loan.instalments.filter((i) => i.dueDate === today).reduce((s, i) => s + i.principalDue + i.interestDue, 0);
    return { dueToday, overdue: p.overdue, outstanding: p.totalOutstanding, daysPastDue: p.daysPastDue };
}
//# sourceMappingURL=books.service.js.map