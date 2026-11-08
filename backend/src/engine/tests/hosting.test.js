const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../../server');
const { createAuth, authConfig } = require('../../auth');
const { createDelivery, deliveryConfig } = require('../../auth/delivery');
const { hashPassword } = require('../../auth/security');
const { frontendDirectory } = require('../../hosting');
const { MemoryAuthStore } = require('./support/authStore');
const Spot = require('../../models/Spot');
const env = {
  NODE_ENV: 'production', AUTH_SECRET: 'hosting-test-only-secret-never-use-in-production',
  RENDER: 'true', RENDER_EXTERNAL_URL: 'https://lab.example.invalid',
  EMAIL_PROVIDER: 'manual', SMS_PROVIDER: 'disabled', AUTH_ALLOW_MANUAL_DELIVERY: 'true',
};
const password = 'hosting test long password';

test('Manual delivery requires explicit opt-in and never enables development delivery in production', () => {
  assert.throws(() => deliveryConfig({ ...env, AUTH_ALLOW_MANUAL_DELIVERY: 'false' }), /opt-in/);
  assert.throws(() => deliveryConfig({ ...env, EMAIL_PROVIDER: 'development', AUTH_ALLOW_DEV_DELIVERY: 'true' }), /disabled/);
  assert.deepEqual(deliveryConfig(env).manualChannels, ['email']);
  assert.deepEqual(deliveryConfig({ ...env, EMAIL_PROVIDER: 'disabled' }).channels, []);
  assert.equal(frontendDirectory({ SERVE_FRONTEND: 'false' }), null);
});

test('Render origin is exact, independent of incoming Host, and explicit APP_ORIGINS overrides it', () => {
  assert.deepEqual(authConfig(env).origins, ['https://lab.example.invalid']);
  assert.deepEqual(authConfig({ ...env, APP_ORIGINS: 'https://custom.example.invalid' }).origins, ['https://custom.example.invalid']);
  assert.throws(() => authConfig({ ...env, RENDER: 'false' }), /HTTPS/);
  assert.throws(() => authConfig({ ...env, RENDER_EXTERNAL_URL: 'http://lab.example.invalid' }), /HTTPS/);
});

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'river-hosting-'));
  await fs.mkdir(path.join(directory, 'assets'));
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><html><body>River hosted client</body></html>');
  await fs.writeFile(path.join(directory, 'assets', 'app.css'), 'body { color: green; }');
  await fs.writeFile(path.join(directory, '.env'), 'SHOULD_NOT_BE_PUBLIC');
  let ready = true;
  const logs = [], store = new MemoryAuthStore();
  const delivery = createDelivery(env, () => { throw Error('Network delivery must not run.'); }, { info: (line) => logs.push(JSON.parse(line)) });
  const auth = createAuth({ store, delivery, config: authConfig(env) });
  const app = createApp({ auth, frontendDir: directory, databaseReady: () => ready });
  app.set('trust proxy', 1);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  async function request(url, { body, cookie, headers = {} } = {}) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'X-Forwarded-Proto': 'https', Origin: env.RENDER_EXTERNAL_URL,
        'X-Requested-With': 'RiverPokerLab', 'Content-Type': 'application/json',
        ...(cookie ? { Cookie: cookie } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, text, headers: response.headers,
      data: response.headers.get('content-type')?.includes('application/json') ? JSON.parse(text) : null,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  return { request, logs, store, delivery, setReady: value => ready = value,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); } };
}

test('Same-origin static client, health readiness and protected API work without exposing files or HTML API fallbacks', async () => {
  const f = await fixture();
  try {
    const home = await f.request('/');
    assert.equal(home.status, 200); assert.match(home.text, /River hosted client/);
    const asset = await f.request('/assets/app.css');
    assert.equal(asset.status, 200); assert.match(asset.headers.get('content-type'), /text\/css/);
    assert.equal((await f.request('/assets/missing.js')).status, 404);
    assert.equal((await f.request('/.env')).status, 404);
    assert.equal((await f.request('/backend/.env')).status, 404);
    assert.equal((await f.request('/api/spots')).status, 401);
    assert.equal((await f.request('/api/not-a-route')).data.success, false);
    assert.equal((await f.request('/api/auth/not-a-route')).status, 401);
    assert.equal((await f.request('/healthz')).status, 200);
    f.setReady(false);
    assert.deepEqual((await f.request('/healthz')).data, { status: 'unavailable' });
    assert.equal((await f.request('/healthz')).status, 503);
    assert.equal((await f.request('/api/auth/config', { headers: { Origin: 'https://evil.invalid' } })).status, 403);
    assert.equal((await f.request('/api/auth/config', { headers: { 'X-Forwarded-Proto': 'http' } })).status, 400);
  } finally { await f.close(); }
});

