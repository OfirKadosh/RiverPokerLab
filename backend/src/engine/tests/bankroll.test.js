const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { test } = require("node:test");
const { createAuth } = require("../../auth");
const { hashPassword } = require("../../auth/security");
const { createApp } = require("../../server");
const { createPreviewApp } = require("../../dev/preview");
const { createBankrollStore } = require("../../bankroll/store");
const { entry, settings, summarize } = require("../../bankroll/ledger");
const { MemoryAuthStore } = require("./support/authStore");

test("Balances separate poker results from deposits and withdrawals in minor units", () => {
  const row = (kind, values) => entry({ kind, date: "2026-11-09", ...values }, randomUUID());
  const entries = [
    row("cash", { buyIn: 2012, cashOut: 4077 }),
    row("tournament", { buyIn: 3000, cashOut: 0 }),
    row("deposit", { amount: 1000 }),
    row("withdrawal", { amount: 502 }),
  ];
  const ledger = summarize({ currency: "ILS", openingBalance: 9000, entries });
  assert.equal(ledger.pokerProfit, -935);
  assert.equal(ledger.netTransfers, 498);
  assert.equal(ledger.balance, 8563);
  assert.equal(summarize({ ...ledger, entries: entries.slice(1) }).balance, 6498);
});

test("Bankroll rejects fractional or oversized inputs and impossible dates", () => {
  const id = randomUUID();
  const base = { kind: "deposit", date: "2026-02-28", amount: 1 };
  for (const invalid of [
    { date: "2026-02-29" }, { amount: 0.5 }, { amount: "10" },
    { amount: 100_000_000_001 }, { amount: -100 }, { amount: 0 },
    { kind: "something else" }, { note: "a".repeat(241) },
  ]) assert.throws(() => entry({ ...base, ...invalid }, id), { status: 400 });
  assert.throws(() => entry(base, "bogus"), { status: 400 });
  assert.throws(() => settings({ currency: "BTC", openingBalance: 10 }), { status: 400 });
  assert.equal(entry({ kind: "tournament", date: "2028-02-29", buyIn: 0, cashOut: 0 }, id).buyIn, 0);
});

test("Atomic writes target only the owner, and a replay cannot double-count a new entry", async () => {
  const owner = "owner-id";
  const item = entry({ kind: "deposit", date: "2026-02-28", amount: 1500 }, randomUUID());
  const bankroll = { currency: "ILS", openingBalance: 0, entries: [item] };
  const calls = [];
  const store = createBankrollStore({
    findById(id) {
      assert.equal(id, owner);
      return { select: () => ({ lean: async () => ({ bankroll }) }) };
    },
    findOneAndUpdate(filter, mutation, options) {
      assert.equal(filter._id, owner);
      assert.equal(options.upsert, undefined);
      calls.push({ filter, mutation });
      return { lean: async () => null };
    },
  });
  assert.equal(await store.add(owner, item), bankroll);
  assert.equal(calls[0].filter["bankroll.entries.id"].$ne, item.id);
  assert.deepEqual(calls[0].filter["bankroll.entries.1999"], { $exists: false });
  await assert.rejects(() => store.add(owner, { ...item, amount: 1501 }), { status: 409 });
  await assert.rejects(() => store.edit(owner, item), { status: 404 });
  await assert.rejects(() => store.remove(owner, item.id), { status: 404 });
  assert.equal(calls[2].filter["bankroll.entries.id"], item.id);
  assert.equal(calls[3].filter["bankroll.entries.id"], item.id);
});

async function listen(t, app) {
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}/api`;
}

test("Authenticated HTTP requests use the session owner for reads and writes", async (t) => {
  const store = new MemoryAuthStore();
  const password = "correct horse battery staple";
  const passwordHash = await hashPassword(password);
  const alice = await store.createUser({
    username: "Alice", usernameKey: "alice", email: "alice@example.invalid",
    phone: "+15550000001", passwordHash, accountApprovedAt: new Date(),
  });
  const bob = await store.createUser({
    username: "Bobby", usernameKey: "bobby", email: "bobby@example.invalid",
    phone: "+15550000002", passwordHash, accountApprovedAt: new Date(),
  });
  const ledgers = new Map();
  const auth = createAuth({
    store,
    config: { secret: "test-only-bankroll-secret-never-production", origins: [], secure: false, cookieName: "river_session" },
    delivery: { config: { channels: ["email"] }, async send() {} },
  });
  const app = createApp({ auth, bankrollStore: {
    get: (id) => ledgers.get(id),
    configure(id, values) { ledgers.set(id, values); return values; },
  } });
  const base = await listen(t, app);
  const call = (path, method = "GET", cookie, body) => fetch(base + path, {
    method,
    headers: { "X-Requested-With": "RiverPokerLab", "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  const login = async (identifier) => {
    const response = await call("/auth/login", "POST", undefined, { identifier, password });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  };
  assert.equal((await call("/bankroll")).status, 401);
  const aliceCookie = await login("Alice");
  const bobCookie = await login("Bobby");
  const created = await call("/bankroll", "PUT", aliceCookie, { currency: "USD", openingBalance: 1000, ownerId: String(bob._id) });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).bankroll.balance, 1000);
  assert.equal(ledgers.get(String(alice._id)).openingBalance, 1000);
  assert.equal((await (await call("/bankroll", "GET", bobCookie)).json()).bankroll, null);
  assert.equal((await call("/bankroll/entries", "POST", aliceCookie, { id: randomUUID(), kind: "deposit", date: "2026-11-09", amount: 0 })).status, 400);
});

test("Local UI preview reads sample totals but blocks writes", async (t) => {
  const base = await listen(t, createPreviewApp({ NODE_ENV: "development" }));
  const response = await fetch(base + "/bankroll");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).bankroll.balance, 145500);
  assert.equal((await fetch(base + "/bankroll", { method: "PUT" })).status, 403);
});
