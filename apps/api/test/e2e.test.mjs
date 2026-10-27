// End-to-end API tests against a real PostgreSQL database.
// Each run creates its own empty database (localfinance_e2e_<random>) on TEST_DATABASE_SERVER, pushes the schema,
// seeds the demo business, starts the built API, drives it over HTTP, and drops that database at the end.
// Run with `pnpm --filter @localfinance/api test` after a build.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SERVER = process.env.TEST_DATABASE_SERVER ?? 'postgresql://postgres:postgres@localhost:5432';
const DB_NAME = `localfinance_e2e_${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const DB = `${SERVER}/${DB_NAME}`;
const PORT = 4100 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
// A stand-in for the Claude API, so the AI features are tested without a key or network. It records every request.
const CLAUDE_PORT = PORT + 600;
const claudeCalls = [];
let idCardReply = null;
const claude = createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    claudeCalls.push(body);
    const msg = (content, stop = 'end_turn') => ({ id: 'msg_' + claudeCalls.length, type: 'message', role: 'assistant', model: body.model, content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } });
    const props = body.output_config?.format?.schema?.properties ?? {};
    let out;
    if (body.tools?.length) {
      const last = body.messages.at(-1);
      const results = Array.isArray(last.content) ? last.content.filter((b) => b.type === 'tool_result') : [];
      // First turn: look up places and today's figures. Second turn: answer with what the tools returned.
      out = results.length
        ? msg([{ type: 'text', text: 'ANSWER ' + results.map((r) => r.content).join(' | ') }])
        : msg([{ type: 'tool_use', id: 'tu_1', name: 'places', input: {} }, { type: 'tool_use', id: 'tu_2', name: 'dashboard_today', input: {} }], 'tool_use');
    } else if (props.bullets) out = msg([{ type: 'text', text: JSON.stringify({ bullets: ['AI bullet one', 'AI bullet two'] }) }]);
    else if (props.message) out = msg([{ type: 'text', text: JSON.stringify({ message: 'AI reminder text' }) }]);
    else if (props.documentType) out = msg([{ type: 'text', text: JSON.stringify(idCardReply) }]);
    else out = msg([{ type: 'text', text: '{}' }]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(out));
  });
});
const env = { ...process.env, ANTHROPIC_API_KEY: 'test-key', ANTHROPIC_BASE_URL: `http://127.0.0.1:${CLAUDE_PORT}`, DATABASE_URL: DB, PORT: String(PORT), JWT_SECRET: 'test-secret-0123456789abcdef', SMS_PROVIDER: 'log', SUPER_ADMIN_PHONE: '9000000000', SUPER_ADMIN_PASSWORD: 'ChangeMe@123', UPLOAD_DIR: resolve(root, '.test-uploads') };
const sqlOnServer = (sql) => execSync(`npx prisma db execute --url "${SERVER}/postgres" --stdin`, { cwd: root, input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
const sqlOnDb = (sql) => execSync(`npx prisma db execute --url "${DB}" --stdin`, { cwd: root, input: sql, stdio: ['pipe', 'ignore', 'inherit'] });
let server;
// Starts the built API on the test database and waits until it answers.
async function startApi() {
  server = spawn('node', ['dist/main.js'], { cwd: root, env, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(BASE + '/health')).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('API did not start');
}
async function stopApi() {
  if (!server) return;
  await new Promise((r) => {
    server.once('exit', r);
    server.kill();
  });
  server = null;
}

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
  await new Promise((r) => claude.listen(CLAUDE_PORT, '127.0.0.1', r));
  sqlOnServer(`CREATE DATABASE ${DB_NAME};`);
  execSync('npx prisma db push --skip-generate', { cwd: root, env, stdio: 'ignore' });
  execSync('node dist/seed.js --demo', { cwd: root, env, stdio: 'ignore' });
  await startApi();
});
after(async () => {
  await stopApi();
  claude.close();
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

  test('lists one customer\'s collections across loans', async () => {
    const one = await ok(api('GET', `/loans/${loan.id}`, { token: manager }));
    const list = await ok(api('GET', `/collections?customerId=${one.customerId}`, { token: manager }));
    assert.ok(list.rows.length >= 2);
    assert.ok(list.rows.every((r) => r.customerId === one.customerId));
    const none = await ok(api('GET', '/collections?customerId=no-such-customer', { token: manager }));
    assert.equal(none.total, 0);
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

  test('office enters a collection for an agent; an agent cannot enter for someone else', async () => {
    const agentId = (await ok(api('GET', '/auth/me', { token: agent }))).id;
    const r = await ok(api('POST', '/collections', { token: manager, body: { loanId: loan.id, amount: 1000, mode: 'CASH', clientRef: randomUUID(), agentId } }));
    assert.equal(r.collection.agentId, agentId);
    const managerId = (await ok(api('GET', '/auth/me', { token: manager }))).id;
    const denied = await api('POST', '/collections', { token: agent, body: { loanId: loan.id, amount: 1000, mode: 'CASH', clientRef: randomUUID(), agentId: managerId } });
    assert.equal(denied.status, 403);
    const day = await ok(api('GET', `/routes/${routeId}/day?date=${today()}`, { token: manager }));
    const l = day.customers.flatMap((c) => c.loans).find((x) => x.id === loan.id);
    assert.ok(l.instalmentsTotal > 0 && l.maturityDate && l.totalPayable >= l.totalPaid);
  });

  test('daily statement, pending list and line abstract agree with the books', async () => {
    const q = `from=${today().slice(0, 8)}01&to=${today()}`;
    const stmt = await ok(api('GET', `/reports/daily-statement?${q}`, { token: manager }));
    assert.equal(stmt[0].date, today());
    assert.ok(stmt[0].collected > 0 && stmt[0].collected >= stmt[0].cash + stmt[0].upi);
    const pending = await ok(api('GET', `/reports/pending-list?${q}`, { token: manager }));
    assert.ok(pending.length > 0 && pending.every((x) => x.pending > 0 && x.phone));
    const abs = await ok(api('GET', `/reports/line-abstract?${q}`, { token: manager }));
    assert.equal(abs.lines.reduce((s, l) => s + l.balance, 0), stmt[0].loanBalance);
    const sum = (l) => l.reduce((s, b) => s + b.amount, 0);
    assert.equal(abs.book.opening.cash + abs.book.opening.bank + sum(abs.book.receipts), sum(abs.book.payments) + abs.book.closing.cash + abs.book.closing.bank);
    assert.equal(abs.profit, null, 'a manager without P&L access sees no profit');
    assert.ok((await ok(api('GET', `/reports/line-abstract?${q}`, { token: owner }))).profit);
  });

  test('line list, growth and week-day reports agree with the other reports', async () => {
    const m = today().slice(0, 7);
    const q = `from=${m}-01&to=${today()}`;
    const list = await ok(api('GET', `/reports/line-list?routeId=${routeId}&month=${m}`, { token: manager }));
    assert.equal(list.route.id, routeId);
    assert.equal(list.from, `${m}-01`);
    assert.equal(list.days.length, list.totals.daily.length);
    assert.ok(list.days.length >= 28 && list.days[list.days.length - 1].slice(0, 7) === m);
    assert.ok(list.rows.length >= 6, 'every loan on the line is listed');
    const seqs = list.rows.map((r) => r.routeSeq).filter((x) => x != null);
    assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b), 'rows follow the route order');
    for (const r of list.rows) {
      assert.equal(r.daily.length, list.days.length);
      assert.equal(r.total, r.daily.reduce((s, x) => s + x, 0));
    }
    assert.equal(list.totals.total, list.rows.reduce((s, r) => s + r.total, 0));
    assert.equal(list.totals.total, list.totals.daily.reduce((s, x) => s + x, 0));
    const chitra = list.rows.find((r) => r.loanId === loan.id);
    assert.ok(chitra && chitra.daily[list.days.indexOf(today())] >= 12000 + 5000 + 1000, "today's collections are in today's column");
    const abs = await ok(api('GET', `/reports/line-abstract?${q}&routeId=${routeId}`, { token: manager }));
    assert.equal(list.rows.filter((r) => !r.closedOn).reduce((s, r) => s + r.closing, 0), abs.lines.reduce((s, l) => s + l.balance, 0));
    assert.equal((await api('GET', `/reports/line-list?routeId=${routeId}&from=2020-01-01&to=${today()}`, { token: manager })).status, 400);
    assert.equal((await api('GET', `/reports/line-list?routeId=nope&month=${m}`, { token: manager })).status, 404);

    const growth = await ok(api('GET', '/reports/growth', { token: owner }));
    assert.equal(growth.length, 12);
    assert.equal(growth[11].month, m);
    const stmt = await ok(api('GET', `/reports/daily-statement?${q}`, { token: owner }));
    assert.equal(growth[11].outstanding, stmt[0].loanBalance);
    const disb = await ok(api('GET', `/reports/disbursements?from=${growth[0].month}-01&to=${today()}`, { token: owner }));
    assert.equal(growth.reduce((s, g) => s + g.loanAmount, 0), disb.reduce((s, d) => s + d.principal, 0));
    assert.equal(growth.reduce((s, g) => s + g.loans, 0), disb.length);
    assert.equal(growth[11].closingAccounts, (await ok(api('GET', '/dashboard', { token: owner }))).activeLoans);
    assert.ok(growth[11].interest != null);
    const short = await ok(api('GET', `/reports/growth?months=3&routeId=${routeId}`, { token: manager }));
    assert.equal(short.length, 3);
    assert.equal(short[2].interest, null, 'a manager without P&L access sees no income');
    assert.equal((await api('GET', '/reports/growth?months=99', { token: owner })).status, 400);

    const week = await ok(api('GET', `/reports/weekday?${q}`, { token: manager }));
    assert.deepEqual(week.map((w) => w.weekday), [1, 2, 3, 4, 5, 6, 0]);
    const daily = await ok(api('GET', `/reports/daily-collection?${q}`, { token: manager }));
    assert.equal(week.reduce((s, w) => s + w.amount, 0), daily.reduce((s, d) => s + d.collected, 0));
    for (const w of week) {
      assert.equal(w.amount, w.cash + w.upi);
      assert.equal(w.average, w.days ? Math.round(w.amount / w.days) : 0);
    }
    assert.equal(week.reduce((s, w) => s + w.days, 0), Number(today().slice(8)));
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

  test('a processing fee typed for the loan comes off the cash paid out, and the full loan is repaid', async () => {
    const c = await ok(api('POST', '/customers', { token: officer, body: { name: 'Fee Person', phone: '9123456782', address: '7 New Street', locationId: (await ok(api('GET', '/locations', { token: officer })))[0].id } }));
    const product = (await ok(api('GET', '/products', { token: officer }))).find((p) => p.frequency === 'MONTHLY');
    const preview = await ok(api('POST', '/loans/preview', { token: officer, body: { productId: product.id, principal: 2_000_000, processingFee: 20_000 } }));
    assert.equal(preview.summary.fee, 20_000);
    assert.equal(preview.summary.netDisbursed, 2_000_000 - 20_000 - preview.summary.upfrontInterest);
    const req = await ok(api('POST', '/loans', { token: officer, body: { customerId: c.id, productId: product.id, principal: 2_000_000, processingFee: 20_000 } }));
    assert.equal(req.feePercent, 0);
    assert.equal(req.feeFlat, 20_000);
    // A fee bigger than the loan is refused.
    assert.equal((await api('POST', '/loans', { token: officer, body: { customerId: c.id, productId: product.id, principal: 2_000_000, processingFee: 2_000_000 } })).status, 400);
    // Resubmitted without a fee, the fee typed before stays.
    const again = await ok(api('PUT', `/loans/${req.id}`, { token: officer, body: { customerId: c.id, productId: product.id, principal: 2_000_000 } }));
    assert.equal(again.feeFlat, 20_000);
    const byLoan = await ok(api('POST', '/loans/preview', { token: owner, body: { productId: product.id, principal: 2_000_000, loanId: req.id } }));
    assert.equal(byLoan.summary.fee, 20_000);
    await ok(api('POST', `/loans/${req.id}/decision`, { token: manager, body: { decision: 'APPROVE' } }));
    const loan = await ok(api('POST', `/loans/${req.id}/disburse`, { token: owner, body: { disbursedOn: today(), mode: 'CASH', fundId } }));
    assert.equal(loan.fee, 20_000);
    assert.equal(loan.netDisbursed, 2_000_000 - 20_000 - loan.upfrontInterest);
    const repay = loan.instalments.reduce((sum, i) => sum + i.principalDue, 0);
    assert.equal(repay, 2_000_000, 'the customer repays the full loan amount');
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

  let fuelId;

  test('day book shows automatic and manual entries with balances', async () => {
    branchId = (await ok(api('GET', '/branches', { token: owner })))[0].id;
    const cats = await ok(api('GET', '/daybook/categories', { token: manager }));
    const rent = cats.find((c) => c.name === 'Rent');
    await ok(api('POST', '/daybook/entries', { token: manager, body: { branchId, date: today(), direction: 'OUT', categoryId: rent.id, amount: 500_000, mode: 'CASH', particulars: 'Office rent' } }));
    const day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: accountant }));
    assert.ok(day.entries.some((e) => e.systemCategory === 'COLLECTION'));
    assert.ok(day.entries.some((e) => e.particulars === 'Office rent'));
    assert.equal(day.closing.cash + day.closing.bank, day.opening.cash + day.opening.bank + day.receipts - day.payments);
  });

  test('entries from agents and other staff wait for the branch manager before reaching the day book', async () => {
    const cats = await ok(api('GET', '/daybook/categories', { token: agent }));
    const fuel = cats.find((c) => c.name === 'Fuel and travel');
    const stationery = cats.find((c) => c.name === 'Stationery and printing');
    const sent = await ok(api('POST', '/daybook/entries', { token: agent, body: { branchId, date: today(), direction: 'OUT', categoryId: fuel.id, amount: 25_000, mode: 'CASH', particulars: 'Petrol for the route' } }));
    assert.equal(sent.pending, true);
    fuelId = sent.request.id;
    const paper = await ok(api('POST', '/daybook/entries', { token: accountant, body: { branchId, date: today(), direction: 'OUT', categoryId: stationery.id, amount: 12_000, mode: 'CASH', particulars: 'Receipt books' } }));
    assert.equal(paper.pending, true, 'the accountant also needs approval');
    let day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: manager }));
    assert.ok(!day.entries.some((e) => e.particulars === 'Petrol for the route' || e.particulars === 'Receipt books'), 'nothing reaches the day book before approval');

    // The agent sees only their own entries, cannot read the whole day book and cannot decide.
    const mine = await ok(api('GET', '/daybook/requests?status=PENDING', { token: agent }));
    assert.deepEqual(mine.map((r) => r.particulars), ['Petrol for the route']);
    assert.equal((await api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: agent })).status, 403);
    assert.equal((await api('POST', `/daybook/requests/${fuelId}/approve`, { token: agent })).status, 403);
    assert.equal((await api('POST', `/daybook/requests/${paper.request.id}/approve`, { token: accountant })).status, 403);

    // The branch manager sees both, with a count on the dashboard, and approves one.
    const waiting = await ok(api('GET', '/daybook/requests?status=PENDING', { token: manager }));
    assert.equal(waiting.length, 2);
    assert.equal(waiting.find((r) => r.id === fuelId).requestedByName.length > 0, true);
    assert.equal((await ok(api('GET', '/dashboard/actions', { token: manager }))).dayBookApprovals, 2);
    assert.equal((await ok(api('GET', '/dashboard/actions', { token: agent }))).dayBookApprovals, null);
    await ok(api('POST', `/daybook/requests/${paper.request.id}/approve`, { token: manager }));
    assert.equal((await api('POST', `/daybook/requests/${paper.request.id}/approve`, { token: manager })).status, 400, 'cannot be approved twice');
    day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: manager }));
    const posted = day.entries.find((e) => e.particulars === 'Receipt books');
    assert.ok(posted, 'approved entry is in the day book');
    assert.equal(posted.amount, 12_000);
    assert.match(posted.createdByName, /.+/);
    assert.match(posted.approvedByName, /.+/);
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
    // An entry still waiting for the branch manager also holds the day open.
    const waiting = await api('POST', '/daybook/close', { token: owner, body: { branchId, date: today() } });
    assert.equal(waiting.status, 400);
    assert.equal(waiting.data.code, 'errors.daybookApprovalsPending');
    // Rejecting needs a reason; the person who entered it is responsible unless the manager names someone else.
    assert.equal((await api('POST', `/daybook/requests/${fuelId}/reject`, { token: manager, body: { reason: '' } })).status, 400);
    const rejected = await ok(api('POST', `/daybook/requests/${fuelId}/reject`, { token: manager, body: { reason: 'No bill for the petrol' } }));
    assert.equal(rejected.status, 'REJECTED');
    const agentView = await ok(api('GET', '/daybook/requests?status=REJECTED', { token: agent }));
    assert.equal(agentView.length, 1);
    assert.equal(agentView[0].reason, 'No bill for the petrol');
    assert.equal(agentView[0].responsibleId, agentView[0].requestedById);
    assert.match(agentView[0].responsibleName, /.+/);
    assert.match(agentView[0].decidedByName, /.+/);
    await ok(api('POST', '/daybook/close', { token: owner, body: { branchId, date: today() } }));
    const day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: manager }));
    assert.ok(!day.entries.some((e) => e.particulars === 'Petrol for the route'), 'a rejected entry never reaches the day book');
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
    for (const r of ['daily-collection', 'disbursements', 'outstanding', 'ageing', 'demand-vs-collection', 'agent-performance', 'cash-differences', 'fund-utilisation', 'income', 'closed-loans', 'location-wise', 'investor-statement', 'daily-statement', 'pending-list', 'line-abstract', 'growth', 'weekday', 'scheme-wise']) {
      await ok(api('GET', `/reports/${r}?from=2020-01-01&to=${today()}`, { token: owner }));
    }
    // The line list is a month sheet: one month at a time, for one line or all of them.
    await ok(api('GET', `/reports/line-list?month=${today().slice(0, 7)}`, { token: owner }));
    const dash = await ok(api('GET', '/dashboard', { token: manager }));
    assert.ok(dash.activeLoans > 0);
    assert.ok(dash.routes.length >= 1);
  });
});

