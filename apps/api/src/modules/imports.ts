import { Body, Controller, Injectable, Post } from '@nestjs/common';
import {
  allocatePayment,
  defaultFirstDue,
  dueDates,
  formatINR,
  hasTamil,
  importAmount,
  importCount,
  importDate,
  importPhone,
  importRequestSchema,
  importText,
  summarize,
  todayIST,
  type Frequency,
  type ImportField,
  type ImportRequest,
  type ImportRow,
  type InstalmentState,
  type InterestMethod,
} from '@localfinance/shared';
import type { Fund, LoanProduct, Prisma } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/audit.service';
import { CurrentCtx, Perm, type Ctx } from '../common/context';
import { bad, conflict, notFound } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { assertBranch, branchScope } from '../common/scope';
import { V } from '../common/zod.pipe';

/** A problem with one row. `code` is an i18n key under import.issues; `message` is the English fallback. */
interface Issue {
  code: string;
  field?: ImportField;
  params?: Record<string, string | number>;
  message: string;
}

type RowStatus = 'NEW' | 'EXISTS' | 'CLOSED' | 'ERROR';

interface Terms {
  principal: number;
  totalPayable: number;
  paid: number;
  balance: number;
  instalment: number;
  tenure: number;
  loanDate: string;
  firstDueDate: string;
  maturityDate: string;
  amounts: number[];
  dates: string[];
}

interface RowPlan {
  rowNo: number;
  accountNo: string | null;
  name: string | null;
  phone: string | null;
  status: RowStatus;
  errors: Issue[];
  warnings: Issue[];
  route: { id: string; name: string; branchId: string; locationId: string; locationName: string } | null;
  /** CREATE: new customer; REUSE: existing customer with this phone; SAME_AS_ROW: new customer made by an earlier row. */
  customer: { action: 'CREATE' | 'REUSE' | 'SAME_AS_ROW'; id?: string; code?: string; name: string; sameAsRow?: number } | null;
  existingLoan: { id: string; number: string } | null;
  terms: Terms | null;
  input: { altPhone: string | null; address: string | null; occupation: string | null; idNumber: string | null; language: string };
}

const pad = (n: number, w = 6) => String(n).padStart(w, '0');
const keyOf = (routeId: string, accountNo: string) => `import:${routeId}:${accountNo.toLowerCase()}`;
const PHONE = /^[0-9+][0-9 -]{6,15}$/;
const FIELD_LABEL: Record<ImportField, string> = {
  accountNo: 'Account number',
  name: 'Name',
  nameTamil: 'Tamil name',
  phone: 'Phone',
  altPhone: 'Other phone',
  address: 'Address',
  occupation: 'Profession',
  idNumber: 'ID number',
  line: 'Line',
  loanAmount: 'Loan amount',
  totalPayable: 'Total payable',
  loanDate: 'Loan date',
  instalment: 'Instalment',
  tenure: 'No. of instalments',
  firstDueDate: 'First due date',
  maturityDate: 'Maturity date',
  received: 'Received',
  balance: 'Balance',
};
const issue = (code: string, message: string, field?: ImportField, params?: Record<string, string | number>): Issue => ({
  code,
  message,
  ...(field ? { field } : {}),
  ...(params ? { params } : {}),
});

/**
 * Splits each instalment into principal and interest in the loan's proportion, cumulatively so the parts add up
 * to the loan amount exactly.
 */
function splitSchedule(amounts: number[], principal: number, total: number) {
  let cum = 0;
  let prevP = 0;
  return amounts.map((a) => {
    cum += a;
    const p = total === 0 ? 0 : Math.round((cum * principal) / total);
    const row = { principalDue: p - prevP, interestDue: a - (p - prevP) };
    prevP = p;
    return row;
  });
}

/**
 * Brings customers and their running loans over from the business's previous software. Loans are created
 * ACTIVE with their schedule, and what was already repaid is applied to the instalments as an opening balance:
 * no collection, fund movement or day book line is written, so today's cash and collections are not touched.
 * The old account number is kept on the loan (legacyNo) and makes the import safe to run again.
 */
