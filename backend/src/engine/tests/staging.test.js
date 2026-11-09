const assert = require("node:assert/strict");
const { test } = require("node:test");
const { once } = require("node:events");
const { createApp } = require("../../server");
const { createAuth, authConfig } = require("../../auth");
const { checkPassword } = require("../../auth/security");
const { stagingConfig, stagingGate, seedStagingUsers } = require("../../staging");
const { MemoryAuthStore } = require("./support/authStore");

const gate = "fixture_staging_gate_password";
const passwords = ["fixture_staging_a_password", "fixture_staging_b_password"];

test("Staging requires separate strong passwords and the configured staging Atlas database", () => {
  const env = {
    RPL_STAGING: "true", NODE_ENV: "production",
    RPL_STAGING_GATE_PASSWORD: gate,
    RPL_STAGING_TESTER_A_PASSWORD: passwords[0], RPL_STAGING_TESTER_B_PASSWORD: passwords[1],
    RPL_STAGING_DB_HOST: "staging.example.invalid",
    APP_DATABASE_NAME: "river_poker_lab_staging",
    MONGO_URI: "mongodb+srv://staging.example.invalid/river_poker_lab_staging",
  };
  assert.deepEqual(stagingConfig(env), { gate, passwords });
  assert.equal(stagingConfig({}), null);
  assert.throws(() => stagingConfig({ ...env, APP_DATABASE_NAME: "production" }), /designated Atlas/);
  assert.throws(() => stagingConfig({ ...env, MONGO_URI: "mongodb+srv://other.example.invalid/river_poker_lab_staging" }), /designated Atlas/);
  assert.throws(() => stagingConfig({ ...env, RPL_STAGING_TESTER_B_PASSWORD: passwords[0] }), /distinct/);
});

test("Staging seeds only two approved regular test accounts and leaves their ledger intact", async () => {
  const writes = [];
  await seedStagingUsers(passwords, { async updateOne(...args) { writes.push(args); } });
  assert.equal(writes.length, 2);
  for (const [index, [filter, update, options]] of writes.entries()) {
    const username = index ? "tester-b" : "tester-a";
    assert.deepEqual(filter, { usernameKey: username, role: "user" });
    assert.equal(options.upsert, true);
    assert.equal(update.$setOnInsert.email, username + "@example.invalid");
    assert.ok(update.$setOnInsert.accountApprovedAt instanceof Date);
    assert.deepEqual(Object.keys(update.$set), ["passwordHash"]);
    assert.equal(await checkPassword(passwords[index], update.$set.passwordHash), true);
  }
});

test("The staging gate protects web and API access, and registration is closed behind it", async (t) => {
  const config = authConfig({ RPL_STAGING: "true", AUTH_SECRET: "test-only-secret-never-for-production" });
  const auth = createAuth({ config, store: new MemoryAuthStore(), delivery: { config: { channels: [] } } });
  const app = createApp({ auth, gate: stagingGate(gate), databaseReady: () => true });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const headers = { Authorization: "Basic " + Buffer.from("staging:" + gate).toString("base64") };
  assert.equal((await fetch(base + "/healthz")).status, 200);
  for (const path of ["/", "/api/auth/config", "/api/bankroll"]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401);
    assert.match(response.headers.get("www-authenticate"), /^Basic /);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const publicConfig = await fetch(base + "/api/auth/config", { headers });
  assert.equal((await publicConfig.json()).registrationClosed, true);
  const registration = await fetch(base + "/api/auth/Register", {
    method: "POST", headers: { ...headers, "Content-Type": "application/json", "X-Requested-With": "RiverPokerLab" }, body: "{}",
  });
  assert.equal(registration.status, 403);
  assert.match((await registration.json()).error, /Registration is closed/);
  const ledger = await fetch(base + "/api/bankroll", { headers });
  assert.equal(ledger.status, 401);
  assert.equal(ledger.headers.get("www-authenticate"), null);
});