describe('staff salaries and advances', () => {
  let branchId, agentUser, officerUser, third;
  const month = () => today().slice(0, 7);

  test('built-in roles of a business set up before salaries get the new right once, on start-up', async () => {
    // Make the demo business look as it did before version 2: no salary right anywhere.
    execSync(`npx prisma db execute --url "${DB}" --stdin`, {
      cwd: root,
      input: `UPDATE "Role" SET "permissions" = array_remove("permissions", 'salary.manage'), "permsVersion" = 1 WHERE "tenantId" IS NOT NULL;`,
      stdio: ['pipe', 'ignore', 'inherit'],
    });
    assert.ok(!(await ok(api('GET', '/auth/me', { token: accountant }))).permissions.includes('salary.manage'));
    server.kill();
    await new Promise((r) => server.once('exit', r));
    server = spawn('node', ['dist/main.js'], { cwd: root, env, stdio: 'ignore' });
    for (let i = 0; i < 60 && !(await fetch(BASE + '/health').then((r) => r.ok, () => false)); i++) await new Promise((r) => setTimeout(r, 250));
    assert.ok((await ok(api('GET', '/auth/me', { token: accountant }))).permissions.includes('salary.manage'));
    assert.ok((await ok(api('GET', '/auth/me', { token: owner }))).permissions.includes('salary.manage'));
    for (const token of [agent, manager, officer, auditor]) assert.ok(!(await ok(api('GET', '/auth/me', { token }))).permissions.includes('salary.manage'));
  });

  test('agents, loan officers and branch managers cannot see or pay salaries; the owner and accountant can', async () => {
    branchId = (await ok(api('GET', '/branches', { token: owner })))[0].id;
    const staff = await ok(api('GET', '/staff', { token: owner }));
    agentUser = staff.find((s) => s.phone === '9000000004');
    officerUser = staff.find((s) => s.phone === '9000000003');
    for (const token of [agent, officer, manager, auditor]) {
      assert.equal((await api('GET', '/salaries', { token })).status, 403);
      assert.equal((await api('PUT', `/salaries/staff/${agentUser.id}`, { token, body: { amount: 100 } })).status, 403);
      assert.equal((await api('POST', '/salaries/advances', { token, body: { userId: agentUser.id, branchId, date: today(), amount: 100, mode: 'CASH' } })).status, 403);
      assert.equal((await api('POST', '/salaries/payments', { token, body: { userId: agentUser.id, branchId, month: month(), date: today(), mode: 'CASH' } })).status, 403);
    }
    const me = await ok(api('GET', '/auth/me', { token: accountant }));
    assert.ok(me.permissions.includes('salary.manage'), 'the accountant has the new right by default');
    assert.ok(!(await ok(api('GET', '/auth/me', { token: agent }))).permissions.includes('salary.manage'));
    const list = await ok(api('GET', `/salaries?month=${month()}`, { token: accountant }));
    assert.ok(list.rows.some((r) => r.userId === agentUser.id));
    await ok(api('GET', '/salaries', { token: owner }));
  });

  test('a month is paid once, net of advances, through the day book', async () => {
    await ok(api('PUT', `/salaries/staff/${agentUser.id}`, { token: accountant, body: { amount: 1_200_000 } }));
    // Nothing can be paid before a salary is set.
    const none = await api('POST', '/salaries/payments', { token: accountant, body: { userId: officerUser.id, branchId, month: month(), date: today(), mode: 'CASH' } });
    assert.equal(none.status, 400);
    await ok(api('POST', '/salaries/advances', { token: accountant, body: { userId: agentUser.id, branchId, date: today(), amount: 300_000, mode: 'CASH', note: 'Festival' } }));
    let list = await ok(api('GET', `/salaries?month=${month()}`, { token: accountant }));
    let row = list.rows.find((r) => r.userId === agentUser.id);
    assert.equal(row.status, 'UNPAID');
    assert.equal(row.salary, 1_200_000);
    assert.equal(row.advancesThisMonth, 300_000);
    assert.equal(row.advanceOutstanding, 300_000);
    assert.equal(row.netDue, 900_000);

    const body = { userId: agentUser.id, branchId, month: month(), date: today(), mode: 'CASH' };
    assert.equal((await api('POST', '/salaries/payments', { token: accountant, body: { ...body, advanceDeduct: 300_001 } })).status, 400, 'cannot take back more than was advanced');
    const next = new Date(Date.UTC(Number(month().slice(0, 4)), Number(month().slice(5, 7)), 1)).toISOString().slice(0, 7);
    assert.equal((await api('POST', '/salaries/payments', { token: accountant, body: { ...body, month: next } })).status, 400, 'a future month cannot be paid');
    const paid = await ok(api('POST', '/salaries/payments', { token: accountant, body }));
    assert.equal(paid.gross, 1_200_000);
    assert.equal(paid.advanceDeducted, 300_000);
    assert.equal(paid.net, 900_000);
    assert.equal((await api('POST', '/salaries/payments', { token: owner, body })).status, 409, 'the same month cannot be paid twice');

    list = await ok(api('GET', `/salaries?month=${month()}`, { token: owner }));
    row = list.rows.find((r) => r.userId === agentUser.id);
    assert.equal(row.status, 'PAID');
    assert.equal(row.advanceOutstanding, 0);
    assert.equal(row.payment.net, 900_000);
    assert.ok(list.totals.paid >= 900_000);

    const day = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: accountant }));
    const lines = day.entries.filter((e) => e.refType === 'SalaryAdvance' || e.refType === 'SalaryPayment');
    assert.deepEqual(lines.map((e) => [e.direction, e.amount, e.categoryName]).sort(), [['OUT', 300_000, 'Salary'], ['OUT', 900_000, 'Salary']]);
    assert.equal(day.closing.cash + day.closing.bank, day.opening.cash + day.opening.bank + day.receipts - day.payments);

    const history = await ok(api('GET', `/salaries/staff/${agentUser.id}`, { token: accountant }));
    assert.equal(history.payments.length, 1);
    assert.equal(history.advances.length, 1);
    // Advance and payment together are the month's salary in profit and loss.
    const pl = await ok(api('GET', `/reports/profit-loss?from=${today()}&to=${today()}`, { token: owner }));
    assert.ok(pl.current.expenseBreakdown.find((r) => r.category === 'Salary').amount >= 1_200_000);
    const log = await ok(api('GET', '/audit?entity=SalaryPayment', { token: owner }));
    assert.ok(log.rows.some((r) => r.action === 'PAY_SALARY'));
  });

  test("another business can neither see nor pay this business's staff", async () => {
    await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Salary Isolation Finance', ownerName: 'Fourth Owner', ownerPhone: '9333333333', ownerPassword: 'Fourth@1234' } }));
    third = await login('9333333333', 'Fourth@1234');
    const ownBranch = await ok(api('POST', '/branches', { token: third, body: { name: 'Fourth Main', code: 'FM' } }));
    const list = await ok(api('GET', '/salaries', { token: third }));
    assert.ok(!list.rows.some((r) => r.userId === agentUser.id));
    assert.equal(list.totals.paid, 0);
    assert.equal(list.totals.advanceOutstanding, 0);
    assert.equal((await api('GET', `/salaries/staff/${agentUser.id}`, { token: third })).status, 404);
    assert.equal((await api('PUT', `/salaries/staff/${agentUser.id}`, { token: third, body: { amount: 1 } })).status, 404);
    assert.equal((await api('POST', '/salaries/advances', { token: third, body: { userId: agentUser.id, branchId: ownBranch.id, date: today(), amount: 100, mode: 'CASH' } })).status, 404);
    assert.equal((await api('POST', '/salaries/payments', { token: third, body: { userId: agentUser.id, branchId: ownBranch.id, month: today().slice(0, 7), date: today(), mode: 'CASH' } })).status, 404);
    // Its own owner paying into the demo branch is refused too.
    const thirdOwner = (await ok(api('GET', '/staff', { token: third })))[0] ?? (await ok(api('GET', '/auth/me', { token: third })));
    await ok(api('PUT', `/salaries/staff/${thirdOwner.id}`, { token: third, body: { amount: 500_000 } }));
    assert.equal((await api('POST', '/salaries/advances', { token: third, body: { userId: thirdOwner.id, branchId, date: today(), amount: 100, mode: 'CASH' } })).status, 404);
    const backup = await ok(api('GET', '/settings/backup', { token: third }));
    assert.equal(backup.tables.SalaryPayment.length, 0);
    assert.equal(backup.tables.SalaryAdvance.length, 0);
    assert.ok((await ok(api('GET', '/settings/backup', { token: owner }))).tables.SalaryPayment.length >= 1);
  });
});