@Injectable()
export class ImportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async plan(ctx: Ctx, req: ImportRequest) {
    const today = todayIST();
    const product = await this.prisma.loanProduct.findFirst({ where: { id: req.productId, tenantId: ctx.tenantId } });
    if (!product) throw notFound('Product');
    const routes = await this.prisma.route.findMany({ where: { ...branchScope(ctx), active: true }, include: { location: true } });
    let defaultRoute: (typeof routes)[number] | null = null;
    if (req.routeId) {
      defaultRoute = routes.find((r) => r.id === req.routeId) ?? null;
      if (!defaultRoute) throw notFound('Route');
    }
    if (req.branchId) assertBranch(ctx, req.branchId);
    const preferBranch = req.branchId ?? defaultRoute?.branchId ?? null;
    let fund: Fund | null = null;
    if (req.fundId) {
      fund = await this.prisma.fund.findFirst({ where: { id: req.fundId, tenantId: ctx.tenantId, active: true } });
      if (!fund) throw notFound('Fund');
    }
    const byName = new Map<string, typeof routes>();
    for (const r of routes) {
      const k = r.name.trim().toLowerCase();
      byName.set(k, [...(byName.get(k) ?? []), r]);
    }

    const plans: RowPlan[] = req.rows.map((row) => this.parseRow(ctx, row, product, today));
    // Resolve lines.
    for (const [i, p] of plans.entries()) {
      const lineName = importText(req.rows[i].line);
      let r: (typeof routes)[number] | null = null;
      if (lineName) {
        const found = byName.get(lineName.toLowerCase()) ?? [];
        const pick = found.length > 1 ? found.filter((x) => x.branchId === preferBranch) : found;
        if (pick.length === 1) r = pick[0];
        else if (found.length > 1) p.errors.push(issue('lineAmbiguous', `Line "${lineName}" exists in more than one branch; choose the branch`, 'line', { line: lineName }));
        else p.errors.push(issue('lineNotFound', `Line "${lineName}" was not found; add it under Routes first`, 'line', { line: lineName }));
      } else if (defaultRoute) r = defaultRoute;
      else p.errors.push(issue('noLine', 'No line: choose a default line or map the Line column', 'line'));
      if (r) p.route = { id: r.id, name: r.name, branchId: r.branchId, locationId: r.locationId, locationName: r.location.name };
      if (r && fund && fund.branchId !== r.branchId) p.errors.push(issue('fundOtherBranch', 'The chosen fund belongs to another branch than this line'));
    }