test('Hosted manual activation supports secure login, saving and private history without claiming contact verification', async () => {
  const f = await fixture();
  const save = Spot.prototype.save, find = Spot.find, rows = [];
  Spot.prototype.save = async function () { rows.push(this.toObject()); return this; };
  Spot.find = filter => ({ sort: () => ({ limit: async () => rows.filter(row => String(row.ownerId) === filter.ownerId) }) });
  try {
    const config = await f.request('/api/auth/config');
    assert.deepEqual(config.data.manualChannels, ['email']);
    assert.equal(config.data.development, false);
    const registered = await f.request('/api/auth/register', { body: {
      username: 'ManualTester', email: 'manual@example.invalid', phone: '+15550000001', password, channel: 'email',
    } });
    assert.equal(registered.status, 201); assert.equal(registered.data.verification.manual, true);
    const pending = registered.cookie, log = f.logs[0];
    assert.equal(log.event, 'manual_account_activation'); assert.equal(log.username, 'ManualTester');
    assert.equal(log.code, undefined); assert.equal(log.to, undefined);
    await f.store.createUser({
      username: 'admin', usernameKey: 'admin', role: 'admin',
      passwordHash: await hashPassword(password), accountApprovedAt: new Date(),
    });
    const admin = await f.request('/api/auth/login', { body: { identifier: 'admin', password } });
    assert.equal(admin.status, 200);
    const dashboard = await f.request('/api/auth/admin/accounts', { body: {}, cookie: admin.cookie });
    const code = dashboard.data.accounts.find(account => account.username === 'ManualTester').verification.code;
    assert.match(code, /^\d{8}$/);
    assert.ok(!JSON.stringify(registered.data).includes(code));
    assert.equal((await f.request('/api/auth/me', { cookie: pending })).data.verification.manual, true);
    assert.equal((await f.request('/api/spots', { cookie: pending })).status, 401);
    assert.equal((await f.request('/api/auth/verification/send', { cookie: pending, body: { channel: 'email' } })).status, 429);
    const bad = code === '00000000' ? '11111111' : '00000000';
    assert.equal((await f.request('/api/auth/verification/confirm', { cookie: pending, body: { code: bad } })).status, 400);
    // Switching providers must not relabel an already-issued manual challenge as contact proof.
    f.delivery.config.manualChannels = [];
    const confirmed = await f.request('/api/auth/verification/confirm', { cookie: pending, body: { code } });
    assert.equal(confirmed.status, 200);
    assert.equal((await f.request('/api/auth/verification/confirm', { cookie: pending, body: { code } })).status, 401);
    const login = await f.request('/api/auth/login', { body: { identifier: 'manualtester', password, remember: true } });
    assert.equal(login.status, 200); assert.equal(login.data.user.manuallyApproved, true);
    assert.equal(login.data.user.emailVerified, false); assert.equal(login.data.user.phoneVerified, false);
    const cookie = login.cookie;
    assert.match(cookie, /^__Host-river_session=/);
    assert.match(login.headers.get('set-cookie'), /Secure/); assert.match(login.headers.get('set-cookie'), /HttpOnly/);
    assert.match(login.headers.get('set-cookie'), /SameSite=Lax/);
    assert.deepEqual((await f.request('/api/spots', { cookie })).data.spots, []);
    const spot = { players: [['Ah', 'Ac'], ['Kh', 'Kc']], board: ['2s', '3d', '7h', '8c', '9s'], potSize: 100, callAmount: 0, iterations: 1, saveSpot: true };
    assert.equal((await f.request('/api/calculate', { cookie, body: spot })).status, 200);
    assert.equal((await f.request('/api/spots', { cookie })).data.spots.length, 1);
    assert.equal((await f.request('/api/unknown', { cookie })).status, 404);
    assert.equal((await f.request('/api/auth/logout', { cookie, body: {} })).status, 200);
    assert.equal((await f.request('/api/spots', { cookie })).status, 401);
  } finally { Spot.prototype.save = save; Spot.find = find; await f.close(); }
});

test('Small-instance password hashing has a bounded queue and returns a recoverable overload error', async () => {
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => hashPassword(password)));
  const failures = results.filter(result => result.status === 'rejected');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.status, 503);
  assert.equal(failures[0].reason.code, 'HASH_BUSY');
  assert.ok(results.filter(result => result.status === 'fulfilled').every(result => result.value.startsWith('scrypt$131072$8$1$')));
});
