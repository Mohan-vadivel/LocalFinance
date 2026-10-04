import 'reflect-metadata';
import { loadEnv } from './env';
loadEnv();
import { NestFactory } from '@nestjs/core';
import * as bcrypt from 'bcryptjs';
import { addDays, DEFAULT_ROLE_PERMISSIONS, tenantSettingsSchema, todayIST, type Permission, type RoleCode } from '@localfinance/shared';
import { AppModule } from './app.module';
import type { Ctx } from './common/context';
import { PrismaService } from './common/prisma.service';
import { CollectionsService } from './modules/collections';
import { CustomersService } from './modules/customers';
import { LoansService } from './modules/loans';
import { DaybookService, FundsService, InvestorsService } from './modules/money';
import { StaffService } from './modules/staff';
import { StructureService } from './modules/structure';
import { TenantsService } from './modules/tenants';

/**
 * Creates the platform Super Admin and, with `--demo`, a demo business with a branch, two locations, routes,
 * one staff member per role, loan products, funds, an investor, customers pinned around Madurai, loans and
 * some collections. Safe to run twice.
 */
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const prisma = app.get(PrismaService);

  const superPhone = process.env.SUPER_ADMIN_PHONE ?? '9000000000';
  const superPassword = process.env.SUPER_ADMIN_PASSWORD ?? 'ChangeMe@123';
  let superRole = await prisma.role.findFirst({ where: { tenantId: null, baseRole: 'SUPER_ADMIN' } });
  if (!superRole) {
    superRole = await prisma.role.create({ data: { name: 'Super Admin', baseRole: 'SUPER_ADMIN', permissions: DEFAULT_ROLE_PERMISSIONS.SUPER_ADMIN, system: true } });
  }
  const superUser =
    (await prisma.user.findFirst({ where: { tenantId: null, phone: superPhone } })) ??
    (await prisma.user.create({ data: { name: 'Platform Admin', phone: superPhone, passwordHash: await bcrypt.hash(superPassword, 10), roleId: superRole.id } }));
  console.log(`Super Admin: ${superPhone}`);

  if (!process.argv.includes('--demo')) return app.close();
  if (await prisma.tenant.findFirst({ where: { name: 'Demo Finance' } })) {
    console.log('Demo business already exists');
    return app.close();
  }

  const superCtx = ctx(superUser.id, '', 'SUPER_ADMIN');
  const tenant = await app.get(TenantsService).create(superCtx, {
    name: 'Demo Finance',
    ownerName: 'Owner Demo',
    ownerPhone: '9000000001',
    ownerPassword: 'Demo@1234',
    plan: 'STANDARD',
    maxBranches: 10,
    maxStaff: 100,
    maxActiveLoans: 50000,
  });
  const admin = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id } });
  const A = ctx(admin.id, tenant.id, 'TENANT_ADMIN');

  const structure = app.get(StructureService);
  const branch = await structure.createBranch(A, { name: 'Madurai', code: 'MDU', address: 'Main Road, Madurai', lat: 9.9252, lng: 78.1198 });
  const anna = await structure.createLocation(A, { branchId: branch.id, name: 'Anna Nagar', lat: 9.9196, lng: 78.1428 });
  const kk = await structure.createLocation(A, { branchId: branch.id, name: 'KK Nagar', lat: 9.9312, lng: 78.1531 });
  const r1 = await structure.createRoute(A, { locationId: anna.id, name: 'Anna Nagar Daily 1', collectionDays: [1, 2, 3, 4, 5, 6] });
  const r2 = await structure.createRoute(A, { locationId: kk.id, name: 'KK Nagar Weekly', collectionDays: [1, 3, 5] });

  const roles = await prisma.role.findMany({ where: { tenantId: tenant.id } });
  const roleId = (code: RoleCode) => roles.find((r) => r.baseRole === code)!.id;
  const staff = app.get(StaffService);
  const mk = (name: string, phone: string, code: RoleCode, approvalLimit = 0) =>
    staff.create(A, { name, phone, password: 'Demo@1234', roleId: roleId(code), branchIds: [branch.id], approvalLimit, language: 'en' });
  const manager = await mk('Murugan (Manager)', '9000000002', 'BRANCH_MANAGER', 2_500_000);
  const officer = await mk('Lakshmi (Loan Officer)', '9000000003', 'LOAN_OFFICER');
  const agent1 = await mk('Karthik (Agent)', '9000000004', 'COLLECTION_AGENT');
  const agent2 = await mk('Selvi (Agent)', '9000000005', 'COLLECTION_AGENT');
  await mk('Priya (Accountant)', '9000000006', 'ACCOUNTANT');
  await mk('Ravi (Auditor)', '9000000007', 'AUDITOR');
  const today = todayIST();
  await structure.assign(A, r1.id, { userId: agent1.id, fromDate: addDays(today, -30) });
  await structure.assign(A, r2.id, { userId: agent2.id, fromDate: addDays(today, -30) });

  const loans = app.get(LoansService);
  const daily = await loans.saveProduct(A, { name: 'Daily 10,000 / 100 days', frequency: 'DAILY', minAmount: 500_000, maxAmount: 5_000_000, tenure: 100, interestMethod: 'FLAT', interestRate: 20, feePercent: 1, feeFlat: 0, penaltyType: 'FIXED_PER_DAY', penaltyValue: 1000, graceDays: 2 });
  const weekly = await loans.saveProduct(A, { name: 'Weekly 20,000 / 12 weeks', frequency: 'WEEKLY', minAmount: 1_000_000, maxAmount: 10_000_000, tenure: 12, interestMethod: 'FLAT', interestRate: 15, feePercent: 1, feeFlat: 0, penaltyType: 'PERCENT_PER_DAY', penaltyValue: 0.5, graceDays: 3 });
  await loans.saveProduct(A, { name: 'Monthly 50,000 / 12 months', frequency: 'MONTHLY', minAmount: 2_000_000, maxAmount: 20_000_000, tenure: 12, interestMethod: 'REDUCING', interestRate: 24, feePercent: 2, feeFlat: 0, penaltyType: 'NONE', penaltyValue: 0, graceDays: 5 });
  await loans.saveProduct(A, { name: 'Daily upfront 10,000 / 100 days', frequency: 'DAILY', minAmount: 500_000, maxAmount: 5_000_000, tenure: 100, interestMethod: 'UPFRONT', interestRate: 10, feePercent: 0, feeFlat: 0, penaltyType: 'NONE', penaltyValue: 0, graceDays: 0 });

  const funds = app.get(FundsService);
  const owner = await funds.create(A, { name: 'Owner capital', sourceType: 'OWNER_CAPITAL', branchId: branch.id });
  await funds.deposit(A, owner.id, { amount: 100_000_000, date: addDays(today, -40), mode: 'BANK', note: 'Opening capital' });
  // Cash for the day's loans comes out of the bank (a contra entry: bank out, cash in).
  const withdrawal = await prisma.expenseCategory.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Bank withdrawal' } });
  const daybook = app.get(DaybookService);
  for (const [direction, mode] of [['OUT', 'BANK'], ['IN', 'CASH']] as const) {
    await daybook.addEntry(A, { branchId: branch.id, date: addDays(today, -13), direction, categoryId: withdrawal.id, amount: 30_000_000, mode, particulars: 'Cash withdrawn from bank', billUrl: null });
  }
  const invFund = await funds.create(A, { name: 'Investor pool', sourceType: 'INVESTOR', branchId: branch.id });
  const investors = app.get(InvestorsService);
  const investor = await investors.save(A, { name: 'Sundaram', phone: '9000000010', address: 'Madurai', bankDetails: 'SBI XXXX1234', nominee: 'Meena' });
  await investors.invest(A, { investorId: investor.id, amount: 50_000_000, date: addDays(today, -40), branchId: branch.id, fundId: invFund.id, mode: 'BANK', returnType: 'FIXED_MONTHLY', returnRate: 1.5, payoutFrequencyMonths: 1 });

  const customers = app.get(CustomersService);
  const names = ['Arun', 'Bala', 'Chitra', 'Deepa', 'Ezhil', 'Fathima', 'Ganesh', 'Hema', 'Ilango', 'Jaya'];
  const created = [];
  for (const [i, name] of names.entries()) {
    const onR1 = i < 6;
    const base = onR1 ? anna : kk;
    created.push(
      await customers.create(A, {
        name,
        phone: `98${String(40000000 + i).padStart(8, '0')}`,
        address: `${i + 1}, ${onR1 ? 'Anna Nagar' : 'KK Nagar'} Street, Madurai`,
        landmark: i % 2 ? 'Near temple' : 'Opposite school',
        lat: base.lat! + (i % 3) * 0.0021 - 0.002,
        lng: base.lng! + Math.floor(i / 3) * 0.0018 - 0.002,
        idType: 'AADHAAR',
        idNumber: `1234 5678 ${String(9000 + i)}`,
        occupation: ['Vegetable vendor', 'Tailor', 'Auto driver', 'Shop owner'][i % 4],
        monthlyIncome: 1_500_000 + i * 100_000,
        language: i % 2 ? 'ta' : 'en',
        locationId: base.id,
        routeId: onR1 ? r1.id : r2.id,
      }),
    );
  }

  const M = ctx(manager.id, tenant.id, 'BRANCH_MANAGER', [branch.id], 2_500_000);
  const O = ctx(officer.id, tenant.id, 'LOAN_OFFICER', [branch.id]);
  const start = addDays(today, -12);
  for (const [i, c] of created.entries()) {
    const product = i < 6 ? daily : weekly;
    const req = await loans.request(O, { customerId: c.id, productId: product.id, principal: i < 6 ? 1_000_000 : 2_000_000, purpose: 'Business' });
    await loans.decide(M, req.id, { decision: 'APPROVE' });
    await loans.disburse(A, req.id, { disbursedOn: start, mode: 'CASH', fundId: i % 2 ? invFund.id : owner.id });
  }
  // A pending request above the manager's limit, waiting for the owner.
  const big = await loans.request(O, { customerId: created[0].id, productId: weekly.id, principal: 3_000_000, purpose: 'Shop expansion' });
  await loans.decide(M, big.id, { decision: 'APPROVE' });

  // Past collections for the daily route (some customers skip days so there are arrears to show).
  const col = app.get(CollectionsService);
  const ag1 = ctx(agent1.id, tenant.id, 'COLLECTION_AGENT', [branch.id]);
  const active = await prisma.loan.findMany({ where: { tenantId: tenant.id, status: 'ACTIVE' }, include: { customer: true, instalments: { orderBy: { seq: 'asc' } } } });
  for (const l of active.filter((x) => x.customer.routeId === r1.id)) {
    for (const ins of l.instalments.filter((x) => x.dueDate < today)) {
      if (l.customer.name === 'Chitra' && ins.seq > 3) continue;
      if (l.customer.name === 'Fathima' && ins.seq % 3 === 0) continue;
      await col.record(ag1, {
        loanId: l.id,
        amount: ins.principalDue + ins.interestDue,
        mode: ins.seq % 4 === 0 ? 'UPI' : 'CASH',
        collectedAt: new Date(`${ins.dueDate}T05:00:00.000Z`).toISOString(),
        lat: l.customer.lat,
        lng: l.customer.lng,
        clientRef: `seed-${l.id}-${ins.seq}`,
      });
    }
  }
  console.log('Demo business created. Logins (password Demo@1234): owner 9000000001, manager 9000000002, officer 9000000003, agents 9000000004 / 9000000005, accountant 9000000006, auditor 9000000007');
  await app.close();

  function ctx(userId: string, tenantId: string, role: RoleCode, branchIds: string[] | null = null, approvalLimit = 0): Ctx {
    return {
      userId,
      tenantId,
      role,
      permissions: new Set(DEFAULT_ROLE_PERMISSIONS[role] as Permission[]),
      branchIds,
      approvalLimit,
      settings: tenantSettingsSchema.parse({}),
      tenantName: 'Demo Finance',
      tenantStatus: 'ACTIVE',
      readOnly: false,
    };
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