describe('plan, support and receipt SMS', () => {
  test('only the Super Admin edits support settings; every logged-in user can read them', async () => {
    const settings = {
      supportPhone: '+91 98765 43210',
      supportEmail: 'help@wits.example',
      supportHours: 'Mon to Sat, 9 am to 6 pm',
      helpVideos: [
        { title: 'Recording a collection', language: 'en', url: 'https://www.youtube.com/watch?v=abc123' },
        { title: 'வசூல் பதிவு செய்வது', language: 'ta', url: 'https://youtu.be/xyz789' },
      ],
      upiId: 'wits@okaxis',
      upiName: 'WITS Software',
      yearlyPrice: 1_200_000,
    };
    for (const token of [owner, accountant, agent]) {
      assert.equal((await api('PUT', '/platform/settings', { token, body: settings })).status, 403);
      assert.equal((await api('GET', '/platform/settings', { token })).status, 403);
    }
    assert.equal((await api('PUT', '/platform/settings', { token: superAdmin, body: { ...settings, helpVideos: [{ title: 'Bad', language: 'en', url: 'https://example.com/v' }] } })).status, 400, 'only YouTube links');
    assert.equal((await api('PUT', '/platform/settings', { token: superAdmin, body: { ...settings, upiId: 'not a upi id' } })).status, 400);
    await ok(api('PUT', '/platform/settings', { token: superAdmin, body: settings }));
    assert.deepEqual(await ok(api('GET', '/platform/settings', { token: superAdmin })), settings);
    const support = await ok(api('GET', '/support', { token: agent }));
    assert.equal(support.supportPhone, settings.supportPhone);
    assert.equal(support.helpVideos.length, 2);
    assert.equal(support.upiId, undefined, 'the renewal details are only on the plan screen');
    await ok(api('GET', '/support', { token: superAdmin }));
    assert.equal((await api('GET', '/support')).status, 401);
  });

  test('the owner sees days left, the price and a UPI link; nobody else does', async () => {
    const demo = (await ok(api('GET', '/auth/me', { token: owner }))).tenant.id;
    const day = (n) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
    assert.equal((await api('PATCH', `/platform/tenants/${demo}`, { token: superAdmin, body: { planExpiresOn: '2026-02-30' } })).status, 400);
    assert.equal((await api('PATCH', `/platform/tenants/${demo}`, { token: owner, body: { planExpiresOn: day(400) } })).status, 403);
    await ok(api('PATCH', `/platform/tenants/${demo}`, { token: superAdmin, body: { planExpiresOn: day(10) } }));
    const plan = await ok(api('GET', '/plan', { token: owner }));
    assert.equal(plan.planExpiresOn, day(10));
    assert.equal(plan.daysLeft, 10);
    assert.equal(plan.expiringSoon, true);
    assert.equal(plan.yearlyPrice, 1_200_000);
    assert.equal(plan.upiId, 'wits@okaxis');
    assert.match(plan.upiLink, /^upi:\/\/pay\?pa=wits@okaxis&pn=WITS%20Software&am=12000\.00&cu=INR&tn=/);
    for (const token of [agent, manager, accountant, officer, auditor, superAdmin]) assert.equal((await api('GET', '/plan', { token })).status, 403);
    await ok(api('PATCH', `/platform/tenants/${demo}`, { token: superAdmin, body: { planExpiresOn: day(40) } }));
    assert.equal((await ok(api('GET', '/plan', { token: owner }))).expiringSoon, false);
    assert.equal((await ok(api('GET', '/platform/tenants', { token: superAdmin }))).find((t) => t.id === demo).planExpiresOn, day(40));
    // Another business's owner sees only their own plan.
    const third = await login('9333333333', 'Fourth@1234');
    const theirs = await ok(api('GET', '/plan', { token: third }));
    assert.equal(theirs.planExpiresOn, null);
    assert.equal(theirs.daysLeft, null);
  });

  test('the receipt SMS shows arrears and balance unless the business turns them off', async () => {
    const s = (await ok(api('GET', '/settings', { token: owner }))).settings;
    assert.equal(s.smsShowArrears, true);
    assert.equal(s.smsShowBalance, true);
    const loans = (await ok(api('GET', '/loans?status=ACTIVE', { token: owner }))).rows;
    const cols = (await ok(api('GET', `/collections?from=2020-01-01&to=${today()}`, { token: owner }))).rows.filter((c) => !c.reversedAt);
    const late = cols.find((c) => loans.find((l) => l.id === c.loanId)?.position?.overdue > 0);
    assert.ok(late, 'the demo data has a customer in arrears');
    const resend = async () => (await ok(api('POST', `/collections/${late.id}/resend-receipt`, { token: owner }))).body;
    // Customers get the SMS in their own language.
    const ARREARS = /(Arrears|நிலுவை) ₹[\d,]+\.\d\d\./;
    const BALANCE = /(Balance|மீதி) ₹[\d,]+\.\d\d\./;
    let sms = await resend();
    assert.match(sms, ARREARS);
    assert.match(sms, BALANCE);
    await ok(api('PUT', '/settings', { token: owner, body: { settings: { smsShowBalance: false } } }));
    sms = await resend();
    assert.match(sms, ARREARS);
    assert.doesNotMatch(sms, BALANCE);
    await ok(api('PUT', '/settings', { token: owner, body: { settings: { smsShowArrears: false } } }));
    sms = await resend();
    assert.doesNotMatch(sms, ARREARS);
    assert.doesNotMatch(sms, BALANCE);
    assert.match(sms, /(Receipt|ரசீது) R\d+/);
    // The other business's switches are its own.
    const third = await login('9333333333', 'Fourth@1234');
    assert.equal((await ok(api('GET', '/settings', { token: third }))).settings.smsShowBalance, true);
    await ok(api('PUT', '/settings', { token: owner, body: { settings: { smsShowArrears: true, smsShowBalance: true } } }));
    sms = await resend();
    assert.ok(sms.search(ARREARS) < sms.search(BALANCE) && sms.search(ARREARS) > 0);
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

  test('a business cannot touch, link to or message another business\'s records', async () => {
    const demoBranch = (await ok(api('GET', '/branches', { token: owner })))[0];
    const demoCollection = (await ok(api('GET', `/collections?from=2020-01-01&to=${today()}`, { token: owner }))).rows[0];
    const demoAgent = (await ok(api('GET', '/staff', { token: owner }))).find((s) => s.phone === '9000000004');
    const demoLoan = (await ok(api('GET', '/loans', { token: owner }))).rows[0];
    const demoInvestor = (await ok(api('GET', '/investors', { token: owner })))[0];
    const own = (await ok(api('GET', '/branches', { token: otherAdmin })))[0] ?? (await ok(api('POST', '/branches', { token: otherAdmin, body: { name: 'Other Main', code: 'OM' } })));
    const cat = (await ok(api('GET', '/daybook/categories', { token: otherAdmin })))[0];
    const refused = async (method, path, body) => {
      const r = await api(method, path, { token: otherAdmin, body });
      assert.ok(r.status >= 400, `${method} ${path} should be refused, got ${r.status}: ${JSON.stringify(r.data).slice(0, 200)}`);
    };
    // Resending a receipt would text the other business's customer.
    await refused('POST', `/collections/${demoCollection.id}/resend-receipt`, {});
    // Day book lines and day close in another business's branch would shift its balances or lock its day.
    await refused('POST', '/daybook/entries', { branchId: demoBranch.id, date: today(), direction: 'OUT', categoryId: cat.id, amount: 100, mode: 'CASH', particulars: 'probe' });
    await refused('POST', '/daybook/close', { branchId: demoBranch.id, date: today() });
    await refused('POST', '/daybook/reopen', { branchId: demoBranch.id, date: today() });
    // Another business's day book entries waiting for approval can be neither seen nor decided.
    const demoRequests = await ok(api('GET', '/daybook/requests', { token: owner }));
    assert.ok(demoRequests.length > 0);
    assert.equal((await ok(api('GET', '/daybook/requests', { token: otherAdmin }))).length, 0);
    await refused('POST', `/daybook/requests/${demoRequests[0].id}/approve`, {});
    await refused('POST', `/daybook/requests/${demoRequests[0].id}/reject`, { reason: 'probe reason' });
    // Links from this business's rows to the other business's people and records.
    await refused('POST', '/branches', { name: 'Linked', code: 'LK', managerId: demoAgent.id });
    await refused('PUT', `/branches/${own.id}`, { name: own.name, code: own.code, managerId: demoAgent.id });
    if (demoInvestor) await refused('POST', '/funds', { name: 'Linked fund', sourceType: 'INVESTOR', branchId: own.id, investorId: demoInvestor.id });
    const fd = new FormData();
    fd.append('file', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'a.pdf');
    fd.append('loanId', demoLoan.id);
    const up = await fetch(BASE + '/files', { method: 'POST', headers: { authorization: `Bearer ${otherAdmin}` }, body: fd });
    assert.equal(up.status, 404);
    // A token in the address is only for opening files.
    assert.equal((await api('GET', `/customers?access_token=${otherAdmin}`)).status, 401);
  });

  test('action counts and setup status stay inside the tenant', async () => {
    // A promise to pay today from a customer who has not paid today counts as missed for the agent and the owner.
    const route = (await ok(api('GET', '/routes/mine', { token: agent })))[0];
    const day = await ok(api('GET', `/routes/${route.id}/day`, { token: agent }));
    const unpaid = day.customers.find((c) => c.paidToday === 0);
    await ok(api('POST', '/visits', { token: agent, body: { customerId: unpaid.id, outcome: 'PROMISED', promiseDate: today(), clientRef: randomUUID() } }));
    const mine = await ok(api('GET', '/dashboard/actions', { token: owner }));
    assert.ok(mine.toDisburse >= 1, 'the loan approved in the fund test still waits for disbursal');
    assert.ok(mine.missedPromises >= 1);
    assert.equal(typeof mine.pendingApprovals, 'number');
    assert.equal(typeof mine.handovers.count, 'number');
    const own = await ok(api('GET', '/dashboard/actions', { token: agent }));
    assert.ok(own.missedPromises >= 1);
    assert.equal(own.pendingApprovals, null, 'an agent cannot approve, so gets no approvals count');
    assert.equal(own.handovers, null);

    const demoBranch = (await ok(api('GET', '/branches', { token: owner })))[0].id;
    for (const q of ['', `?branchId=${demoBranch}`]) {
      const other = await ok(api('GET', `/dashboard/actions${q}`, { token: otherAdmin }));
      assert.equal(other.pendingApprovals, 0);
      assert.equal(other.toDisburse, 0);
      assert.equal(other.handovers.count, 0);
      assert.equal(other.dayBooks.count, 0);
      assert.equal(other.flaggedCollections, 0);
      assert.equal(other.missedPromises, 0);
    }

    const setup = await ok(api('GET', '/dashboard/setup', { token: otherAdmin }));
    // The other business has only the one branch it made in the test above; nothing of the demo business is counted.
    const ownBranches = (await ok(api('GET', '/branches', { token: otherAdmin }))).length;
    assert.deepEqual(Object.values(setup), [ownBranches, 0, 0, 0, 0, 0, 0]);
    const demoSetup = await ok(api('GET', '/dashboard/setup', { token: owner }));
    assert.ok(demoSetup.branches > 0 && demoSetup.agents > 0 && demoSetup.fundedFunds > 0);
    assert.equal((await api('GET', '/dashboard/setup', { token: agent })).status, 403);
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

describe('switch business', () => {
  let twinId;

  test('a phone in two businesses lists the other one and switches with that account\'s password', async () => {
    // The demo owner's phone also owns a second business, with a different password.
    twinId = (await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Twin Finance', ownerName: 'Twin Owner', ownerPhone: '9000000001', ownerPassword: 'Twin@1234' } }))).id;
    const demo = (await ok(api('GET', '/auth/me', { token: owner }))).tenant.id;
    const list = await ok(api('GET', '/auth/businesses', { token: owner }));
    assert.deepEqual(list, [{ tenantId: twinId, name: 'Twin Finance' }]);
    const r = await ok(api('POST', '/auth/switch', { token: owner, body: { tenantId: twinId, password: 'Twin@1234' } }));
    assert.ok(r.accessToken && r.refreshToken);
    assert.equal(r.profile.tenant.id, twinId);
    // The new tokens belong to the other business only.
    const me = await ok(api('GET', '/auth/me', { token: r.accessToken }));
    assert.equal(me.tenant.name, 'Twin Finance');
    assert.equal((await ok(api('GET', '/customers', { token: r.accessToken }))).total, 0);
    const demoCustomer = (await ok(api('GET', '/customers', { token: owner }))).rows[0].id;
    assert.equal((await api('GET', `/customers/${demoCustomer}`, { token: r.accessToken })).status, 404);
    // And the way back is listed from the other side.
    assert.deepEqual(await ok(api('GET', '/auth/businesses', { token: r.accessToken })), [{ tenantId: demo, name: 'Demo Finance' }]);
    await ok(api('POST', '/auth/refresh', { body: { refreshToken: r.refreshToken } }));
  });

  test('a wrong password, or a business the phone has no account in, is refused the same way', async () => {
    const wrong = await api('POST', '/auth/switch', { token: owner, body: { tenantId: twinId, password: 'Demo@1234' } });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.data.code, 'auth.invalid');
    assert.ok(!wrong.data.accessToken);
    // "Other Finance" exists, but this phone has no account there: same answer, nothing about it is shown.
    const others = await ok(api('GET', '/platform/tenants', { token: superAdmin }));
    const stranger = others.find((t) => t.name === 'Other Finance');
    const r = await api('POST', '/auth/switch', { token: owner, body: { tenantId: stranger.id, password: 'Other@1234' } });
    assert.equal(r.status, 401);
    assert.equal(r.data.code, 'auth.invalid');
    assert.ok(!JSON.stringify(r.data).includes('Other Finance'));
    // Login with the demo password still opens only the demo business.
    const again = await ok(api('POST', '/auth/login', { body: { login: '9000000001', password: 'Demo@1234' } }));
    assert.equal(again.profile.tenant.name, 'Demo Finance');
  });

  test('a phone with only one business sees no other business and cannot switch', async () => {
    assert.deepEqual(await ok(api('GET', '/auth/businesses', { token: officer })), []);
    const r = await api('POST', '/auth/switch', { token: officer, body: { tenantId: twinId, password: 'Twin@1234' } });
    assert.equal(r.status, 401);
    assert.deepEqual(await ok(api('GET', '/auth/businesses', { token: superAdmin })), []);
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

  test('scheme-wise report matches outstanding; owner can download a backup without passwords', async () => {
    const schemes = await ok(api('GET', `/reports/scheme-wise?from=2020-01-01&to=${today()}`, { token: owner }));
    const out = await ok(api('GET', `/reports/outstanding?to=${today()}`, { token: owner }));
    assert.equal(schemes.reduce((s, r) => s + r.activeLoans, 0), out.length);
    assert.equal(schemes.reduce((s, r) => s + r.totalOutstanding, 0), out.reduce((s, r) => s + r.totalOutstanding, 0));
    const backup = await ok(api('GET', '/settings/backup', { token: owner }));
    assert.equal(backup.format, 'localfinance-backup');
    assert.ok(backup.tables.Loan.length > 0 && backup.tables.Collection.length > 0);
    assert.ok(!JSON.stringify(backup).includes('passwordHash'));
    assert.equal((await api('GET', '/settings/backup', { token: manager })).status, 403);
  });

  test('every change is in the audit log', async () => {
    const log = await ok(api('GET', '/audit', { token: owner }));
    const actions = new Set(log.rows.map((r) => r.action));
    for (const a of ['DISBURSE', 'COLLECT', 'REVERSE', 'HANDOVER', 'CLOSE_DAY', 'REOPEN_DAY', 'FORCE_LOGOUT']) assert.ok(actions.has(a), `audit has ${a}`);
  });
});

describe('import from the old system', () => {
  const day = (n) => new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const ddmmyyyy = (d) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  const serial = (d) => Math.round((Date.parse(`${d}T00:00:00Z`) - Date.UTC(1899, 11, 30)) / 86_400_000);
  let body, before, arun;

  test('preview catches bad rows and writes nothing', async () => {
    const routes = await ok(api('GET', '/routes', { token: owner }));
    const daily = routes.find((r) => r.name === 'Anna Nagar Daily 1');
    const products = await ok(api('GET', '/products', { token: owner }));
    const product = products.find((p) => p.frequency === 'DAILY' && p.interestMethod === 'FLAT');
    arun = (await ok(api('GET', '/customers?q=Arun', { token: owner }))).rows[0];
    const rows = [
      { rowNo: 2, accountNo: 'OLD-101', name: 'Murugesan', nameTamil: 'முருகேசன்', phone: '98765 43210', loanAmount: '10,000', totalPayable: 12000, loanDate: ddmmyyyy(day(-30)), instalment: 120, received: '3,600', balance: 8400 },
      { rowNo: 3, accountNo: 'OLD-102', name: 'வள்ளி', phone: '+91 98765 43211', line: 'KK Nagar Weekly', loanAmount: 20000, totalPayable: 24000, loanDate: serial(day(-20)), instalment: 240, balance: '15,000' },
      { rowNo: 4, accountNo: 'OLD-103', name: 'Arun', phone: arun.phone, loanAmount: 5000, totalPayable: 6000, loanDate: day(-10), instalment: 60, received: 0 },
      { rowNo: 5, accountNo: 'OLD-104', name: 'No Phone', loanAmount: 5000, loanDate: day(-5) },
      { rowNo: 6, accountNo: 'OLD-105', name: 'Bad Date', phone: '9876500005', loanAmount: 5000, loanDate: 'yesterday' },
      { rowNo: 7, accountNo: 'OLD-106', name: 'Bad Line', phone: '9876500006', line: 'Nowhere', loanAmount: 5000, loanDate: day(-5) },
      { rowNo: 8, accountNo: 'OLD-107', name: 'Mismatch', phone: '9876500007', loanAmount: 5000, totalPayable: 6000, received: 1000, balance: 1000, loanDate: day(-5) },
      { rowNo: 9, accountNo: 'OLD-101', name: 'Twice', phone: '9876500008', loanAmount: 5000, loanDate: day(-5) },
    ];
    body = { routeId: daily.id, productId: product.id, rows, fileName: 'old.xlsx' };
    assert.equal((await api('POST', '/imports/preview', { token: manager, body })).status, 403);
    const custBefore = (await ok(api('GET', '/customers', { token: owner }))).total;
    const p = await ok(api('POST', '/imports/preview', { token: owner, body }));
    const st = Object.fromEntries(p.rows.map((r) => [r.rowNo, r]));
    assert.equal(st[2].status, 'NEW');
    assert.equal(st[2].tenure, 100);
    assert.equal(st[3].status, 'NEW');
    assert.equal(st[3].line, 'KK Nagar Weekly');
    assert.equal(st[3].paid, 900_000);
    assert.equal(st[4].customer.action, 'REUSE');
    assert.equal(st[5].errors[0].code, 'required');
    assert.equal(st[6].errors[0].code, 'badDate');
    assert.equal(st[7].errors[0].code, 'lineNotFound');
    assert.equal(st[8].errors[0].code, 'paidMismatch');
    assert.equal(st[9].errors[0].code, 'duplicateInFile');
    assert.deepEqual([p.summary.newLoans, p.summary.newCustomers, p.summary.reusedCustomers, p.summary.errors], [3, 2, 1, 5]);
    assert.equal((await ok(api('GET', '/customers', { token: owner }))).total, custBefore);
  });

  test('import refuses rows with errors unless told to skip them, then creates customers and loans', async () => {
    const r = await api('POST', '/imports/run', { token: owner, body });
    assert.equal(r.status, 400);
    assert.equal(r.data.code, 'import.hasErrors');
    before = {
      dash: await ok(api('GET', '/dashboard', { token: owner })),
      day: await ok(api('GET', `/reports/daily-collection?from=${today()}&to=${today()}`, { token: owner })),
      custs: (await ok(api('GET', '/customers', { token: owner }))).total,
      audit: (await ok(api('GET', '/audit', { token: owner }))).rows.filter((x) => x.action === 'IMPORT').length,
    };
    const res = await ok(api('POST', '/imports/run', { token: owner, body: { ...body, skipErrors: true } }));
    assert.equal(res.summary.imported, 3);
    assert.equal((await ok(api('GET', '/customers', { token: owner }))).total, before.custs + 2);
    const audit = (await ok(api('GET', '/audit', { token: owner }))).rows.filter((x) => x.action === 'IMPORT').length;
    assert.equal(audit, before.audit + 1);
  });

  test('running it again does not duplicate', async () => {
    const res = await ok(api('POST', '/imports/run', { token: owner, body: { ...body, skipErrors: true } }));
    assert.equal(res.summary.imported, 0);
    assert.equal(res.summary.existing, 4, 'the repeated account number in the file now matches the imported loan too');
    assert.equal((await ok(api('GET', '/customers', { token: owner }))).total, before.custs + 2);
    const found = await ok(api('GET', '/loans?q=OLD-101', { token: owner }));
    assert.equal(found.total, 1);
  });

  test('imported loans carry the given balance and the old account number', async () => {
    const list = await ok(api('GET', '/loans?q=OLD-101', { token: owner }));
    const loan = await ok(api('GET', `/loans/${list.rows[0].id}`, { token: owner }));
    assert.equal(loan.status, 'ACTIVE');
    assert.equal(loan.legacyNo, 'OLD-101');
    assert.equal(loan.migrated, true);
    assert.equal(loan.position.totalOutstanding, 840_000);
    assert.equal(loan.position.penaltyOutstanding, 0);
    assert.equal(loan.instalments.length, 100);
    assert.equal(loan.instalments.reduce((s, i) => s + i.principalDue + i.interestDue, 0), 1_200_000);
    assert.equal(loan.instalments.reduce((s, i) => s + i.principalDue, 0), 1_000_000);
    assert.equal(loan.ledger.at(-1).balance, 840_000);
    assert.equal(loan.collections.length, 0);
    assert.equal(loan.customer.name, 'Murugesan (முருகேசன்)');
    const second = await ok(api('GET', `/loans/${(await ok(api('GET', '/loans?q=OLD-102', { token: owner }))).rows[0].id}`, { token: owner }));
    assert.equal(second.position.totalOutstanding, 1_500_000);
    assert.equal(second.customer.phone, '9876543211');
    // The office desk finds it by the old number on the route day screen.
    const routeDay = await ok(api('GET', `/routes/${body.routeId}/day`, { token: owner }));
    const l = routeDay.customers.flatMap((c) => c.loans).find((x) => x.legacyNo === 'OLD-101');
    assert.equal(l.outstanding, 840_000);
    assert.equal(l.totalPaid, 360_000);
    const arunLoans = await ok(api('GET', `/loans?customerId=${arun.id}`, { token: owner }));
    assert.ok(arunLoans.rows.some((x) => x.legacyNo === 'OLD-103'));
  });

  test("today's collections, disbursements and cash are unaffected; outstanding includes the balances", async () => {
    const dash = await ok(api('GET', '/dashboard', { token: owner }));
    assert.equal(dash.collectedToday, before.dash.collectedToday);
    assert.equal(dash.disbursedToday, before.dash.disbursedToday);
    assert.equal(dash.newLoans, before.dash.newLoans);
    assert.equal(dash.portfolio, before.dash.portfolio + 840_000 + 1_500_000 + 600_000);
    const dayCol = await ok(api('GET', `/reports/daily-collection?from=${today()}&to=${today()}`, { token: owner }));
    const collected = (rows) => rows.reduce((s, r) => s + r.collected, 0);
    assert.equal(collected(dayCol), collected(before.day));
    // The imported loans do have instalments due today, so today's demand grows.
    assert.ok(dayCol.reduce((s, r) => s + r.due, 0) > before.day.reduce((s, r) => s + r.due, 0));
    const stmt = await ok(api('GET', `/reports/daily-statement?from=${today()}&to=${today()}`, { token: owner }));
    assert.equal(stmt[0].loans, 0 + before.dash.newLoans);
    const branchId = (await ok(api('GET', '/branches', { token: owner })))[0].id;
    const book = await ok(api('GET', `/daybook?branchId=${branchId}&from=${today()}`, { token: owner }));
    assert.ok(!book.entries.some((e) => /OLD-10/.test(e.particulars)));
  });
});

describe('AI features', () => {
  let third, demoCustomer;

  test('everything that sends data to Claude is off until the owner turns it on', async () => {
    const st = await ok(api('GET', '/ai/status', { token: owner }));
    assert.deepEqual(st, { configured: true, enabled: false, switchedOn: false });
    const before = claudeCalls.length;
    const ask = await api('POST', '/ai/ask', { token: owner, body: { question: 'How much did we collect today?' } });
    assert.equal(ask.status, 400);
    assert.equal(ask.data.code, 'ai.errors.off');
    assert.equal((await api('POST', '/ai/read-id', { token: owner, body: { mediaType: 'image/jpeg', image: 'A'.repeat(200) } })).data.code, 'ai.errors.off');
    // The briefing and reminders still work, from plain rules, and nothing is sent out.
    const brief = await ok(api('GET', '/ai/briefing?language=ta', { token: owner }));
    assert.equal(brief.source, 'rules');
    assert.ok(brief.bullets.length >= 2 && /இன்று/.test(brief.bullets.join(' ')));
    demoCustomer = (await ok(api('GET', '/customers', { token: owner }))).rows[0];
    const rem = await ok(api('POST', `/ai/customers/${demoCustomer.id}/reminder`, { token: owner, body: {} }));
    assert.equal(rem.source, 'rules');
    assert.ok(rem.text.includes(demoCustomer.name));
    assert.equal(claudeCalls.length, before);
    // Only the owner can turn it on.
    assert.equal((await api('PUT', '/settings', { token: manager, body: { settings: { aiEnabled: true } } })).status, 403);
    await ok(api('PUT', '/settings', { token: owner, body: { settings: { aiEnabled: true } } }));
    assert.equal((await ok(api('GET', '/ai/status', { token: owner }))).enabled, true);
  });

  test('server-side helpers: alerts, forecast, risk score and visit-order data', async () => {
    const alerts = await ok(api('GET', '/ai/alerts', { token: owner }));
    assert.ok(Array.isArray(alerts));
    for (const a of alerts) assert.ok(['agentDrop', 'reversals', 'dayReopened', 'sharedPhone', 'sharedId', 'shortages', 'flagged'].includes(a.kind));
    const f = await ok(api('GET', '/ai/forecast', { token: manager }));
    assert.equal(f.days.length, 7);
    assert.equal(f.totalExpected, f.days.reduce((s, d) => s + d.expected, 0));
    assert.equal(f.freeToLend, f.fundBalance + f.totalExpected - f.approvedWaiting);
    assert.equal((await api('GET', '/ai/forecast', { token: agent })).status, 403);
    const h = await ok(api('GET', `/customers/${demoCustomer.id}/history?amount=100000000`, { token: owner }));
    assert.ok(['A', 'B', 'C', 'D', 'NEW'].includes(h.summary.grade));
    assert.ok(Array.isArray(h.summary.reasons));
    const route = (await ok(api('GET', '/routes/mine', { token: agent })))[0];
    const day = await ok(api('GET', `/routes/${route.id}/day`, { token: agent }));
    assert.ok(day.customers.every((c) => 'usualHour' in c && 'promiseDate' in c));
    // The promise to pay made in the multi-tenancy test is still open.
    assert.ok(day.customers.some((c) => c.promiseDate === today()));
  });

  test('ask, briefing, reminder and ID reading go through Claude when on', async () => {
    let n = claudeCalls.length;
    const ask = await ok(api('POST', '/ai/ask', { token: owner, body: { question: 'How are we doing today?', language: 'en' } }));
    assert.ok(ask.answer.startsWith('ANSWER'));
    assert.deepEqual(ask.tools.sort(), ['dashboard_today', 'places']);
    assert.equal(claudeCalls.length, n + 2);
    assert.equal(claudeCalls[n].model, 'claude-opus-5-5');
    assert.equal(claudeCalls[n].fallbacks, 'default');
    const brief = await ok(api('GET', '/ai/briefing', { token: owner }));
    assert.equal(brief.source, 'ai');
    assert.deepEqual(brief.bullets, ['AI bullet one', 'AI bullet two']);
    // Same figures again: served from the cache, Claude is not asked twice.
    n = claudeCalls.length;
    await ok(api('GET', '/ai/briefing', { token: owner }));
    assert.equal(claudeCalls.length, n);
    const rem = await ok(api('POST', `/ai/customers/${demoCustomer.id}/reminder`, { token: owner, body: { language: 'ta' } }));
    assert.equal(rem.source, 'ai');
    assert.equal(rem.text, 'AI reminder text');
    // The ID card names someone already on the books: the form is filled and the duplicate is shown.
    const full = await ok(api('GET', `/customers/${demoCustomer.id}`, { token: owner }));
    idCardReply = { documentType: 'AADHAAR', name: full.name, idNumber: full.idNumber ?? '', address: '12 Main Road, Madurai', pincode: '625001', dateOfBirth: '1980', fatherOrHusbandName: '', readable: true };
    const id = await ok(api('POST', '/ai/read-id', { token: officer, body: { mediaType: 'image/jpeg', image: 'A'.repeat(200) } }));
    assert.equal(id.fields.name, full.name);
    assert.equal(id.fields.idType, 'AADHAAR');
    assert.ok(id.fields.address.includes('625001'));
    assert.ok(id.duplicates.some((d) => d.id === demoCustomer.id));
    // Agents sign up customers in the field, so they may read cards; an auditor may not.
    await ok(api('POST', '/ai/read-id', { token: agent, body: { mediaType: 'image/jpeg', image: 'A'.repeat(200) } }));
    assert.equal((await api('POST', '/ai/read-id', { token: await login('9000000007'), body: { mediaType: 'image/jpeg', image: 'A'.repeat(200) } })).status, 403);
    // Every call to Claude is in the audit log.
    const log = await ok(api('GET', '/audit?entity=AI', { token: owner }));
    assert.ok((log.rows ?? log).some((r) => r.action === 'AI_ASK'));
  });

  test("another business's AI sees only its own data", async () => {
    await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Third Finance', ownerName: 'Third Owner', ownerPhone: '9222222222', ownerPassword: 'Third@1234' } }));
    third = await login('9222222222', 'Third@1234');
    await ok(api('PUT', '/settings', { token: third, body: { settings: { aiEnabled: true } } }));
    const demoNames = (await ok(api('GET', '/customers', { token: owner }))).rows.map((c) => c.name);
    const demoStaff = (await ok(api('GET', '/staff', { token: owner }))).map((s) => s.name);
    const demoBranch = (await ok(api('GET', '/branches', { token: owner })))[0];
    const n = claudeCalls.length;
    const ask = await ok(api('POST', '/ai/ask', { token: third, body: { question: 'Who are my agents and customers?' } }));
    // Everything the tools sent to Claude for this business, and the answer, mention none of the demo business.
    // Whole words only, so a name like "Bala" does not match the field "fundBalance".
    const mentions = (text, name) => new RegExp(`(^|[^A-Za-z])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(text);
    const sent = JSON.stringify(claudeCalls.slice(n)) + ask.answer;
    for (const name of [...demoNames, ...demoStaff, demoBranch.name, 'Demo Finance']) assert.ok(!mentions(sent, name), `leaked ${name}`);
    for (const path of ['/ai/alerts', '/ai/forecast', '/ai/briefing']) {
      const r = JSON.stringify(await ok(api('GET', path, { token: third })));
      for (const name of [...demoNames, ...demoStaff]) assert.ok(!mentions(r, name), `${path} leaked ${name}`);
    }
    // Messaging the demo business's customer is refused; naming its branch finds nothing.
    assert.equal((await api('POST', `/ai/customers/${demoCustomer.id}/reminder`, { token: third, body: {} })).status, 404);
    const f = await ok(api('GET', `/ai/forecast?branchId=${demoBranch.id}`, { token: third }));
    assert.equal(f.totalDue, 0);
    assert.equal(f.fundBalance, 0);
    // A duplicate check from an ID card never finds the demo business's customers.
    idCardReply = { ...idCardReply, name: demoNames[0] };
    const id = await ok(api('POST', '/ai/read-id', { token: third, body: { mediaType: 'image/jpeg', image: 'A'.repeat(200) } }));
    assert.deepEqual(id.duplicates, []);
  });
});

describe('routes with several areas', () => {
  let anna, kk, twoRoute, otherBranchArea, thirunagar, second, first;

  test('a route takes several areas; the first one chosen is its main area', async () => {
    const areas = await ok(api('GET', '/locations', { token: owner }));
    anna = areas.find((a) => a.name === 'Anna Nagar');
    kk = areas.find((a) => a.name === 'KK Nagar');
    const r = await ok(api('POST', '/routes', { token: owner, body: { locationIds: [kk.id, anna.id, kk.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } }));
    twoRoute = r.id;
    assert.equal(r.locationId, kk.id);
    const row = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === twoRoute);
    assert.deepEqual(row.locations.map((l) => l.name), ['KK Nagar', 'Anna Nagar'], 'main area first, duplicates dropped');
    assert.equal(row.location.name, 'KK Nagar');
    const day = await ok(api('GET', `/routes/${twoRoute}/day`, { token: owner }));
    assert.deepEqual(day.route.locations.map((l) => l.name), ['KK Nagar', 'Anna Nagar']);
    assert.deepEqual((await ok(api('GET', '/routes', { token: owner }))).find((x) => x.name === 'Anna Nagar Daily 1').locations.map((l) => l.name), ['Anna Nagar']);
  });

  test('the area filter finds a route by any of its areas, not only the main one', async () => {
    const byAnna = await ok(api('GET', `/routes?locationId=${anna.id}`, { token: owner }));
    assert.ok(byAnna.some((r) => r.id === twoRoute), 'Anna Nagar is a second area of the route');
    assert.ok(byAnna.some((r) => r.name === 'Anna Nagar Daily 1'));
    const byKk = await ok(api('GET', `/routes?locationId=${kk.id}`, { token: owner }));
    assert.ok(byKk.some((r) => r.id === twoRoute));
    assert.ok(!byKk.some((r) => r.name === 'Anna Nagar Daily 1'));
  });

  test('areas must belong to the business and to the route\'s branch', async () => {
    const trichy = await ok(api('POST', '/branches', { token: owner, body: { name: 'Trichy', code: 'TRY' } }));
    otherBranchArea = await ok(api('POST', '/locations', { token: owner, body: { branchId: trichy.id, name: 'Srirangam' } }));
    const mixed = await api('POST', '/routes', { token: owner, body: { locationIds: [anna.id, otherBranchArea.id], name: 'Mixed Branches' } });
    assert.equal(mixed.status, 400);
    assert.equal(mixed.data.message, 'All areas of a route must be in the same branch');
    assert.equal((await api('POST', '/routes', { token: owner, body: { locationIds: [anna.id, 'no-such-area'], name: 'Ghost Area' } })).status, 404);
    assert.equal((await api('POST', '/routes', { token: owner, body: { name: 'No Areas' } })).status, 400);
    assert.equal((await api('POST', '/routes', { token: owner, body: { locationIds: [], name: 'No Areas' } })).status, 400);
    assert.equal((await api('PUT', `/routes/${twoRoute}`, { token: owner, body: { locationIds: [kk.id, otherBranchArea.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } })).status, 400);
    const row = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === twoRoute);
    assert.deepEqual(row.locations.map((l) => l.name), ['KK Nagar', 'Anna Nagar'], 'a refused edit changes nothing');
  });

  test('the old single-area request still works', async () => {
    const r = await ok(api('POST', '/routes', { token: owner, body: { locationId: kk.id, name: 'Old App Route', collectionDays: [1] } }));
    const row = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === r.id);
    assert.deepEqual(row.locations.map((l) => l.name), ['KK Nagar']);
  });

  test('a customer\'s area must be one of the route\'s areas; editing the route moves the rest to the main area', async () => {
    thirunagar = await ok(api('POST', '/locations', { token: owner, body: { branchId: (await ok(api('GET', '/branches', { token: owner })))[0].id, name: 'Thirunagar' } }));
    const body = (phone, locationId) => ({ name: 'Two Area Customer', phone, address: '7 Test Street', locationId, routeId: twoRoute });
    first = await ok(api('POST', '/customers', { token: owner, body: body('9123456790', kk.id) }));
    second = await ok(api('POST', '/customers', { token: owner, body: body('9123456791', anna.id) }));
    assert.equal((await api('POST', '/customers', { token: owner, body: body('9123456792', thirunagar.id) })).status, 400);
    await ok(api('PUT', `/routes/${twoRoute}`, { token: owner, body: { locationIds: [kk.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } }));
    assert.equal((await ok(api('GET', `/customers/${second.id}`, { token: owner }))).locationId, kk.id, 'customer in a removed area moves to the main area');
    assert.equal((await ok(api('GET', `/customers/${first.id}`, { token: owner }))).locationId, kk.id);
    await ok(api('PUT', `/routes/${twoRoute}`, { token: owner, body: { locationIds: [kk.id, anna.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } }));
  });

  test('an area on another route cannot move branch until it is taken off that route', async () => {
    const demoBranch = (await ok(api('GET', '/branches', { token: owner }))).find((b) => b.code === 'MDU');
    const trichy = (await ok(api('GET', '/branches', { token: owner }))).find((b) => b.code === 'TRY');
    const ponmalai = await ok(api('POST', '/locations', { token: owner, body: { branchId: demoBranch.id, name: 'Ponmalai' } }));
    await ok(api('PUT', `/routes/${twoRoute}`, { token: owner, body: { locationIds: [kk.id, anna.id, ponmalai.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } }));
    const refused = await api('PUT', `/locations/${ponmalai.id}`, { token: owner, body: { branchId: trichy.id, name: 'Ponmalai' } });
    assert.equal(refused.status, 400);
    const still = (await ok(api('GET', '/locations', { token: owner }))).find((x) => x.id === ponmalai.id);
    assert.equal(still.branchId, demoBranch.id, 'a refused move changes nothing');
    await ok(api('PUT', `/routes/${twoRoute}`, { token: owner, body: { locationIds: [kk.id, anna.id], name: 'Two Areas Route', collectionDays: [1, 3, 5] } }));
    const moved = await api('PUT', `/locations/${ponmalai.id}`, { token: owner, body: { branchId: trichy.id, name: 'Ponmalai' } });
    assert.equal(moved.status, 200);
    const row = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === twoRoute);
    assert.deepEqual(row.locations.map((l) => l.name), ['KK Nagar', 'Anna Nagar']);
    assert.equal(row.branchId, demoBranch.id);
  });

  test('another business cannot use, read or change these areas or routes', async () => {
    // A business of its own (the other one was suspended by an earlier test).
    await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Fresh Finance', ownerName: 'Fresh Owner', ownerPhone: '9112222222', ownerPassword: 'Fresh@1234' } }));
    const outsider = await login('9112222222', 'Fresh@1234');
    const ob = await ok(api('POST', '/branches', { token: outsider, body: { name: 'Other Second', code: 'OS' } }));
    const oa = await ok(api('POST', '/locations', { token: outsider, body: { branchId: ob.id, name: 'Other Area' } }));
    const before = (await ok(api('GET', '/routes', { token: owner }))).length;
    // Its own area plus a demo area, and an edit of a demo route to the outsider's area, are both refused as not found.
    const mixed = await api('POST', '/routes', { token: outsider, body: { locationIds: [oa.id, anna.id], name: 'Stolen Area' } });
    assert.equal(mixed.status, 404);
    assert.equal((await api('PUT', `/routes/${twoRoute}`, { token: outsider, body: { locationIds: [oa.id], name: 'Two Areas Route', collectionDays: [1] } })).status, 404);
    assert.equal((await api('PUT', `/routes/${twoRoute}`, { token: outsider, body: { locationIds: [anna.id], name: 'Two Areas Route', collectionDays: [1] } })).status, 404);
    assert.equal((await api('POST', '/customers', { token: outsider, body: { name: 'Stolen Customer', phone: '9123456793', address: '8 Test Street', locationId: oa.id, routeId: twoRoute } })).status, 404);
    assert.equal((await ok(api('GET', `/routes?locationId=${anna.id}`, { token: outsider }))).length, 0);
    assert.equal((await ok(api('GET', '/routes', { token: owner }))).length, before, 'the demo business keeps its routes');
    assert.deepEqual((await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === twoRoute).locations.map((l) => l.name), ['KK Nagar', 'Anna Nagar']);
  });

  test('routes made before areas were listed get their area rows when the API starts, once', async () => {
    const legacy = await ok(api('POST', '/routes', { token: owner, body: { locationIds: [anna.id], name: 'Legacy Route', collectionDays: [1] } }));
    // Simulates a route saved before the join table existed.
    sqlOnDb(`DELETE FROM "RouteLocation" WHERE "routeId" = '${legacy.id}';`);
    const gone = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === legacy.id);
    assert.deepEqual(gone.locations, []);
    await stopApi();
    await startApi();
    const back = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === legacy.id);
    assert.deepEqual(back.locations.map((l) => l.name), ['Anna Nagar']);
    assert.ok(!(await ok(api('GET', `/routes?locationId=${kk.id}`, { token: owner }))).some((x) => x.id === legacy.id));
    await stopApi();
    await startApi();
    const again = (await ok(api('GET', '/routes', { token: owner }))).find((x) => x.id === legacy.id);
    assert.deepEqual(again.locations.map((l) => l.name), ['Anna Nagar'], 'a second start adds nothing');
  });
});

describe('setup view, area tracking and area rules', () => {
  let demoBranch, annaArea, kkArea, annaRoute, bareArea, dormantArea, dormantCustomer, dormantRoute;

  test('the setup view lists each branch, its areas and the routes in each area, with counts that match the lists', async () => {
    const tree = await ok(api('GET', '/structure/tree', { token: owner }));
    demoBranch = tree.branches.find((b) => b.code === 'MDU');
    assert.ok(demoBranch, 'the demo branch is listed');
    annaArea = demoBranch.areas.find((a) => a.name === 'Anna Nagar');
    kkArea = demoBranch.areas.find((a) => a.name === 'KK Nagar');
    assert.ok(annaArea && kkArea);
    annaRoute = annaArea.routes.find((r) => r.name === 'Anna Nagar Daily 1').id;
    // A route that covers two areas is listed under each of them.
    assert.ok(annaArea.routes.some((r) => r.name === 'Two Areas Route'));
    assert.ok(kkArea.routes.some((r) => r.name === 'Two Areas Route'));
    // The counts are the same as the lists the other endpoints give.
    const routes = await ok(api('GET', '/routes', { token: owner }));
    for (const area of demoBranch.areas) {
      const listed = await ok(api('GET', `/routes?locationId=${area.id}`, { token: owner }));
      assert.equal(area.routeCount, listed.length, `${area.name}: routes`);
      const active = await ok(api('GET', `/customers?locationId=${area.id}&status=ACTIVE`, { token: owner }));
      assert.equal(area.customerCount, active.total, `${area.name}: customers`);
      for (const r of area.routes) assert.equal(r.customerCount, routes.find((x) => x.id === r.id).customerCount, `${r.name}: customers`);
    }
    assert.equal(tree.branches.length >= 2, true, 'the owner sees every branch');
  });

  test('the setup view and area tracking show only the caller\'s branches; agents cannot open either', async () => {
    const mine = await ok(api('GET', '/structure/tree', { token: manager }));
    assert.deepEqual(mine.branches.map((b) => b.code), ['MDU']);
    assert.equal((await api('GET', '/structure/tree', { token: agent })).status, 403);
    assert.equal((await api('GET', '/structure/areas-summary', { token: agent })).status, 403);
    assert.equal((await api('GET', '/structure/areas-summary', { token: manager })).status, 200);
    const sum = await ok(api('GET', '/structure/areas-summary', { token: manager }));
    assert.ok(sum.areas.every((a) => a.branchName === 'Madurai'), 'a manager sees only the Madurai areas');
  });

  test('the area summary adds up to the dashboard, for the owner and for a branch manager', async () => {
    for (const [who, token] of [['owner', owner], ['manager', manager]]) {
      const dash = await ok(api('GET', '/dashboard', { token }));
      const sum = await ok(api('GET', '/structure/areas-summary', { token }));
      assert.equal(sum.date, dash.date, `${who}: date`);
      assert.equal(sum.totals.collectedToday, dash.collectedToday, `${who}: collected today`);
      assert.equal(sum.totals.dueToday, dash.dueToday, `${who}: due today`);
      assert.equal(sum.totals.overdue, dash.overdueAtStart, `${who}: overdue`);
      assert.equal(sum.totals.activeLoans, dash.activeLoans, `${who}: active loans`);
      if (who === 'owner') assert.ok(dash.activeLoans > 0, 'the demo business has active loans to add up');
    }
  });

  test('an agent adds a customer by choosing the area, then the route, and sees only that area\'s routes', async () => {
    const kkRoutes = await ok(api('GET', `/routes?branchId=${demoBranch.id}&locationId=${kkArea.id}`, { token: agent }));
    assert.ok(kkRoutes.length > 0 && kkRoutes.every((r) => r.locations.some((l) => l.id === kkArea.id)));
    assert.ok(!kkRoutes.some((r) => r.name === 'Anna Nagar Daily 1'), 'the Anna Nagar route is not offered for KK Nagar');
    const c = await ok(api('POST', '/customers', { token: agent, body: { name: 'Area Agent Customer', phone: '9123400001', address: '12 Area Street', locationId: annaArea.id, routeId: annaRoute } }));
    assert.equal(c.locationId, annaArea.id);
    assert.equal(c.routeId, annaRoute);
    // A route outside the chosen area is refused, whichever way round.
    const outside = await api('POST', '/customers', { token: agent, body: { name: 'Wrong Area', phone: '9123400005', address: '12 Area Street', locationId: kkArea.id, routeId: annaRoute } });
    assert.equal(outside.status, 400);
    assert.equal(outside.data.message, 'The route is not in the chosen location');
  });

  test('an area with no route, and a route with no customers, are flagged on the setup view', async () => {
    bareArea = await ok(api('POST', '/locations', { token: owner, body: { branchId: demoBranch.id, name: 'Bare Area' } }));
    let tree = await ok(api('GET', '/structure/tree', { token: owner }));
    let node = tree.branches.find((b) => b.code === 'MDU').areas.find((a) => a.id === bareArea.id);
    assert.equal(node.noRoute, true);
    assert.ok(tree.warnings.areasWithoutRoute >= 1);
    const empty = await ok(api('POST', '/routes', { token: owner, body: { locationIds: [bareArea.id], name: 'Empty Route', collectionDays: [1] } }));
    tree = await ok(api('GET', '/structure/tree', { token: owner }));
    node = tree.branches.find((b) => b.code === 'MDU').areas.find((a) => a.id === bareArea.id);
    assert.equal(node.noRoute, false);
    assert.equal(node.routes.find((r) => r.id === empty.id).noCustomers, true);
    assert.ok(tree.warnings.routesWithoutCustomers >= 1);
  });

  test('an inactive area takes no new customers or routes; what it has stays, and the summary keeps it marked inactive', async () => {
    dormantArea = await ok(api('POST', '/locations', { token: owner, body: { branchId: demoBranch.id, name: 'Dormant Area' } }));
    dormantCustomer = await ok(api('POST', '/customers', { token: owner, body: { name: 'Dormant Customer', phone: '9123400003', address: '14 Dormant Street', locationId: dormantArea.id } }));
    dormantRoute = await ok(api('POST', '/routes', { token: owner, body: { locationIds: [dormantArea.id], name: 'Dormant Route', collectionDays: [1] } }));
    await ok(api('PUT', `/locations/${dormantArea.id}`, { token: owner, body: { branchId: demoBranch.id, name: 'Dormant Area', active: false } }));
    const late = await api('POST', '/customers', { token: owner, body: { name: 'Late Customer', phone: '9123400002', address: '13 Dormant Street', locationId: dormantArea.id } });
    assert.equal(late.status, 400);
    assert.equal(late.data.code, 'structure.areaInactive');
    const newRoute = await api('POST', '/routes', { token: owner, body: { locationIds: [annaArea.id, dormantArea.id], name: 'Dormant Mix', collectionDays: [1] } });
    assert.equal(newRoute.status, 400);
    assert.equal(newRoute.data.code, 'structure.areaInactive');
    // Its customer can still be edited, and its route keeps the area it already covers.
    await ok(api('PUT', `/customers/${dormantCustomer.id}`, { token: owner, body: { name: 'Dormant Customer', phone: '9123400003', address: '14 Dormant Street', locationId: dormantArea.id } }));
    await ok(api('PUT', `/routes/${dormantRoute.id}`, { token: owner, body: { locationIds: [dormantArea.id], name: 'Dormant Route', collectionDays: [1] } }));
    const sum = await ok(api('GET', '/structure/areas-summary', { token: owner }));
    const row = sum.areas.find((a) => a.id === dormantArea.id);
    assert.equal(row.active, false);
    assert.equal(row.customerCount, 1, 'the old customer is still counted');
    const tree = await ok(api('GET', '/structure/tree', { token: owner }));
    assert.equal(tree.branches.find((b) => b.code === 'MDU').areas.find((a) => a.id === dormantArea.id).active, false);
    assert.equal((await ok(api('GET', `/customers/${dormantCustomer.id}`, { token: owner }))).locationId, dormantArea.id);
    // Reactivated, it takes customers again.
    await ok(api('PUT', `/locations/${dormantArea.id}`, { token: owner, body: { branchId: demoBranch.id, name: 'Dormant Area', active: true } }));
    await ok(api('POST', '/customers', { token: owner, body: { name: 'Back Customer', phone: '9123400006', address: '15 Dormant Street', locationId: dormantArea.id } }));
  });

  test('another business sees and changes none of these areas, routes or counts', async () => {
    await ok(api('POST', '/platform/tenants', { token: superAdmin, body: { name: 'Rival Setup', ownerName: 'Rival Owner', ownerPhone: '9113333333', ownerPassword: 'Rival@1234' } }));
    const rival = await login('9113333333', 'Rival@1234');
    const rt = await ok(api('GET', '/structure/tree', { token: rival }));
    const seen = JSON.stringify(rt);
    assert.ok(!seen.includes(annaArea.id) && !seen.includes(dormantArea.id) && !seen.includes(demoBranch.id), 'the tree shows none of the demo business');
    assert.equal((await ok(api('GET', '/structure/areas-summary', { token: rival }))).areas.length, 0);
    assert.equal((await ok(api('GET', `/routes?locationId=${annaArea.id}`, { token: rival }))).length, 0);
    assert.equal((await api('PUT', `/locations/${dormantArea.id}`, { token: rival, body: { branchId: demoBranch.id, name: 'Taken', active: true } })).status, 404);
    assert.equal((await api('POST', '/customers', { token: rival, body: { name: 'Rival Customer', phone: '9123400004', address: '1 Rival Street', locationId: annaArea.id, routeId: annaRoute } })).status, 404);
    assert.equal((await api('POST', '/routes', { token: rival, body: { locationIds: [annaArea.id], name: 'Rival Route', collectionDays: [1] } })).status, 404);
    assert.equal((await api('PUT', `/routes/${annaRoute}`, { token: rival, body: { locationIds: [annaArea.id], name: 'Hijack', collectionDays: [1] } })).status, 404);
    const after = await ok(api('GET', '/structure/areas-summary', { token: owner }));
    assert.equal(after.areas.find((a) => a.id === annaArea.id).name, 'Anna Nagar');
    assert.equal(after.areas.find((a) => a.id === dormantArea.id).active, true, 'the reactivated area is back');
  });
});
