const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { createAuth, authConfig } = require("../../auth");
const { createDelivery } = require("../../auth/delivery");
const {
  registration,
  hashPassword,
  checkPassword,
  tokenHash,
} = require("../../auth/security");
const { MemoryAuthStore } = require("./support/authStore");
const { createApp } = require("../../server");
const Spot = require("../../models/Spot");
const password = "correct horse battery staple";
async function fixture() {
  const store = new MemoryAuthStore(),
    messages = [];
  let instant = new Date("2026-10-31T10:00:00Z");
  const delivery = {
    config: { channels: ["email", "sms"], development: false },
    async send(message) {
      messages.push(message);
    },
  };
  const config = {
    secret: "test-only-secret-32-characters-long-never-production",
    origins: ["http://client.test"],
    secure: false,
    cookieName: "river_session",
  };
  const auth = createAuth({
    store,
    config,
    delivery,
    now: () => new Date(instant),
  });
  const app = createApp({ auth }),
    server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const request = async (path, body, cookie, extra = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "RiverPokerLab",
          ...(cookie ? { Cookie: cookie } : {}),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      data: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
      setCookie: response.headers.get("set-cookie"),
      headers: response.headers,
    };
  };
  const register = async (name = "Alice", channel = "email") =>
    request("auth/register", {
      email: `${name.toLowerCase()}@example.invalid`,
      username: name,
      phone: name === "Alice" ? "+15550000001" : "+15550000002",
      password,
      channel,
    });
  const login = async (name = "Alice", remember = false, cookie) =>
    request("auth/login", { identifier: name, password, remember }, cookie);
  const verify = async (cookie, code = messages.at(-1).code) =>
    request("auth/verification/confirm", { code }, cookie);
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  };
  return {
    app,
    store,
    messages,
    delivery,
    config,
    request,
    register,
    login,
    verify,
    close,
    advance: (milliseconds) => {
      instant = new Date(+instant + milliseconds);
    },
  };
}
test("Registration validation normalizes identifiers and phone but never trims passwords", () => {
  const r = registration({
    email: " OFIR@Example.Invalid ",
    username: " Ofir_1 ",
    phone: "+972 (50) 123-4567",
    password,
    channel: "email",
  });
  assert.equal(r.email, "ofir@example.invalid");
  assert.equal(r.usernameKey, "ofir_1");
  assert.equal(r.phone, "+972501234567");
  assert.equal(r.password, password);
  for (const field of [
    { email: "a" },
    { username: "ab" },
    { phone: "0501234567" },
    { password: "short" },
    { channel: "fax" },
    { password: "a".repeat(129) },
  ])
    assert.throws(() =>
      registration({
        email: "a@example.invalid",
        username: "Tester",
        phone: "+15550000001",
        password,
        channel: "email",
        ...field,
      }),
    );
});
test("Passwords use independent salts, configured scrypt cost, and constant-time verification", async () => {
  const a = await hashPassword(password),
    b = await hashPassword(password);
  assert.notEqual(a, b);
  assert.ok(a.startsWith("scrypt$131072$8$1$"));
  assert.equal(await checkPassword(password, a), true);
  assert.equal(await checkPassword(password + " ", a), false);
  assert.equal(await checkPassword(password, undefined), false);
  assert.equal(await checkPassword({}, a), false);
});
test("Anonymous and pending accounts cannot reach any private API; code confirmation is single-use", async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request("spots")).status, 401);
    assert.equal(
      (await f.request("icm", { players: [], payouts: [] })).status,
      401,
    );
    const registered = await f.register();
    assert.equal(registered.status, 201);
    assert.ok(registered.cookie);
    assert.ok(!/Max-Age=/.test(registered.setCookie));
    assert.ok(registered.setCookie.includes("HttpOnly"));
    assert.ok(registered.setCookie.includes("SameSite=Lax"));
    assert.equal(
      (await f.request("spots", undefined, registered.cookie)).status,
      401,
    );
    assert.equal((await f.login()).data.code, "VERIFICATION_REQUIRED");
    const pending = (await f.login()).cookie;
    const user = [...f.store.users.values()][0];
    assert.notEqual(user.verificationHash, f.messages[0].code);
    assert.ok(!JSON.stringify(registered.data).includes(f.messages[0].code));
    assert.equal((await f.verify(pending)).status, 200);
    assert.equal((await f.verify(pending)).status, 401);
    const login = await f.login("ALICE@EXAMPLE.INVALID");
    assert.equal(login.status, 200);
    assert.equal(login.data.user.emailVerified, true);
    assert.equal(login.data.user.phoneVerified, false);
    assert.ok(!login.data.user.passwordHash);
    assert.equal(
      (await f.request("auth/me", undefined, login.cookie)).data.user.username,
      "Alice",
    );
  } finally {
    await f.close();
  }
});
test("Remember me is a persistent 30-day cookie; ordinary login expires at 12 hours; logout revokes tokens", async () => {
  const f = await fixture();
  try {
    const r = await f.register();
    await f.verify(r.cookie);
    let login = await f.login();
    assert.ok(!login.setCookie.includes("Max-Age"));
    f.advance(12 * 3600000 + 1);
    assert.equal(
      (await f.request("spots", undefined, login.cookie)).status,
      401,
    );
    login = await f.login("Alice", true);
    assert.ok(login.setCookie.includes("Max-Age=2592000"));
    assert.equal(login.data.session.remember, true);
    assert.ok(
      ![...f.store.sessions.keys()].includes(login.cookie.split("=")[1]),
    );
    assert.ok(f.store.sessions.has(tokenHash(login.cookie.split("=")[1])));
    const logout = await f.request("auth/logout", {}, login.cookie);
    assert.equal(logout.status, 200);
    assert.ok(logout.setCookie.includes("Expires="));
    assert.equal(
      (await f.request("spots", undefined, login.cookie)).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("Code attempts, cooldown, resend invalidation, expiry and SMS verification are enforced", async () => {
  const f = await fixture();
  try {
    const r = await f.register("Alice", "sms"),
      old = f.messages.at(-1).code;
    assert.equal(f.messages.at(-1).channel, "sms");
    for (let i = 0; i < 5; i++)
      assert.equal(
        (await f.verify(r.cookie, old === "00000000" ? "11111111" : "00000000"))
          .status,
        400,
      );
    assert.equal((await f.verify(r.cookie, old)).status, 400);
    assert.equal(
      (await f.request("auth/verification/send", { channel: "sms" }, r.cookie))
        .status,
      429,
    );
    f.advance(60001);
    assert.equal(
      (await f.request("auth/verification/send", { channel: "sms" }, r.cookie))
        .status,
      200,
    );
    const fresh = f.messages.at(-1).code;
    if (fresh !== old)
      assert.equal((await f.verify(r.cookie, old)).status, 400);
    f.advance(10 * 60000 + 1);
    assert.equal((await f.verify(r.cookie, fresh)).status, 400);
    assert.equal(
      (await f.request("auth/verification/send", { channel: "sms" }, r.cookie))
        .status,
      200,
    );
    assert.equal((await f.verify(r.cookie)).status, 200);
    const login = await f.login("alice@example.invalid");
    assert.equal(login.data.user.phoneVerified, true);
    assert.equal(login.data.user.emailVerified, false);
  } finally {
    await f.close();
  }
});
test("Generic sign-in errors, boolean remember validation, uniqueness and identity throttling", async () => {
  const f = await fixture();
  try {
    const r = await f.register();
    await f.verify(r.cookie);
    assert.equal((await f.register()).status, 409);
    assert.equal(
      (
        await f.request("auth/login", {
          identifier: "Alice",
          password,
          remember: "true",
        })
      ).status,
      400,
    );
    const wrong = await f.request("auth/login", {
        identifier: "Alice",
        password: "wrong",
      }),
      unknown = await f.request("auth/login", {
        identifier: "Nobody",
        password: "wrong",
      });
    assert.equal(wrong.data.error, unknown.data.error);
    for (let i = 0; i < 9; i++)
      await f.request("auth/login", { identifier: "Alice", password: "wrong" });
    assert.equal((await f.login()).status, 429);
  } finally {
    await f.close();
  }
});
test("CSRF headers, JSON content type, Origin checks and no-store protect account/private routes", async () => {
  const f = await fixture();
  try {
    assert.equal(
      (
        await f.request(
          "auth/login",
          { identifier: "A", password },
          {},
          { "X-Requested-With": "" },
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("auth/register", {}, undefined, {
          Origin: "https://evil.invalid",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await f.request("auth/register", {}, undefined, {
          "Sec-Fetch-Site": "cross-site",
        })
      ).status,
      403,
    );
    const c = await f.request("auth/config");
    assert.equal(c.headers.get("cache-control"), "no-store");
    assert.deepEqual(c.data.channels, ["email", "sms"]);
  } finally {
    await f.close();
  }
});
test("New-user histories are empty and server ownership prevents spoofing, cross-user reads and legacy adoption", async (context) => {
  const f = await fixture();
  const rows = [{ _id: "legacy", players: [], createdAt: new Date() }];
  let lastFilter;
  context.mock.method(Spot.prototype, "save", async function () {
    const row = this.toObject();
    rows.push(row);
    return this;
  });
  context.mock.method(Spot, "find", (filter) => {
    lastFilter = filter;
    return {
      sort: () => ({
        limit: async () =>
          rows.filter(
            (row) =>
              row.ownerId && String(row.ownerId) === String(filter.ownerId),
          ),
      }),
    };
  });
  try {
    let r = await f.register();
    await f.verify(r.cookie);
    const alice = await f.login();
    r = await f.register("Bobby");
    await f.verify(r.cookie);
    const bob = await f.login("bobby");
    assert.deepEqual(
      (await f.request("spots", undefined, alice.cookie)).data.spots,
      [],
    );
    assert.deepEqual(
      (await f.request("spots", undefined, bob.cookie)).data.spots,
      [],
    );
    const spot = {
      players: [
        ["Ah", "Ac"],
        ["Kh", "Kc"],
      ],
      board: ["2s", "3d", "7h", "8c", "9s"],
      potSize: 100,
      callAmount: 0,
      iterations: 1,
      saveSpot: true,
      ownerId: bob.data.user.id,
    };
    assert.equal(
      (await f.request("calculate", spot, alice.cookie)).status,
      200,
    );
    assert.equal(String(rows[1].ownerId), alice.data.user.id);
    assert.equal(
      (await f.request("spots", undefined, alice.cookie)).data.spots.length,
      1,
    );
    assert.equal(lastFilter.ownerId, alice.data.user.id);
    assert.deepEqual(
      (
        await f.request(
          `spots?ownerId=${alice.data.user.id}`,
          undefined,
          bob.cookie,
        )
      ).data.spots,
      [],
    );
    assert.equal(lastFilter.ownerId, bob.data.user.id);
    assert.equal((await f.request("calculate", spot)).status, 401);
  } finally {
    await f.close();
  }
});
test("Delivery failure never verifies an account and production rejects development delivery", async () => {
  const f = await fixture();
  try {
    f.delivery.send = async () => {
      throw Error("provider secret must never escape");
    };
    const r = await f.register();
    assert.equal(r.status, 503);
    assert.equal(r.data.code, "DELIVERY_FAILED");
    assert.ok(!JSON.stringify(r.data).includes("provider secret"));
    assert.ok(![...f.store.users.values()][0].verificationHash);
    assert.equal((await f.login()).data.code, "VERIFICATION_REQUIRED");
  } finally {
    await f.close();
  }
  assert.throws(() =>
    createDelivery({
      NODE_ENV: "production",
      EMAIL_PROVIDER: "development",
      AUTH_ALLOW_DEV_DELIVERY: "true",
    }),
  );
  assert.throws(() => authConfig({ AUTH_SECRET: "short" }));
  assert.throws(() =>
    authConfig({
      NODE_ENV: "production",
      AUTH_SECRET: "x".repeat(64),
      APP_ORIGINS: "http://unsafe.invalid",
    }),
  );
});
test("Real email/SMS adapters construct provider requests without sending network messages", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    return { ok: true };
  };
  const env = {
    EMAIL_PROVIDER: "resend",
    SMS_PROVIDER: "twilio",
    RESEND_API_KEY: "test-resend-key",
    EMAIL_FROM: "Lab <lab@example.invalid>",
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_AUTH_TOKEN: "test-twilio-token",
    TWILIO_FROM: "+15550000000",
  };
  const delivery = createDelivery(env, fakeFetch);
  await delivery.send({
    channel: "email",
    to: "alice@example.invalid",
    code: "12345678",
  });
  await delivery.send({ channel: "sms", to: "+15550000001", code: "12345678" });
  assert.equal(requests[0].url, "https://api.resend.com/emails");
  assert.deepEqual(JSON.parse(requests[0].options.body).to, [
    "alice@example.invalid",
  ]);
  assert.ok(requests[1].url.endsWith("/Messages.json"));
  assert.equal(
    new URLSearchParams(requests[1].options.body).get("To"),
    "+15550000001",
  );
});

test("Successful sign-in rotates a previous browser session and invalidates the old token", async () => {
  const f = await fixture();
  try {
    const r = await f.register();
    await f.verify(r.cookie);
    const first = await f.login();
    const second = await f.login("alice@example.invalid", true, first.cookie);
    assert.notEqual(first.cookie, second.cookie);
    assert.equal(
      (await f.request("spots", undefined, first.cookie)).status,
      401,
    );
    assert.equal(
      (await f.request("auth/me", undefined, second.cookie)).data.user.username,
      "Alice",
    );
    f.advance(30 * 24 * 3600000 + 1);
    assert.equal(
      (await f.request("spots", undefined, second.cookie)).status,
      401,
    );
  } finally {
    await f.close();
  }
});
test("Concurrent code confirmation succeeds at most once", async () => {
  const f = await fixture();
  try {
    const r = await f.register();
    const results = await Promise.all([f.verify(r.cookie), f.verify(r.cookie)]);
    assert.equal(results.filter((result) => result.status === 200).length, 1);
    assert.ok(
      results.every((result) => [200, 400, 401].includes(result.status)),
    );
  } finally {
    await f.close();
  }
});
test("Production cookies use Secure and __Host prefix, and insecure requests are rejected", async () => {
  const f = await fixture();
  try {
    f.config.secure = true;
    f.config.cookieName = "__Host-river_session";
    f.app.set("trust proxy", 1);
    assert.equal((await f.request("auth/config")).status, 400);
    const r = await f.request(
      "auth/register",
      {
        email: "alice@example.invalid",
        username: "Alice",
        phone: "+15550000001",
        password,
        channel: "email",
      },
      undefined,
      { "X-Forwarded-Proto": "https" },
    );
    assert.equal(r.status, 201);
    assert.ok(r.setCookie.startsWith("__Host-river_session="));
    assert.ok(r.setCookie.includes("Secure"));
    assert.ok(r.setCookie.includes("HttpOnly"));
    assert.ok(r.setCookie.includes("Path=/"));
    assert.ok(!r.setCookie.includes("Domain="));
  } finally {
    await f.close();
  }
});

test("Ofir proves admin credentials once, rotates cookies, and switches back to an isolated normal account", async () => {
  const f = await fixture();
  try {
    const passwordHash = await hashPassword(password);
    const owner = await f.store.createUser({
      username: "Ofir", usernameKey: "ofir", email: "ofir@example.invalid",
      phone: "+15550000001", passwordHash, accountApprovedAt: new Date(),
    });
    const admin = await f.store.createUser({
      username: "admin", usernameKey: "admin", role: "admin",
      passwordHash, accountApprovedAt: new Date(),
    });
    const login = await f.login("Ofir", true);
    assert.equal(login.data.accountSwitch.mode, "link");
    assert.equal((await f.request("auth/admin/accounts", {}, login.cookie)).status, 403);
    assert.equal((await f.request("auth/switch-account", {}, login.cookie)).status, 400);
    assert.equal((await f.request("auth/switch-account", { adminPassword: "incorrect" }, login.cookie)).status, 403);
    const linked = await f.request("auth/switch-account", { adminPassword: password }, login.cookie);
    assert.equal(linked.status, 200);
    assert.equal(linked.data.user.id, admin._id);
    assert.equal(linked.data.accountSwitch.mode, "return");
    assert.ok(linked.data.session.expiresInMs <= 12 * 60 * 60000);
    assert.equal((await f.request("auth/admin/accounts", {}, login.cookie)).status, 401);
    assert.equal((await f.request("auth/admin/accounts", {}, linked.cookie, { "X-River-Account": owner._id })).status, 409);
    const adminHeader = { "X-River-Account": admin._id };
    assert.equal((await f.request("auth/admin/accounts", {}, linked.cookie, adminHeader)).status, 200);
    const back = await f.request("auth/switch-account", {}, linked.cookie, adminHeader);
    assert.equal(back.data.user.id, owner._id);
    assert.equal(back.data.accountSwitch.mode, "switch");
    const ownerHeader = { "X-River-Account": owner._id };
    assert.equal((await f.request("auth/admin/accounts", {}, back.cookie, ownerHeader)).status, 403);
    const races = await Promise.all([
      f.request("auth/switch-account", {}, back.cookie, ownerHeader),
      f.request("auth/switch-account", {}, back.cookie, ownerHeader),
    ]);
    assert.equal(races.filter(result => result.status === 200).length, 1);
    assert.ok(races.every(result => [200, 401, 409].includes(result.status)));
    const secondAdmin = races.find(result => result.status === 200);
    f.advance(12 * 60 * 60000);
    assert.equal((await f.request("auth/admin/accounts", {}, secondAdmin.cookie, adminHeader)).status, 401);
  } finally {
    await f.close();
  }
});

test("Manual codes stay admin-only and expire at ten minutes before approval, restriction and deletion", async () => {
  const f = await fixture();
  try {
    f.delivery.config.manualChannels = ["email"];
    const passwordHash = await hashPassword(password);
    const admin = await f.store.createUser({
      username: "admin", usernameKey: "admin", role: "admin", passwordHash, accountApprovedAt: new Date(),
    });
    const adminLogin = await f.login("admin");
    const pending = await f.register();
    const list = () => f.request("auth/admin/accounts", {}, adminLogin.cookie);
    const action = (userId, action, confirmUsername) => f.request("auth/admin/account-action", {
      userId, action, confirmUsername,
    }, adminLogin.cookie);
    assert.equal((await f.request("auth/admin/accounts", {}, pending.cookie)).status, 401);
    let account = (await list()).data.accounts.find(a => a.username === "Alice");
    assert.equal(account.verification.code, f.messages.at(-1).code);
    assert.equal(account.canApprove, false);
    assert.equal((await action(account.id, "approve")).status, 409);
    const row = await f.store.getUser(account.id);
    assert.notEqual(row.verificationCiphertext, account.verification.code);
    f.advance(600000);
    account = (await list()).data.accounts.find(a => a.username === "Alice");
    assert.equal(account.verification.code, null);
    assert.equal(account.canApprove, true);
    assert.equal((await action(account.id, "approve")).status, 200);
    const login = await f.login("Alice");
    assert.equal(login.data.user.manuallyApproved, true);
    assert.equal(login.data.user.emailVerified, false);
    assert.equal((await f.request("auth/switch-account", { adminPassword: password }, login.cookie)).status, 403);
    assert.equal((await action(account.id, "restrict")).status, 200);
    assert.equal((await f.request("capabilities", undefined, login.cookie)).data.code, "ACCOUNT_RESTRICTED");
    assert.equal((await action(account.id, "unrestrict")).status, 200);
    assert.equal((await f.request("capabilities", undefined, login.cookie)).status, 200);
    assert.equal((await action(admin._id, "delete", "admin")).status, 403);
    assert.equal((await action(account.id, "delete", "wrong")).status, 400);
    assert.equal((await action(account.id, "delete", "Alice")).status, 200);
    assert.equal((await f.request("capabilities", undefined, login.cookie)).status, 401);
  } finally {
    await f.close();
  }
});
