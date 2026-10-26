"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ImportsController = exports.ImportsService = void 0;
const common_1 = require("@nestjs/common");
const shared_1 = require("@localfinance/shared");
const zod_1 = require("zod");
const audit_service_1 = require("../common/audit.service");
const context_1 = require("../common/context");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../common/prisma.service");
const scope_1 = require("../common/scope");
const zod_pipe_1 = require("../common/zod.pipe");
const pad = (n, w = 6) => String(n).padStart(w, '0');
const keyOf = (routeId, accountNo) => `import:${routeId}:${accountNo.toLowerCase()}`;
const PHONE = /^[0-9+][0-9 -]{6,15}$/;
const FIELD_LABEL = {
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
const issue = (code, message, field, params) => ({
    code,
    message,
    ...(field ? { field } : {}),
    ...(params ? { params } : {}),
});
/**
 * Splits each instalment into principal and interest in the loan's proportion, cumulatively so the parts add up
 * to the loan amount exactly.
 */
function splitSchedule(amounts, principal, total) {
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
let ImportsService = class ImportsService {
    prisma;
    audit;
    constructor(prisma, audit) {
        this.prisma = prisma;
        this.audit = audit;
    }
    async plan(ctx, req) {
        const today = (0, shared_1.todayIST)();
        const product = await this.prisma.loanProduct.findFirst({ where: { id: req.productId, tenantId: ctx.tenantId } });
        if (!product)
            throw (0, errors_1.notFound)('Product');
        const routes = await this.prisma.route.findMany({ where: { ...(0, scope_1.branchScope)(ctx), active: true }, include: { location: true } });
        let defaultRoute = null;
        if (req.routeId) {
            defaultRoute = routes.find((r) => r.id === req.routeId) ?? null;
            if (!defaultRoute)
                throw (0, errors_1.notFound)('Route');
        }
        if (req.branchId)
            (0, scope_1.assertBranch)(ctx, req.branchId);
        const preferBranch = req.branchId ?? defaultRoute?.branchId ?? null;
        let fund = null;
        if (req.fundId) {
            fund = await this.prisma.fund.findFirst({ where: { id: req.fundId, tenantId: ctx.tenantId, active: true } });
            if (!fund)
                throw (0, errors_1.notFound)('Fund');
        }
        const byName = new Map();
        for (const r of routes) {
            const k = r.name.trim().toLowerCase();
            byName.set(k, [...(byName.get(k) ?? []), r]);
        }
        const plans = req.rows.map((row) => this.parseRow(ctx, row, product, today));
        // Resolve lines.
        for (const [i, p] of plans.entries()) {
            const lineName = (0, shared_1.importText)(req.rows[i].line);
            let r = null;
            if (lineName) {
                const found = byName.get(lineName.toLowerCase()) ?? [];
                const pick = found.length > 1 ? found.filter((x) => x.branchId === preferBranch) : found;
                if (pick.length === 1)
                    r = pick[0];
                else if (found.length > 1)
                    p.errors.push(issue('lineAmbiguous', `Line "${lineName}" exists in more than one branch; choose the branch`, 'line', { line: lineName }));
                else
                    p.errors.push(issue('lineNotFound', `Line "${lineName}" was not found; add it under Routes first`, 'line', { line: lineName }));
            }
            else if (defaultRoute)
                r = defaultRoute;
            else
                p.errors.push(issue('noLine', 'No line: choose a default line or map the Line column', 'line'));
            if (r)
                p.route = { id: r.id, name: r.name, branchId: r.branchId, locationId: r.locationId, locationName: r.location.name };
            if (r && fund && fund.branchId !== r.branchId)
                p.errors.push(issue('fundOtherBranch', 'The chosen fund belongs to another branch than this line'));
        }
        // Already imported (same line and old account number), or the old number used on another loan.
        const keys = plans.filter((p) => p.route && p.accountNo).map((p) => keyOf(p.route.id, p.accountNo));
        const accountNos = [...new Set(plans.map((p) => p.accountNo).filter((a) => !!a))];
        const [existingLoans, legacyLoans] = await Promise.all([
            keys.length ? this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, clientRef: { in: keys } }, select: { id: true, number: true, clientRef: true } }) : [],
            accountNos.length ? this.prisma.loan.findMany({ where: { tenantId: ctx.tenantId, legacyNo: { in: accountNos } }, select: { number: true, legacyNo: true, clientRef: true } }) : [],
        ]);
        const seenKeys = new Map();
        for (const p of plans) {
            if (!p.route || !p.accountNo)
                continue;
            const k = keyOf(p.route.id, p.accountNo);
            const ex = existingLoans.find((l) => l.clientRef === k);
            if (ex) {
                p.existingLoan = { id: ex.id, number: ex.number };
                continue;
            }
            const first = seenKeys.get(k);
            if (first)
                p.errors.push(issue('duplicateInFile', `Account number repeats row ${first} on the same line`, 'accountNo', { row: first }));
            else
                seenKeys.set(k, p.rowNo);
            const other = legacyLoans.find((l) => l.legacyNo === p.accountNo && l.clientRef !== k);
            if (other)
                p.warnings.push(issue('legacyUsedElsewhere', `This old account number is also on loan ${other.number}`, 'accountNo', { number: other.number }));
        }
        // Customers: reuse the one with the same phone, as the app does not allow two customers with one phone.
        const phones = [...new Set(plans.map((p) => p.phone).filter((x) => !!x))];
        const existingCustomers = phones.length
            ? await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId, phone: { in: phones } }, select: { id: true, code: true, name: true, phone: true, branchId: true, status: true } })
            : [];
        const newByPhone = new Map();
        for (const p of plans) {
            if (!p.phone || !p.name || p.existingLoan)
                continue;
            const ex = existingCustomers.find((c) => c.phone === p.phone);
            if (ex) {
                p.customer = { action: 'REUSE', id: ex.id, code: ex.code, name: ex.name };
                if (p.route && ex.branchId !== p.route.branchId) {
                    p.errors.push(issue('otherBranchCustomer', `Phone belongs to ${ex.name} (${ex.code}) in another branch`, 'phone', { name: ex.name, code: ex.code }));
                }
                else {
                    p.warnings.push(issue('existingCustomer', `Added to existing customer ${ex.name} (${ex.code}) with this phone`, 'phone', { name: ex.name, code: ex.code }));
                }
                if (ex.status !== 'ACTIVE')
                    p.warnings.push(issue('customerNotActive', `That customer is marked ${ex.status}`, 'phone', { status: ex.status }));
                continue;
            }
            const first = newByPhone.get(p.phone);
            if (first && first.customer) {
                p.customer = { action: 'SAME_AS_ROW', name: first.customer.name, sameAsRow: first.rowNo };
                p.warnings.push(issue('samePhoneInFile', `Same phone as row ${first.rowNo}; the loan goes to that customer`, 'phone', { row: first.rowNo }));
                if (p.route && first.route && first.route.branchId !== p.route.branchId) {
                    p.errors.push(issue('otherBranchCustomer', `Phone belongs to ${first.customer.name} in another branch`, 'phone', { name: first.customer.name, code: `#${first.rowNo}` }));
                }
            }
            else {
                p.customer = { action: 'CREATE', name: p.name };
                newByPhone.set(p.phone, p);
            }
        }
        for (const p of plans) {
            p.status = p.existingLoan ? 'EXISTS' : p.errors.length ? 'ERROR' : p.terms && p.terms.balance === 0 ? 'CLOSED' : 'NEW';
            if (p.status === 'CLOSED')
                p.warnings.push(issue('closedAccount', 'Fully paid; this account is not imported'));
        }
        // Rows sharing a new customer: the first row that will really be imported creates the customer.
        const creator = new Map();
        for (const p of plans) {
            if (p.status !== 'NEW' || !p.customer || p.customer.action === 'REUSE')
                continue;
            const owner = creator.get(p.phone);
            if (owner)
                p.customer = { action: 'SAME_AS_ROW', name: p.customer.name, sameAsRow: owner };
            else {
                p.customer = { action: 'CREATE', name: p.name };
                creator.set(p.phone, p.rowNo);
            }
        }
        return { product, fund, plans };
    }
    parseRow(ctx, row, product, today) {
        const errors = [];
        const warnings = [];
        const text = (f) => (0, shared_1.importText)(row[f]);
        const amount = (f) => {
            const v = (0, shared_1.importAmount)(row[f]);
            if (v != null && (Number.isNaN(v) || v < 0)) {
                errors.push(issue('badAmount', `${FIELD_LABEL[f]} is not an amount`, f, { field: f }));
                return null;
            }
            return v;
        };
        const date = (f) => {
            const v = (0, shared_1.importDate)(row[f]);
            if (v === 'invalid') {
                errors.push(issue('badDate', `${FIELD_LABEL[f]} is not a date (use DD-MM-YYYY)`, f, { field: f }));
                return null;
            }
            return v;
        };
        const required = (f, v) => {
            if (v == null && !errors.some((e) => e.field === f))
                errors.push(issue('required', `${FIELD_LABEL[f]} is missing`, f, { field: f }));
        };
        const accountNo = text('accountNo');
        required('accountNo', accountNo);
        const en = text('name');
        const ta = text('nameTamil');
        const name = en && ta && en !== ta ? `${en} (${ta})` : en ?? ta;
        if (!name)
            errors.push(issue('required', 'Name is missing', 'name', { field: 'name' }));
        else if (name.length < 2)
            errors.push(issue('nameTooShort', 'Name is too short', 'name'));
        const rawPhone = text('phone');
        const phone = (0, shared_1.importPhone)(row.phone);
        required('phone', rawPhone);
        if (phone != null && !PHONE.test(phone))
            errors.push(issue('badPhone', 'Phone number is not valid', 'phone'));
        const altPhone = (0, shared_1.importPhone)(row.altPhone);
        const principal = amount('loanAmount');
        required('loanAmount', principal);
        if (principal === 0)
            errors.push(issue('required', 'Loan amount is missing', 'loanAmount', { field: 'loanAmount' }));
        let total = amount('totalPayable');
        const instalment = amount('instalment');
        if (instalment === 0)
            errors.push(issue('badAmount', 'Instalment must be more than zero', 'instalment', { field: 'instalment' }));
        const received = amount('received');
        const balance = amount('balance');
        let tenure = (0, shared_1.importCount)(row.tenure);
        if (tenure != null && (Number.isNaN(tenure) || tenure <= 0)) {
            errors.push(issue('badNumber', 'No. of instalments is not a whole number', 'tenure', { field: 'tenure' }));
            tenure = null;
        }
        const loanDate = date('loanDate');
        required('loanDate', loanDate);
        if (loanDate && loanDate > today)
            errors.push(issue('futureDate', 'Loan date is in the future', 'loanDate', { field: 'loanDate' }));
        const firstDueIn = date('firstDueDate');
        const maturityIn = date('maturityDate');
        let terms = null;
        if (principal && loanDate && loanDate <= today && !errors.some((e) => ['totalPayable', 'instalment', 'received', 'balance'].includes(e.field ?? ''))) {
            const frequency = product.frequency;
            if (total == null) {
                if (received != null && balance != null)
                    total = received + balance;
                else if (instalment && tenure)
                    total = instalment * tenure;
                else {
                    try {
                        total = (0, shared_1.summarize)({ principal, frequency, tenure: product.tenure, interestMethod: product.interestMethod, interestRate: product.interestRate }).totalRepayable;
                    }
                    catch {
                        total = principal;
                    }
                }
            }
            let paid = 0;
            if (total < principal)
                errors.push(issue('totalBelowLoan', 'Total payable is less than the loan amount', 'totalPayable'));
            if (received != null && balance != null && received + balance !== total) {
                errors.push(issue('paidMismatch', `Received ${(0, shared_1.formatINR)(received)} + balance ${(0, shared_1.formatINR)(balance)} is not the total payable ${(0, shared_1.formatINR)(total)}`, 'balance', { received: (0, shared_1.formatINR)(received), balance: (0, shared_1.formatINR)(balance), total: (0, shared_1.formatINR)(total) }));
            }
            if (received != null)
                paid = received;
            else if (balance != null)
                paid = total - balance;
            else
                warnings.push(issue('nothingPaid', 'Received and balance are not given; treated as nothing paid yet'));
            if (paid < 0 || paid > total)
                errors.push(issue('paidTooMuch', 'Balance or received is more than the total payable', balance != null ? 'balance' : 'received'));
            let n;
            if (instalment) {
                n = Math.max(1, Math.ceil(total / instalment));
                if (tenure && tenure !== n)
                    warnings.push(issue('tenureDiffers', `Total ÷ instalment gives ${n} instalments, the sheet says ${tenure}`, 'tenure', { computed: n, given: tenure }));
            }
            else
                n = tenure ?? product.tenure;
            if (n > 1000)
                errors.push(issue('tooManyInstalments', 'More than 1000 instalments', 'tenure'));
            const firstDue = firstDueIn ?? (0, shared_1.defaultFirstDue)(loanDate, frequency);
            if (firstDue <= loanDate)
                errors.push(issue('firstDueBeforeLoan', 'First due date must be after the loan date', 'firstDueDate'));
            if (!errors.length && total > 0) {
                const amounts = instalment
                    ? Array.from({ length: n }, (_, k) => (k < n - 1 ? instalment : total - instalment * (n - 1)))
                    : Array.from({ length: n }, (_, k) => Math.floor(total / n) + (k === n - 1 ? total - Math.floor(total / n) * n : 0));
                const dates = (0, shared_1.dueDates)(firstDue, frequency, n, ctx.settings);
                const maturity = dates[dates.length - 1];
                if (maturityIn && maturityIn !== maturity) {
                    warnings.push(issue('maturityDiffers', `The schedule ends on ${maturity}; the sheet says ${maturityIn}`, 'maturityDate', { computed: maturity, given: maturityIn }));
                }
                terms = { principal, totalPayable: total, paid, balance: total - paid, instalment: amounts[0], tenure: n, loanDate, firstDueDate: firstDue, maturityDate: maturity, amounts, dates };
            }
        }
        const lang = name && (0, shared_1.hasTamil)(name) ? 'ta' : ctx.settings.defaultLanguage;
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
    summary(plans) {
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
    view(p) {
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
    async preview(ctx, req) {
        const { plans } = await this.plan(ctx, req);
        return { summary: this.summary(plans), rows: plans.map((p) => this.view(p)) };
    }
    async run(ctx, req) {
        const { product, fund, plans } = await this.plan(ctx, req);
        const summary = this.summary(plans);
        if (summary.errors && !req.skipErrors) {
            throw (0, errors_1.bad)(`${summary.errors} rows have errors. Fix them, or choose to leave them out.`, 'import.hasErrors');
        }
        const todo = plans.filter((p) => p.status === 'NEW');
        const today = (0, shared_1.todayIST)();
        const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
        if (todo.length && (await this.prisma.loan.count({ where: { tenantId: ctx.tenantId, status: 'ACTIVE' } })) + todo.length > tenant.maxActiveLoans) {
            throw (0, errors_1.bad)(`Your plan allows ${tenant.maxActiveLoans} active loans`);
        }
        const branches = await this.prisma.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true } });
        const created = [];
        const timeout = Math.min(600_000, Math.max(60_000, todo.length * 150));
        try {
            await this.prisma.$transaction(async (tx) => {
                if (!todo.length)
                    return;
                const newCustomers = todo.filter((p) => p.customer?.action === 'CREATE').length;
                // Reserve the customer and loan numbers in one step each.
                const t = await tx.tenant.update({ where: { id: ctx.tenantId }, data: { customerSeq: { increment: newCustomers }, loanSeq: { increment: todo.length } } });
                let customerSeq = t.customerSeq - newCustomers;
                let loanSeq = t.loanSeq - todo.length;
                const routeIds = [...new Set(todo.map((p) => p.route.id))];
                const maxSeq = await tx.customer.groupBy({ by: ['routeId'], where: { tenantId: ctx.tenantId, routeId: { in: routeIds } }, _max: { routeSeq: true } });
                const routeSeq = new Map(routeIds.map((id) => [id, maxSeq.find((m) => m.routeId === id)?._max.routeSeq ?? 0]));
                const customerByRow = new Map();
                const ledger = [];
                const stamp = Date.now();
                for (const [k, p] of todo.entries()) {
                    const r = p.route;
                    const terms = p.terms;
                    let customer;
                    if (p.customer.action === 'REUSE')
                        customer = { id: p.customer.id, code: p.customer.code };
                    else if (p.customer.action === 'SAME_AS_ROW')
                        customer = customerByRow.get(p.customer.sameAsRow);
                    else {
                        const seq = routeSeq.get(r.id) + 1;
                        routeSeq.set(r.id, seq);
                        customer = await tx.customer.create({
                            data: {
                                tenantId: ctx.tenantId,
                                branchId: r.branchId,
                                locationId: r.locationId,
                                routeId: r.id,
                                routeSeq: seq,
                                code: `C${pad(++customerSeq)}`,
                                name: p.name,
                                phone: p.phone,
                                altPhone: p.input.altPhone,
                                address: p.input.address && p.input.address.length >= 3 ? p.input.address : `${r.locationName}, ${r.name}`,
                                occupation: p.input.occupation,
                                idNumber: p.input.idNumber,
                                language: p.input.language,
                                clientRef: keyOf(r.id, p.accountNo),
                                createdById: ctx.userId,
                            },
                            select: { id: true, code: true },
                        });
                    }
                    customerByRow.set(p.rowNo, customer);
                    const split = splitSchedule(terms.amounts, terms.principal, terms.totalPayable);
                    const states = split.map((s, i) => ({ id: String(i), seq: i + 1, dueDate: terms.dates[i], ...s, principalPaid: 0, interestPaid: 0 }));
                    const alloc = terms.paid > 0 ? (0, shared_1.allocatePayment)(terms.paid, states, 0) : { perInstalment: [] };
                    for (const a of alloc.perInstalment) {
                        const s = states[Number(a.id)];
                        s.principalPaid = a.principal;
                        s.interestPaid = a.interest;
                        if (a.fullyPaid)
                            s.paidOn = s.dueDate < today ? s.dueDate : today;
                    }
                    const branch = branches.find((b) => b.id === r.branchId);
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
                            clientRef: keyOf(r.id, p.accountNo),
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
                        description: `Opening balance: loan ${(0, shared_1.formatINR)(terms.principal)} (old A/c ${p.accountNo}), total payable ${(0, shared_1.formatINR)(terms.totalPayable)}`,
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
            }, { timeout, maxWait: 10_000 });
        }
        catch (e) {
            if (e.code === 'P2002')
                throw (0, errors_1.conflict)('Some of these accounts were imported at the same time by someone else; check again', 'import.conflict');
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
};
exports.ImportsService = ImportsService;
exports.ImportsService = ImportsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        audit_service_1.AuditService])
], ImportsService);
let ImportsController = class ImportsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    /** Checks the rows and says what an import would create; nothing is written. */
    preview(ctx, b) {
        return this.svc.preview(ctx, b);
    }
    run(ctx, b) {
        return this.svc.run(ctx, b);
    }
};
exports.ImportsController = ImportsController;
__decorate([
    (0, common_1.Post)('preview'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.importRequestSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ImportsController.prototype, "preview", null);
__decorate([
    (0, common_1.Post)('run'),
    (0, context_1.Perm)('settings.manage'),
    __param(0, (0, context_1.CurrentCtx)()),
    __param(1, (0, common_1.Body)((0, zod_pipe_1.V)(shared_1.importRequestSchema))),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, void 0]),
    __metadata("design:returntype", void 0)
], ImportsController.prototype, "run", null);
exports.ImportsController = ImportsController = __decorate([
    (0, common_1.Controller)('imports'),
    __metadata("design:paramtypes", [ImportsService])
], ImportsController);
//# sourceMappingURL=imports.js.map