import { Injectable } from '@nestjs/common';
import {
  loanPosition,
  penaltyCharged,
  todayIST,
  type DaybookSystemCategory,
  type InstalmentState,
  type PenaltyRule,
} from '@localfinance/shared';
import type { Instalment, Loan } from '@prisma/client';
import { bad } from './errors';
import { type Tx } from './prisma.service';

const pad = (n: number, w = 6) => String(n).padStart(w, '0');

/**
 * Shared bookkeeping: numbering, fund balances, customer ledger and the day book. Every money operation in
 * the app goes through here inside one database transaction, so the fund, ledger and day book never disagree.
 */
@Injectable()
export class BooksService {
  async nextNumber(tx: Tx, tenantId: string, field: 'loanSeq' | 'receiptSeq' | 'voucherSeq' | 'customerSeq'): Promise<number> {
    const t = await tx.tenant.update({ where: { id: tenantId }, data: { [field]: { increment: 1 } } });
    return t[field];
  }

  async receiptNo(tx: Tx, tenantId: string) {
    return `R${pad(await this.nextNumber(tx, tenantId, 'receiptSeq'), 7)}`;
  }

  /** Adds (positive) or takes (negative) money from a fund; refuses to go below zero. */
  async moveFund(
    tx: Tx,
    p: { tenantId: string; fundId: string; amount: number; type: string; date: string; refId?: string; note?: string; userId?: string },
  ) {
    if (p.amount === 0) return;
    if (p.amount < 0) {
      const r = await tx.fund.updateMany({
        where: { id: p.fundId, tenantId: p.tenantId, balance: { gte: -p.amount } },
        data: { balance: { increment: p.amount } },
      });
      if (r.count !== 1) throw bad('Not enough money in this fund', 'fund.insufficient');
    } else {
      const r = await tx.fund.updateMany({ where: { id: p.fundId, tenantId: p.tenantId }, data: { balance: { increment: p.amount } } });
      if (r.count !== 1) throw bad('Fund not found', 'errors.notFound');
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
  async ledger(
    tx: Tx,
    p: { tenantId: string; loanId: string; customerId: string; date: string; type: string; description: string; debit?: number; credit?: number; refId?: string },
  ) {
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

  async isClosed(tx: Tx, branchId: string, date: string) {
    // Branch ids reach here only after the caller's ownership checks; the close must also be in the branch's own business.
    const c = await tx.dayClose.findUnique({ where: { branchId_date: { branchId, date } } });
    if (!c) return false;
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { tenantId: true } });
    return branch?.tenantId === c.tenantId;
  }

  /**
   * Posts a day book line. Automatic lines for a day that is already closed (for example an offline collection
   * synced late) land on today instead, with the original date in the particulars.
   */
  async daybook(
    tx: Tx,
    p: {
      tenantId: string;
      branchId: string;
      date: string;
      direction: 'IN' | 'OUT';
      amount: number;
      mode: string;
      particulars: string;
      systemCategory?: DaybookSystemCategory;
      categoryId?: string;
      source?: 'AUTO' | 'MANUAL';
      refType?: string;
      refId?: string;
      userId?: string;
      billUrl?: string | null;
    },
  ) {
    if (p.amount <= 0) return null;
    let date = p.date;
    let particulars = p.particulars;
    if (await this.isClosed(tx, p.branchId, date)) {
      if (p.source === 'MANUAL') throw bad('That day is already closed', 'errors.dayClosed');
      const today = todayIST();
      if (today !== date && !(await this.isClosed(tx, p.branchId, today))) {
        particulars = `${particulars} (for ${date})`;
        date = today;
      } else {
        throw bad('That day is already closed', 'errors.dayClosed');
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
}

export const toState = (i: Instalment): InstalmentState => ({
  id: i.id,
  seq: i.seq,
  dueDate: i.dueDate,
  principalDue: i.principalDue,
  interestDue: i.interestDue,
  principalPaid: i.principalPaid,
  interestPaid: i.interestPaid,
  paidOn: i.paidOn,
});

export const penaltyRule = (l: Loan): PenaltyRule => ({
  type: l.penaltyType as PenaltyRule['type'],
  value: l.penaltyValue,
  graceDays: l.graceDays,
});

/** Current position of a loan from its instalments. */
export function positionOf(loan: Loan & { instalments: Instalment[] }, asOf = todayIST()) {
  const states = loan.instalments.map(toState);
  const charged = loan.status === 'ACTIVE' ? penaltyCharged(states, penaltyRule(loan), asOf) : loan.penaltyPaid + loan.penaltyWaived;
  return loanPosition(states, { charged, paid: loan.penaltyPaid, waived: loan.penaltyWaived }, asOf);
}