    // Already imported (same line and old account number), or the old number used on another loan.
    const keys = plans.filter((p) => p.route && p.accountNo).map((p) => keyOf(p.route!.id, p.accountNo!));
    const accountNos = [...new Set(plans.map((p) => p.accountNo).filter((a): a is string => !!a))];
    const [existingLoans, legacyLoans] = await Promise.all([
      keys.length ? this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, clientRef: { in: keys } }, select: { id: true, number: true, clientRef: true } }) : [],
      accountNos.length ? this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, legacyNo: { in: accountNos } }, select: { number: true, legacyNo: true, clientRef: true } }) : [],
    ]);
    const seenKeys = new Map<string, number>();
    for (const p of plans) {
      if (!p.route || !p.accountNo) continue;
      const k = keyOf(p.route.id, p.accountNo);
      const ex = existingLoans.find((l) => l.clientRef === k);
      if (ex) {
        p.existingLoan = { id: ex.id, number: ex.number };
        continue;
      }
      const first = seenKeys.get(k);
      if (first) p.errors.push(issue('duplicateInFile', `Account number repeats row ${first} on the same line`, 'accountNo', { row: first }));
      else seenKeys.set(k, p.rowNo);
      const other = legacyLoans.find((l) => l.legacyNo === p.accountNo && l.clientRef !== k);
      if (other) p.warnings.push(issue('legacyUsedElsewhere', `This old account number is also on loan ${other.number}`, 'accountNo', { number: other.number }));
    }

    // Customers: reuse the one with the same phone, as the app does not allow two customers with one phone.
    const phones = [...new Set(plans.map((p) => p.phone).filter((x): x is string => !!x))];
    const existingCustomers = phones.length
      ? await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, phone: { in: phones } }, select: { id: true, code: true, name: true, phone: true, branchId: true, status: true } })
      : [];
    const newByPhone = new Map<string, RowPlan>();
    for (const p of plans) {
      if (!p.phone || !p.name || p.existingLoan) continue;
      const ex = existingCustomers.find((c) => c.phone === p.phone);
      if (ex) {
        p.customer = { action: 'REUSE', id: ex.id, code: ex.code, name: ex.name };
        if (p.route && ex.branchId !== p.route.branchId) {
          p.errors.push(issue('otherBranchCustomer', `Phone belongs to ${ex.name} (${ex.code}) in another branch`, 'phone', { name: ex.name, code: ex.code }));
        } else {
          p.warnings.push(issue('existingCustomer', `Added to existing customer ${ex.name} (${ex.code}) with this phone`, 'phone', { name: ex.name, code: ex.code }));
        }
        if (ex.status !== 'ACTIVE') p.warnings.push(issue('customerNotActive', `That customer is marked ${ex.status}`, 'phone', { status: ex.status }));
        continue;
      }
      const first = newByPhone.get(p.phone);
      if (first && first.customer) {
        p.customer = { action: 'SAME_AS_ROW', name: first.customer.name, sameAsRow: first.rowNo };
        p.warnings.push(issue('samePhoneInFile', `Same phone as row ${first.rowNo}; the loan goes to that customer`, 'phone', { row: first.rowNo }));
        if (p.route && first.route && first.route.branchId !== p.route.branchId) {
          p.errors.push(issue('otherBranchCustomer', `Phone belongs to ${first.customer.name} in another branch`, 'phone', { name: first.customer.name, code: `#${first.rowNo}` }));
        }
      } else {
        p.customer = { action: 'CREATE', name: p.name };
        newByPhone.set(p.phone, p);
      }
    }

    for (const p of plans) {
      p.status = p.existingLoan ? 'EXISTS' : p.errors.length ? 'ERROR' : p.terms && p.terms.balance === 0 ? 'CLOSED' : 'NEW';
      if (p.status === 'CLOSED') p.warnings.push(issue('closedAccount', 'Fully paid; this account is not imported'));
    }
    // Rows sharing a new customer: the first row that will really be imported creates the customer.
    const creator = new Map<string, number>();
    for (const p of plans) {
      if (p.status !== 'NEW' || !p.customer || p.customer.action === 'REUSE') continue;
      const owner = creator.get(p.phone!);
      if (owner) p.customer = { action: 'SAME_AS_ROW', name: p.customer.name, sameAsRow: owner };
      else {
        p.customer = { action: 'CREATE', name: p.name! };
        creator.set(p.phone!, p.rowNo);
      }
    }
    return { product, fund, plans };
  }

  private parseRow(ctx: Ctx, row: ImportRow, product: LoanProduct, today: string): RowPlan {
    const errors: Issue[] = [];
    const warnings: Issue[] = [];
    const text = (f: ImportField) => importText(row[f]);
    const amount = (f: ImportField) => {
      const v = importAmount(row[f]);
      if (v != null && (Number.isNaN(v) || v < 0)) {
        errors.push(issue('badAmount', `${FIELD_LABEL[f]} is not an amount`, f, { field: f }));
        return null;
      }
      return v;
    };
    const date = (f: ImportField) => {
      const v = importDate(row[f]);
      if (v === 'invalid') {
        errors.push(issue('badDate', `${FIELD_LABEL[f]} is not a date (use DD-MM-YYYY)`, f, { field: f }));
        return null;
      }
      return v;
    };
    const required = (f: ImportField, v: unknown) => {
      if (v == null && !errors.some((e) => e.field === f)) errors.push(issue('required', `${FIELD_LABEL[f]} is missing`, f, { field: f }));
    };

    const accountNo = text('accountNo');
    required('accountNo', accountNo);
    const en = text('name');
    const ta = text('nameTamil');
    const name = en && ta && en !== ta ? `${en} (${ta})` : en ?? ta;
    if (!name) errors.push(issue('required', 'Name is missing', 'name', { field: 'name' }));
    else if (name.length < 2) errors.push(issue('nameTooShort', 'Name is too short', 'name'));
    const rawPhone = text('phone');
    const phone = importPhone(row.phone);
    required('phone', rawPhone);
    if (phone != null && !PHONE.test(phone)) errors.push(issue('badPhone', 'Phone number is not valid', 'phone'));
    const altPhone = importPhone(row.altPhone);

    const principal = amount('loanAmount');
    required('loanAmount', principal);
    if (principal === 0) errors.push(issue('required', 'Loan amount is missing', 'loanAmount', { field: 'loanAmount' }));
    let total = amount('totalPayable');
    const instalment = amount('instalment');
    if (instalment === 0) errors.push(issue('badAmount', 'Instalment must be more than zero', 'instalment', { field: 'instalment' }));
    const received = amount('received');
    const balance = amount('balance');
    let tenure = importCount(row.tenure);
    if (tenure != null && (Number.isNaN(tenure) || tenure <= 0)) {
      errors.push(issue('badNumber', 'No. of instalments is not a whole number', 'tenure', { field: 'tenure' }));
      tenure = null;
    }
    const loanDate = date('loanDate');
    required('loanDate', loanDate);
    if (loanDate && loanDate > today) errors.push(issue('futureDate', 'Loan date is in the future', 'loanDate', { field: 'loanDate' }));
    const firstDueIn = date('firstDueDate');
    const maturityIn = date('maturityDate');

    let terms: Terms | null = null;
    if (principal && loanDate && loanDate <= today && !errors.some((e) => ['totalPayable', 'instalment', 'received', 'balance'].includes(e.field ?? ''))) {
      const frequency = product.frequency as Frequency;
      if (total == null) {
        if (received != null && balance != null) total = received + balance;
        else if (instalment && tenure) total = instalment * tenure;
        else {
          try {
            total = summarize({ principal, frequency, tenure: product.tenure, interestMethod: product.interestMethod as InterestMethod, interestRate: product.interestRate }).totalRepayable;
          } catch {
            total = principal;
          }
        }
      }
      let paid = 0;
      if (total < principal) errors.push(issue('totalBelowLoan', 'Total payable is less than the loan amount', 'totalPayable'));
      if (received != null && balance != null && received + balance !== total) {
        errors.push(issue('paidMismatch', `Received ${formatINR(received)} + balance ${formatINR(balance)} is not the total payable ${formatINR(total)}`, 'balance', { received: formatINR(received), balance: formatINR(balance), total: formatINR(total) }));
      }
      if (received != null) paid = received;
      else if (balance != null) paid = total - balance;
      else warnings.push(issue('nothingPaid', 'Received and balance are not given; treated as nothing paid yet'));
      if (paid < 0 || paid > total) errors.push(issue('paidTooMuch', 'Balance or received is more than the total payable', balance != null ? 'balance' : 'received'));

      let n: number;
      if (instalment) {
        n = Math.max(1, Math.ceil(total / instalment));
        if (tenure && tenure !== n) warnings.push(issue('tenureDiffers', `Total ÷ instalment gives ${n} instalments, the sheet says ${tenure}`, 'tenure', { computed: n, given: tenure }));
      } else n = tenure ?? product.tenure;
      if (n > 1000) errors.push(issue('tooManyInstalments', 'More than 1000 instalments', 'tenure'));
      const firstDue = firstDueIn ?? defaultFirstDue(loanDate, frequency);
      if (firstDue <= loanDate) errors.push(issue('firstDueBeforeLoan', 'First due date must be after the loan date', 'firstDueDate'));
      if (!errors.length && total > 0) {
        const amounts = instalment
          ? Array.from({ length: n }, (_, k) => (k < n - 1 ? instalment : total! - instalment * (n - 1)))
          : Array.from({ length: n }, (_, k) => Math.floor(total! / n) + (k === n - 1 ? total! - Math.floor(total! / n) * n : 0));
        const dates = dueDates(firstDue, frequency, n, ctx.settings);
        const maturity = dates[dates.length - 1];
        if (maturityIn && maturityIn !== maturity) {
          warnings.push(issue('maturityDiffers', `The schedule ends on ${maturity}; the sheet says ${maturityIn}`, 'maturityDate', { computed: maturity, given: maturityIn }));
        }
        terms = { principal, totalPayable: total, paid, balance: total - paid, instalment: amounts[0], tenure: n, loanDate, firstDueDate: firstDue, maturityDate: maturity, amounts, dates };
      }
    }
    const lang = name && hasTamil(name) ? 'ta' : ctx.settings.defaultLanguage;
    return {
      rowNo: row.rowNo,
      accountNo,
      name,
      phone,
      status: 'ERROR',
      errors,
      warnings,
      route: null,
      customer: null,
      existingLoan: null,
      terms,
      input: { altPhone: altPhone && PHONE.test(altPhone) ? altPhone : null, address: text('address'), occupation: text('occupation'), idNumber: text('idNumber'), language: lang },
    };
  }

  private summary(plans: RowPlan[]) {
    const fresh = plans.filter((p) => p.status === 'NEW');
    return {
      rows: plans.length,
      newLoans: fresh.length,
      newCustomers: fresh.filter((p) => p.customer?.action === 'CREATE').length,
      reusedCustomers: fresh.filter((p) => p.customer?.action !== 'CREATE').length,
      existing: plans.filter((p) => p.status === 'EXISTS').length,
      closed: plans.filter((p) => p.status === 'CLOSED').length,
      errors: plans.filter((p) => p.status === 'ERROR').length,
      warnings: plans.filter((p) => p.warnings.length).length,
      principal: fresh.reduce((s, p) => s + (p.terms?.principal ?? 0), 0),
      totalPayable: fresh.reduce((s, p) => s + (p.terms?.totalPayable ?? 0), 0),
      paid: fresh.reduce((s, p) => s + (p.terms?.paid ?? 0), 0),
      balance: fresh.reduce((s, p) => s + (p.terms?.balance ?? 0), 0),
    };
  }

  private view(p: RowPlan) {
    const t = p.terms;
    return {
      rowNo: p.rowNo,
      accountNo: p.accountNo,
      name: p.name,
      phone: p.phone,
      line: p.route?.name ?? null,
      status: p.status,
      errors: p.errors,
      warnings: p.warnings,
      customer: p.customer ? { action: p.customer.action, code: p.customer.code ?? null, name: p.customer.name } : null,
      existingLoan: p.existingLoan,
      principal: t?.principal ?? null,
      totalPayable: t?.totalPayable ?? null,
      paid: t?.paid ?? null,
      balance: t?.balance ?? null,
      instalment: t?.instalment ?? null,
      tenure: t?.tenure ?? null,
      loanDate: t?.loanDate ?? null,
      firstDueDate: t?.firstDueDate ?? null,
      maturityDate: t?.maturityDate ?? null,
    };
  }

  async preview(ctx: Ctx, req: ImportRequest) {
    const { plans } = await this.plan(ctx, req);
    return { summary: this.summary(plans), rows: plans.map((p) => this.view(p)) };
  }

  async run(ctx: Ctx, req: ImportRequest) {
    const { product, fund, plans } = await this.plan(ctx, req);
    const summary = this.summary(plans);
    if (summary.errors && !req.skipErrors) {
      throw bad(`${summary.errors} rows have errors. Fix them, or choose to leave them out.`, 'import.hasErrors');
    }
    const todo = plans.filter((p) => p.status === 'NEW');
    const today = todayIST();
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    if (todo.length && (await this.prisma.loan.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } })) + todo.length > tenant.maxActiveLoans) {
      throw bad(`Your plan allows ${tenant.maxActiveLoans} active loans`);
    }
    const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true } });
    const created: { rowNo: number; loanId: string; loanNumber: string; customerId: string; customerCode: string }[] = [];
    const timeout = Math.min(600_000, Math.max(60_000, todo.length * 150));
    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (!todo.length) return;
          const newCustomers = todo.filter((p) => p.customer?.action === 'CREATE').length;
          // Reserve the customer and loan numbers in one step each.
          const t = await tx.tenant.update({ where: { id: ctx.tenantId }, data: { customerSeq: { increment: newCustomers }, loanSeq: { increment: todo.length } } });
          let customerSeq = t.customerSeq - newCustomers;
          let loanSeq = t.loanSeq - todo.length;
          const routeIds = [...new Set(todo.map((p) => p.route!.id))];
          const maxSeq = await tx.customer.groupBy({ by: ['routeId'], where: { tenantId: ctx.tenantId, routeId: { in: routeIds } }, _max: { routeSeq: true } });
          const routeSeq = new Map(routeIds.map((id) => [id, maxSeq.find((m) => m.routeId === id)?._max.routeSeq ?? 0]));
          const customerByRow = new Map<number, { id: string; code: string }>();
          const ledger: Prisma.LedgerEntryCreateManyInput[] = [];
          const stamp = Date.now();

          for (const [k, p] of todo.entries()) {
            const r = p.route!;
            const terms = p.terms!;
            let customer: { id: string; code: string };
            if (p.customer!.action === 'REUSE') customer = { id: p.customer!.id!, code: p.customer!.code! };
            else if (p.customer!.action === 'SAME_AS_ROW') customer = customerByRow.get(p.customer!.sameAsRow!)!;
            else {
              const seq = routeSeq.get(r.id)! + 1;
              routeSeq.set(r.id, seq);
              customer = await tx.customer.create({
                data: {
                  tenantId: ctx.tenantId,
                  branchId: r.branchId,
                  locationId: r.locationId,
                  routeId: r.id,
                  routeSeq: seq,
                  code: `C${pad(++customerSeq)}`,
                  name: p.name!,
                  phone: p.phone!,
                  altPhone: p.input.altPhone,
                  address: p.input.address && p.input.address.length >= 3 ? p.input.address : `${r.locationName}, ${r.name}`,
                  occupation: p.input.occupation,
                  idNumber: p.input.idNumber,
                  language: p.input.language,
                  clientRef: keyOf(r.id, p.accountNo!),
                  createdById: ctx.userId,
                },
                select: { id: true, code: true },
              });
            }
            customerByRow.set(p.rowNo, customer);

            const split = splitSchedule(terms.amounts, terms.principal, terms.totalPayable);
            const states: InstalmentState[] = split.map((s, i) => ({ id: String(i), seq: i + 1, dueDate: terms.dates[i], ...s, principalPaid: 0, interestPaid: 0 }));
            const alloc = terms.paid > 0 ? allocatePayment(terms.paid, states, 0) : { perInstalment: [] };
            for (const a of alloc.perInstalment) {
              const s = states[Number(a.id)];
              s.principalPaid = a.principal;
              s.interestPaid = a.interest;
              if (a.fullyPaid) s.paidOn = s.dueDate < today ? s.dueDate : today;
            }
            const branch = branches.find((b) => b.id === r.branchId)!;
            const number = `${branch.code}-${pad(++loanSeq)}`;
            const interest = terms.totalPayable - terms.principal;
            const loan = await tx.loan.create({
              data: {
                tenantId: ctx.tenantId,
                branchId: r.branchId,
                customerId: customer.id,
                productId: product.id,
                number,
                principal: terms.principal,
                frequency: product.frequency,
                tenure: terms.tenure,
                interestMethod: 'FLAT',
                // FLAT: % of principal for the whole loan, so the schedule's interest matches the old total payable.
                interestRate: (interest * 100) / terms.principal,
                feePercent: 0,
                feeFlat: 0,
                // Old arrears do not start charging penalty; the outstanding stays what the old books said.
                penaltyType: 'NONE',
                penaltyValue: 0,
                graceDays: product.graceDays,
                notes: `Imported from the old system (A/c ${p.accountNo})`,
                status: 'ACTIVE',
                stage: 'BRANCH',
                requestedById: ctx.userId,
                approvedById: ctx.userId,
                approvedAt: new Date(),
                disbursedOn: terms.loanDate,
                firstDueDate: terms.firstDueDate,
                fundId: fund?.id ?? null,
                fee: 0,
                upfrontInterest: 0,
                // No cash left a fund in this app for these loans.
                netDisbursed: 0,
                totalInterest: interest,
                clientRef: keyOf(r.id, p.accountNo!),
                legacyNo: p.accountNo,
                migrated: true,
                openingPaid: terms.paid,
                instalments: {
                  createMany: {
                    data: states.map((s) => ({
                      tenantId: ctx.tenantId,
                      seq: s.seq,
                      dueDate: s.dueDate,
                      principalDue: s.principalDue,
                      interestDue: s.interestDue,
                      principalPaid: s.principalPaid,
                      interestPaid: s.interestPaid,
                      paidOn: s.paidOn ?? null,
                    })),
                  },
                },
              },
              select: { id: true },
            });
            const base = { tenantId: ctx.tenantId, loanId: loan.id, customerId: customer.id, date: terms.loanDate, type: 'OPENING' };
            ledger.push({
              ...base,
              description: `Opening balance: loan ${formatINR(terms.principal)} (old A/c ${p.accountNo}), total payable ${formatINR(terms.totalPayable)}`,
              debit: terms.totalPayable,
              balance: terms.totalPayable,
              createdAt: new Date(stamp + k * 2),
            });
            if (terms.paid > 0) {
              ledger.push({ ...base, description: 'Received before the import (old system)', credit: terms.paid, balance: terms.balance, createdAt: new Date(stamp + k * 2 + 1) });
            }
            created.push({ rowNo: p.rowNo, loanId: loan.id, loanNumber: number, customerId: customer.id, customerCode: customer.code });
          }
          await tx.ledgerEntry.createMany({ data: ledger });
        },
        { timeout, maxWait: 10_000 },
      );
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('Some of these accounts were imported at the same time by someone else; check again', 'import.conflict');
      throw e;
    }
    const result = { ...summary, imported: created.length };
    await this.audit.log(ctx, 'IMPORT', 'Import', null, undefined, {
      fileName: req.fileName ?? null,
      productId: product.id,
      routeId: req.routeId ?? null,
      fundId: fund?.id ?? null,
      skipErrors: req.skipErrors,
      ...result,
      loans: created.map((c) => c.loanNumber),
    });
    const byRow = new Map(created.map((c) => [c.rowNo, c]));
    return {
      summary: result,
      rows: plans.map((p) => {
        const c = byRow.get(p.rowNo);
        return { ...this.view(p), status: c ? 'IMPORTED' : p.status, loan: c ? { id: c.loanId, number: c.loanNumber } : p.existingLoan, customerCode: c?.customerCode ?? p.customer?.code ?? null };
      }),
    };
  }
}

@Controller('imports')
export class ImportsController {
  constructor(private readonly svc: ImportsService) {}

  /** Checks the rows and says what an import would create; nothing is written. */
  @Post('preview') @Perm('settings.manage') preview(@CurrentCtx() ctx: Ctx, @Body(V(importRequestSchema)) b: z.infer<typeof importRequestSchema>) {
    return this.svc.preview(ctx, b);
  }
  @Post('run') @Perm('settings.manage') run(@CurrentCtx() ctx: Ctx, @Body(V(importRequestSchema)) b: z.infer<typeof importRequestSchema>) {
    return this.svc.run(ctx, b);
  }
}
