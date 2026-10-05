// End-to-end API tests against a real PostgreSQL database.
// Each run creates its own empty database (localfinance_e2e_<random>) on TEST_DATABASE_SERVER, pushes the schema,
// seeds the demo business, starts the built API, drives it over HTTP, and drops that database at the end.
// Run with `pnpm --filter @localfinance/api test` after a build.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = process.env.TEST_DATABASE_SERVER ?? 'postgresql://postgres:postgres@localhost:5432';
const DB_NAME = `localfinance_e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const DB = `${SERVER}/${DB_NAME}`;
const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, DATABASE_URL: DB, PORT: String(PORT), JWT_SECRET: 'test-secret-0123456789abcdef', SMS_PROVIDER: 'log', SUPER_ADMIN_PHONE: '9000000000', SUPER_ADMIN_PASSWORD: 'ChangeMe@123', UPLOAD_DIR: resolve(root, '.test-uploads') };
const sqlOnServer = (sql) => execSync(`npx prisma db execute --url "${SERVER}/postgres" --stdin`, { cwd: root, input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
let server;

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

async function api(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}
const ok = async (p) => {
  const r = await p;
  assert.ok(r.status < 300, `expected success, got ${r.status}: ${JSON.stringify(r.data)}`);
  return r.data;
};
const login = async (phone, password = 'Demo@1234', extra = {}) => (await ok(api('POST', '/auth/login', { body: { login: phone, password, ...extra } }))).accessToken;

before(async () => {
  sqlOnServer(`CREATE DATABASE ${DB_NAME};`);
  execSync('npx prisma db push --skip-generate', { cwd: root, env, stdio: 'ignore' });
  execSync('node dist/seed.js --demo', { cwd: root, env, stdio: 'ignore' });
  server = spawn('node', ['dist/main.js'], { cwd: root, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not start');
});
after(async () => {
  server?.kill();
  await new Promise((r) => setTimeout(r, 500));
  // Removes only the database this run created.
  sqlOnServer(`DROP DATABASE IF EXISTS ${DB_NAME} WITH (FORCE);`);
});

let owner, manager, officer, agent, accountant, auditor, superAdmin;

describe('auth', () => {
  test('rejects a wrong password and accepts the right one', async () => {
    assert.equal((await api('POST', '/auth/login', { body: { login: '9000000001', password: 'nope-nope' } })).status, 401);
    owner = await login('9000000001');
    manager = await login('9000000002');
    officer = await login('9000000003');
    accountant = await login('9000000006');
    auditor = await login('9000000007');
    superAdmin = await login('9000000000', 'ChangeMe@123');
    const me = await ok(api('GET', '/auth/me', { token: owner }));
    assert.equal(me.role, 'TENANT_ADMIN');
    assert.equal(me.tenant.name, 'Demo Finance');
  });

  test('binds an agent to the first phone and refuses another', async () => {
    agent = await login('9000000004', 'Demo@1234', { deviceId: 'phone-A' });
    const r = await api('POST', '/auth/login', { body: { login: '9000000004', password: 'Demo@1234', deviceId: 'phone-B' } });
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'auth.deviceNotAllowed');
  });

  test('refresh token rotates', async () => {
    const r = await ok(api('POST', '/auth/login', { body: { login: '9000000003', password: 'Demo@1234' } }));
    const r2 = await ok(api('POST', '/auth/refresh', { body: { refreshToken: r.refreshToken } }));
    assert.ok(r2.accessToken);
    assert.equal((await api('POST', '/auth/refresh', { body: { refreshToken: r.refreshToken } })).status, 401);
  });

  test('protects endpoints', async () => {
    assert.equal((await api('GET', '/customers')).status, 401);
    assert.equal((await api('GET', '/funds', { token: agent })).status, 403);
    assert.equal((await api('GET', '/platform/tenants', { token: owner })).status, 403);
  });
});

describe('collections on the phone', () => {
  let routeId, loan, collectionId, collectionPenalty;

  test('agent sees today\'s route with customers in order', async () => {
    const routes = await ok(api('GET', '/routes/mine', { token: agent }));
    assert.equal(routes.length, 1);
    routeId = routes[0].id;
    const day = await ok(api('GET', `/routes/${routeId}/day`, { token: agent }));
    assert.equal(day.customers.length, 6);
    assert.deepEqual(day.customers.map((c) => c.routeSeq), [1, 2, 3, 4, 5, 6]);
    const chitra = day.customers.find((c) => c.name === 'Chitra');
    assert.ok(chitra.loans[0].arrears > 0, 'Chitra skipped payments so has arrears');
    loan = chitra.loans[0];
  });

  test('records a collection once, even when retried', async () => {
    const clientRef = randomUUID();
    const body = { loanId: loan.id, amount: 12000, mode: 'CASH', clientRef, lat: 9.92, lng: 78.14 };
    const r1 = await ok(api('POST', '/collections', { token: agent, body }));
    assert.equal(r1.duplicate, false);
    assert.match(r1.collection.receiptNo, /^R\d+/);
    collectionId = r1.collection.id;
    collectionPenalty = r1.collection.penalty;
    const r2 = await ok(api('POST', '/collections', { token: agent, body }));
    assert.equal(r2.duplicate, true);
    assert.equal(r2.collection.id, r1.collection.id);
  });

  test('UPI is an entry that counts in the total', async () => {
    const r = await ok(api('POST', '/collections', { token: agent, body: { loanId: loan.id, amount: 5000, mode: 'UPI', upiRef: 'UPI123', clientRef: randomUUID() } }));
    assert.equal(r.collection.mode, 'UPI');
    const day = await ok(api('GET', '/me/day', { token: agent }));
    assert.equal(day.total, day.cash + day.upi);
    assert.ok(day.upi >= 5000);
    assert.equal(day.cashInHand, day.cash + day.float);
  });

  test('collection summary splits cash and UPI by day, week and month; agents see only their own', async () => {
    const mine = await ok(api('GET', '/reports/collection-summary?period=DAY', { token: agent }));
    assert.equal(mine.mine, true);
    assert.equal(mine.from, today());
    assert.equal(mine.byAgent.length, 0);
    const day = await ok(api('GET', '/me/day', { token: agent }));
    assert.equal(mine.totals.total, day.total);
    assert.equal(mine.totals.cash, day.cash);
    assert.equal(mine.totals.total, mine.totals.cash + mine.totals.upi + mine.totals.bank);
    // An agent cannot look at someone else's collections by passing an agentId.
    const forced = await ok(api('GET', '/reports/collection-summary?period=DAY&agentId=someone-else', { token: agent }));
    assert.equal(forced.totals.total, mine.totals.total);
    for (const period of ['WEEK', 'MONTH']) {
      const r = await ok(api('GET', `/reports/collection-summary?period=${period}`, { token: manager }));
      assert.equal(r.mine, false);
      assert.ok(r.from <= today() && today() <= r.to);
      assert.equal(r.byDay.reduce((s, d) => s + d.total, 0), r.totals.total);
      assert.equal(r.byAgent.reduce((s, a) => s + a.total, 0), r.totals.total);
      assert.ok(r.totals.total >= mine.totals.total);
    }
  });

  test('refuses more than the balance', async () => {
    const r = await api('POST', '/collections', { token: agent, body: { loanId: loan.id, amount: 99_999_999, mode: 'CASH', clientRef: randomUUID() } });
    assert.equal(r.status, 400);
  });

  test('offline sync applies each item and reports errors per item', async () => {
    const good = randomUUID();
    const r = await ok(api('POST', '/collections/sync', {
      token: agent,
      body: {
        collections: [
          { loanId: loan.id, amount: 1000, mode: 'CASH', clientRef: good, collectedAt: new Date().toISOString() },
          { loanId: 'missing', amount: 1000, mode: 'CASH', clientRef: randomUUID() },
        ],
        visits: [{ customerId: (await ok(api('GET', `/routes/${routeId}/customers`, { token: manager })))[0].id, outcome: 'NOT_HOME', clientRef: randomUUID() }],
      },
    }));
    assert.deepEqual(r.results.map((x) => x.status), ['OK', 'ERROR', 'OK']);
    const again = await ok(api('POST', '/collections/sync', { token: agent, body: { collections: [{ loanId: loan.id, amount: 1000, mode: 'CASH', clientRef: good }] } }));
    assert.equal(again.results[0].status, 'DUPLICATE');
  });

  test('flags a collection far from the customer', async () => {
    const r = await ok(api('POST', '/collections', { token: agent, body: { loanId: loan.id, amount: 100, mode: 'CASH', clientRef: randomUUID(), lat: 13.08, lng: 80.27 } }));
    assert.equal(r.collection.flagged, true);
  });

  test('agent cannot reverse; manager can and the balance comes back', async () => {
    const before = await ok(api('GET', `/loans/${loan.id}`, { token: manager }));
    assert.equal((await api('POST', `/collections/${collectionId}/reverse`, { token: agent, body: { reason: 'mistake' } })).status, 403);
    await ok(api('POST', `/collections/${collectionId}/reverse`, { token: manager, body: { reason: 'Entered twice' } }));
    const afterLoan = await ok(api('GET', `/loans/${loan.id}`, { token: manager }));
    const owed = (p) => p.principalOutstanding + p.interestOutstanding;
    assert.equal(owed(afterLoan.position) - owed(before.position), 12000 - collectionPenalty);
    const last = afterLoan.ledger.at(-1);
    assert.ok(['REVERSAL', 'PENALTY'].includes(last.type));
  });
});

describe('loans', () => {
  let customerId, productId, fundId, loanId;

  test('blocks duplicate customers by phone', async () => {
    const list = await ok(api('GET', '/customers?q=Arun', { token: officer }));
    const c = list.rows[0];
    const locs = await ok(api('GET', '/locations', { token: officer }));
    const r = await api('POST', '/customers', { token: officer, body: { name: 'Arun Copy', phone: c.phone, address: 'Somewhere 1', locationId: locs[0].id } });
    assert.equal(r.status, 409);
  });

  test('history check grades a customer', async () => {
    const list = await ok(api('GET', '/customers?q=Chitra', { token: manager }));
    const h = await ok(api('GET', `/customers/${list.rows[0].id}/history`, { token: manager }));
    assert.ok(h.summary.missed > 0);
    assert.notEqual(h.summary.grade, 'A');
  });

  test('request, approval by limit, escalation to the owner, disbursement', async () => {
    const locs = await ok(api('GET', '/locations', { token: officer }));
    const c = await ok(api('POST', '/customers', { token: officer, body: { name: 'New Person', phone: '9123456780', address: '5 New Street', locationId: locs[0].id, lat: 9.92, lng: 78.14 } }));
    customerId = c.id;
    const products = await ok(api('GET', '/products', { token: officer }));
    productId = products.find((p) => p.frequency === 'MONTHLY').id;
    const preview = await ok(api('POST', '/loans/preview', { token: officer, body: { productId, principal: 3_000_000 } }));
    assert.equal(preview.schedule.length, 12);
    const req = await ok(api('POST', '/loans', { token: officer, body: { customerId, productId, principal: 3_000_000, purpose: 'Shop' } }));
    loanId = req.id;
    assert.equal((await api('POST', `/loans/${loanId}/decision`, { token: officer, body: { decision: 'APPROVE' } })).status, 403);
    const d1 = await ok(api('POST', `/loans/${loanId}/decision`, { token: manager, body: { decision: 'APPROVE' } }));
    assert.equal(d1.escalated, true, '30,000 is above the manager\'s 25,000 limit');
    assert.equal((await api('POST', `/loans/${loanId}/decision`, { token: manager, body: { decision: 'APPROVE' } })).status, 403);
    const queue = await ok(api('GET', '/loans?queue=approvals', { token: owner }));
    assert.ok(queue.rows.some((l) => l.id === loanId));
    await ok(api('POST', `/loans/${loanId}/decision`, { token: owner, body: { decision: 'APPROVE' } }));
    const funds = await ok(api('GET', '/funds', { token: owner }));
    fundId = funds.find((f) => f.sourceType === 'OWNER_CAPITAL').id;
    const before = funds.find((f) => f.id === fundId).balance;
    const loan = await ok(api('POST', `/loans/${loanId}/disburse`, { token: owner, body: { disbursedOn: today(), mode: 'CASH', fundId } }));
    assert.equal(loan.status, 'ACTIVE');
    assert.equal(loan.instalments.length, 12);
    const fundsAfter = await ok(api('GET', '/funds', { token: owner }));
    assert.equal(before - fundsAfter.find((f) => f.id === fundId).balance, loan.netDisbursed);
    assert.equal((await api('POST', `/loans/${loanId}/disburse`, { token: owner, body: { disbursedOn: today(), mode: 'CASH', fundId } })).status, 400);
  });

  test('a fund cannot go below zero', async () => {
    const c = await ok(api('POST', '/customers', { token: officer, body: { name: 'Big Borrower', phone: '9123456781', address: '6 New Street', locationId: (await ok(api('GET', '/locations', { token: officer })))[0].id } }));
    const products = await ok(api('GET', '/products', { token: officer }));
    const big = products.find((p) => p.frequency === 'MONTHLY');
    const empty = await ok(api('POST', '/funds', { token: owner, body: { name: 'Empty fund', sourceType: 'OTHER', branchId: (await ok(api('GET', '/branches', { token: owner })))[0].id } }));
    const req = await ok(api('POST', '/loans', { token: officer, body: { customerId: c.id, productId: big.id, principal: 2_000_000 } }));
    await ok(api('POST', `/loans/${req.id}/decision`, { token: manager, body: { decision: 'APPROVE' } }));
    const r = await api('POST', `/loans/${req.id}/disburse`, { token: owner, body: { disbursedOn: today(), mode: 'CASH', fundId: empty.id } });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'fund.insufficient');
  });

  test('foreclosure needs the exact amount and closes the loan', async () => {
    const l = await ok(api('GET', `/loans/${loanId}`, { token: owner }));
    const wrong = await api('POST', `/loans/${loanId}/foreclose`, { token: owner, body: { date: today(), mode: 'CASH', amount: 1, interestWaived: 0 } });
    assert.equal(wrong.status, 400);
    const waive = l.position.interestOutstanding;
    const amount = l.position.totalOutstanding - waive;
    const r = await ok(api('POST', `/loans/${loanId}/foreclose`, { token: owner, body: { date: today(), mode: 'BANK', amount, interestWaived: waive, reason: 'Early closure' } }));
    assert.equal(r.loan.status, 'FORECLOSED');
    assert.equal(r.loan.ledger.at(-1).balance, 0);
  });
});

describe('day book, handover and day close', () => {
  let branchId;

  test('day book shows automatic and manual entries with balances', async () => {
    branchId = (await ok(api('GET', '/branches', { token: owner })))[0].id;
    const cats = await ok(api('GET', '/daybook/categories', { token: accountant }));
    const rent = cats.find((c) => c.name === 'Rent');
    await ok(api('POST', '/daybook/entries', { token: accountant, body: { branchId, date: today(), direction: 'OUT', categoryId: rent.id, amount: 500_000, mode: 'CASH', particulars: 'Office rent' } }));
    const day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: accountant }));
    assert.ok(day.entries.some((e) => e.systemCategory === 'COLLECTION'));
    assert.ok(day.entries.some((e) => e.particulars === 'Office rent'));
    assert.equal(day.closing.cash + day.closing.bank, day.opening.cash + day.opening.bank + day.receipts - day.payments);
  });

  test('closing waits for cash handover, then locks the day', async () => {
    const blocked = await api('POST', '/daybook/close', { token: owner, body: { branchId, date: today() } });
    assert.equal(blocked.status, 400);
    assert.match(blocked.data.message, /handover/);
    const pending = await ok(api('GET', `/handovers/pending?branchId=${branchId}&date=${today()}`, { token: manager }));
    const karthik = pending.find((p) => p.agentName?.startsWith('Karthik'));
    assert.ok(karthik.expected > 0 && karthik.upi > 0, 'cash and UPI are listed separately');
    for (const p of pending) {
      const short = p === karthik ? 100 : 0;
      const h = await ok(api('POST', '/handovers', { token: manager, body: { agentId: p.agentId, branchId, date: today(), received: p.expected - short } }));
      assert.equal(h.difference, short ? -short : 0);
    }
    await ok(api('POST', '/daybook/close', { token: owner, body: { branchId, date: today() } }));
    const cats = await ok(api('GET', '/daybook/categories', { token: accountant }));
    const late = await api('POST', '/daybook/entries', { token: accountant, body: { branchId, date: today(), direction: 'OUT', categoryId: cats[0].id, amount: 100, mode: 'CASH', particulars: 'Late entry' } });
    assert.equal(late.status, 400);
    assert.equal(late.data.code, 'errors.dayClosed');
    assert.equal((await api('POST', '/daybook/reopen', { token: manager, body: { branchId, date: today() } })).status, 403);
    await ok(api('POST', '/daybook/reopen', { token: owner, body: { branchId, date: today() } }));
    const diffs = await ok(api('GET', `/reports/cash-differences?from=${today()}&to=${today()}`, { token: owner }));
    assert.ok(diffs.some((d) => d.difference === -100));
  });
});

describe('investors and profit and loss', () => {
  test('returns are calculated once per period and paid by the owner only', async () => {
    const t = today();
    const start = t.slice(0, 8) + '01';
    const r1 = await ok(api('POST', '/investors/returns/run', { token: accountant, body: { periodStart: start, periodEnd: t } }));
    assert.ok(r1.total > 0);
    const r2 = await ok(api('POST', '/investors/returns/run', { token: accountant, body: { periodStart: start, periodEnd: t } }));
    assert.equal(r2.total, 0);
    const invs = await ok(api('GET', '/investors', { token: accountant }));
    const detail = await ok(api('GET', `/investors/${invs[0].id}`, { token: accountant }));
    const inv = detail.investments[0];
    const body = { investmentId: inv.id, amount: inv.balanceDue, date: t, mode: 'BANK', kind: 'PAYOUT', fundId: inv.fundId };
    assert.equal((await api('POST', '/investors/payouts', { token: accountant, body })).status, 403);
    const paid = await ok(api('POST', '/investors/payouts', { token: owner, body }));
    assert.equal(paid.balanceDue, 0);
    assert.equal((await api('POST', '/investors/payouts', { token: owner, body: { ...body, amount: 1 } })).status, 400);
  });

  test('P&L adds up and shows investor returns and expenses', async () => {
    const pl = await ok(api('GET', `/reports/profit-loss?from=${today().slice(0, 8)}01&to=${today()}`, { token: auditor }));
    const c = pl.current;
    assert.equal(c.totalIncome, c.interestIncome + c.feeIncome + c.penaltyIncome + c.otherIncome);
    assert.equal(c.netProfit, c.totalIncome - c.investorReturns - c.expenses - c.badDebts);
    assert.ok(c.expenses >= 500_000);
    assert.ok(c.investorReturns > 0);
    assert.ok(pl.months.length >= 1);
  });

  test('every report answers', async () => {
    for (const r of ['daily-collection', 'disbursements', 'outstanding', 'ageing', 'demand-vs-collection', 'agent-performance', 'cash-differences', 'fund-utilisation', 'income', 'closed-loans', 'location-wise', 'investor-statement']) {
      await ok(api('GET', `/reports/${r}?from=2020-01-01&to=${today()}`, { token: owner }));
    }
    const dash = await ok(api('GET', '/dashboard', { token: manager }));
    assert.ok(dash.activeLoans > 0);
    assert.ok(dash.routes.length >= 1);
  });
});

describe('multi-tenancy', () => {
  let otherAdmin, otherTenantId, demoCustomerId;

  test('a new tenant sees none of another tenant\'s data', async () => {
    const t = await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Other Finance', ownerName: 'Other Owner', ownerPhone: '9111111111', ownerPassword: 'Other@1234' } }));
    otherTenantId = t.id;
    otherAdmin = await login('9111111111', 'Other@1234');
    const list = await ok(api('GET', '/customers', { token: otherAdmin }));
    assert.equal(list.total, 0);
    demoCustomerId = (await ok(api('GET', '/customers', { token: owner }))).rows[0].id;
    assert.equal((await api('GET', `/customers/${demoCustomerId}`, { token: otherAdmin })).status, 404);
    const roles = await ok(api('GET', '/roles', { token: otherAdmin }));
    assert.equal(roles.length, 6);
  });

  test('support access is read-only and needs the tenant\'s consent', async () => {
    const demo = (await ok(api('GET', '/auth/me', { token: owner }))).tenant.id;
    assert.equal((await api('GET', '/customers', { token: superAdmin, headers: { 'x-tenant-id': demo } })).status, 403);
    await ok(api('POST', '/settings/support-access', { token: owner, body: { days: 1 } }));
    await ok(api('GET', '/customers', { token: superAdmin, headers: { 'x-tenant-id': demo } }));
    const w = await api('POST', '/branches', { token: superAdmin, headers: { 'x-tenant-id': demo }, body: { name: 'X', code: 'X' } });
    assert.equal(w.status, 403);
  });

  test('a suspended tenant cannot change data', async () => {
    await ok(api('PATCH', `/platform/tenants/${otherTenantId}`, { token: superAdmin, body: { status: 'SUSPENDED' } }));
    const r = await api('POST', '/branches', { token: otherAdmin, body: { name: 'Branch', code: 'B1' } });
    assert.equal(r.status, 403);
    assert.equal(r.data.code, 'errors.tenantSuspended');
    await ok(api('GET', '/customers', { token: otherAdmin }));
  });
});

describe('staff', () => {
  test('force logout ends a session at once', async () => {
    const staff = await ok(api('GET', '/staff', { token: owner }));
    const auditorUser = staff.find((s) => s.phone === '9000000007');
    await ok(api('GET', '/reports/outstanding', { token: auditor }));
    await ok(api('POST', `/staff/${auditorUser.id}/force-logout`, { token: owner }));
    assert.equal((await api('GET', '/reports/outstanding', { token: auditor })).status, 401);
  });

  test('every change is in the audit log', async () => {
    const log = await ok(api('GET', '/audit', { token: owner }));
    const actions = new Set(log.rows.map((r) => r.action));
    for (const a of ['DISBURSE', 'COLLECT', 'REVERSE', 'HANDOVER', 'CLOSE_DAY', 'REOPEN_DAY', 'FORCE_LOGOUT']) assert.ok(actions.has(a), `audit has ${a}`);
  });
});
