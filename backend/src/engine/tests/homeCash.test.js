const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { once } = require("node:events");
const { test } = require("node:test");
const { createAuth } = require("../../auth");
const { hashPassword } = require("../../auth/security");
const { createApp } = require("../../server");
const { memoryHomeCashStore, mongoHomeCashStore } = require("../../homeCash/store");
const { createGame, applyCommand, publicGame } = require("../../homeCash/game");
const { MemoryAuthStore } = require("./support/authStore");

test("Balances fractional agorot and resolves rounding ties by player order", () => {
  const now = new Date();
  let game = createGame("owner", { id: randomUUID(), name: "Rounding", buyIn: 1, chipsPerBuyIn: 4 }, now);
  const act = (command) => {
    const id = randomUUID();
    game = applyCommand(game, { id, version: game.version, ...command }, now);
    return id;
  };
  const alice = act({ type: "add-player", name: "Alice" });
  const bob = act({ type: "add-player", name: "Bob" });
  const charlie = act({ type: "add-player", name: "Charlie" });
  for (const playerId of [alice, bob, charlie]) act({ type: "entry", playerId });
  assert.throws(() => act({ type: "close", stacks: { [alice]: 2, [bob]: 2, [charlie]: 4 } }), /does not balance/);
  act({ type: "close", stacks: { [alice]: 2, [bob]: 2, [charlie]: 8 } });
  assert.deepEqual(game.settlement.players.map(({ payout, profit }) => [payout, profit]), [[1, 0], [0, -1], [2, 1]]);
  assert.equal(game.settlement.collected, 3);
  assert.equal(game.settlement.issuedChips, 12);
  assert.throws(() => act({ type: "entry", playerId: alice }), /already closed/);
});

test("Settles mixed standard and custom buy-ins including old entries and corrections", () => {
  const now = new Date();
  let game = createGame("owner", {
    id: randomUUID(), name: "Variable buy-ins", buyIn: 5000, chipsPerBuyIn: 100,
  }, now);
  function act(command) {
    const operation = { id: randomUUID(), version: game.version, ...command };
    game = applyCommand(game, operation, now);
    return operation;
  }
  const dana = act({ type: "add-player", name: "Dana" }).id;
  const ron = act({ type: "add-player", name: "Ron" }).id;
  act({ type: "entry", playerId: dana });
  delete game.entries[0].amount;
  delete game.entries[0].chips;
  assert.equal(publicGame(game).entries[0].amount, 5000);
  assert.equal(publicGame(game).entries[0].chips, 100);
  assert.throws(() => act({ type: "entry", playerId: dana, amount: 2401 }), /whole chips/);
  assert.throws(() => act({ type: "entry", playerId: dana, amount: null }), /Enter a buy-in/);
  const rebuy = act({ type: "entry", playerId: dana, amount: 2500 });
  assert.equal(applyCommand(game, rebuy, now), game);
  assert.deepEqual(game.entries.map(({ kind, amount, chips }) => [kind, amount, chips]), [
    ["buy-in", undefined, undefined], ["rebuy", 2500, 50],
  ]);
  const mistake = act({ type: "entry", playerId: dana, amount: 7500 });
  act({ type: "void-entry", entryId: mistake.id });
  act({ type: "entry", playerId: ron });
  act({ type: "close", stacks: { [dana]: 190, [ron]: 60 } });
  assert.equal(game.settlement.collected, 12500);
  assert.equal(game.settlement.issuedChips, 250);
  assert.deepEqual(game.settlement.players.map(({ paid, payout, profit }) => [paid, payout, profit]), [
    [7500, 9500, 2000], [5000, 3000, -2000],
  ]);
});

test("Mongo updates compare the game version and scope replacement to its owner", async () => {
  const store = mongoHomeCashStore({
    async replaceOne(filter, next) {
      assert.deepEqual(filter, { _id: "game", ownerId: "owner", version: 3 });
      assert.deepEqual(next, { version: 4 });
      return { modifiedCount: 0 };
    },
  });
  assert.equal(await store.replace({ _id: "game", ownerId: "owner", version: 3 }, { version: 4 }), false);
});

test("HTTP flow resumes an owner's game and guards duplicate, concurrent, and cross-account requests", async (t) => {
  const accounts = new MemoryAuthStore();
  const password = "home cash test fixture password";
  const passwordHash = await hashPassword(password);
  for (const [index, username] of ["Alice", "Bobby"].entries()) {
    await accounts.createUser({
      username, usernameKey: username.toLowerCase(), email: `${username}@example.invalid`,
      phone: `+1555000000${index}`, passwordHash, accountApprovedAt: new Date(),
    });
  }
  const auth = createAuth({
    store: accounts,
    config: { secret: "test-only-home-cash-secret", origins: [], secure: false, cookieName: "river_session" },
    delivery: { config: { channels: ["email"] }, async send() {} },
  });
  const homeCashStore = memoryHomeCashStore();
  const server = createApp({ auth, homeCashStore }).listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = (path, cookie, body) => fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: { "X-Requested-With": "RiverPokerLab", "Content-Type": "application/json", ...(cookie && { Cookie: cookie }) },
    ...(body && { body: JSON.stringify(body) }),
  });
  async function login(username) {
    const response = await call("/auth/login", null, { identifier: username, password });
    assert.equal(response.status, 200);
    return response.headers.get("set-cookie").split(";")[0];
  }
  const path = "/home-cash";
  assert.equal((await call(path)).status, 401);
  const alice = await login("Alice");
  const bob = await login("Bobby");
  const newGame = { id: randomUUID(), name: "Friday poker", buyIn: 5000, chipsPerBuyIn: 100 };
  assert.equal((await call(path, alice, newGame)).status, 201);
  assert.equal((await call(path, alice, newGame)).status, 200);
  assert.equal((await call(path, alice, { ...newGame, id: randomUUID() })).status, 409);
  assert.equal((await (await call(path, bob)).json()).active, null);

  const actions = `${path}/${newGame.id}/actions`;
  let version = 0;
  async function act(command) {
    const id = randomUUID();
    const response = await call(actions, alice, { ...command, id, version });
    assert.equal(response.status, 200);
    const { game } = await response.json();
    version = game.version;
    return id;
  }
  await act({ type: "configure", name: "Friday poker", buyIn: 5000, chipsPerBuyIn: 100 });
  const first = await act({ type: "add-player", name: "Dana" });
  const second = await act({ type: "add-player", name: "Ron" });
  assert.equal((await call(actions, bob, { id: randomUUID(), version, type: "entry", playerId: first })).status, 404);
  const replay = { id: randomUUID(), version, type: "entry", playerId: first };
  const duplicate = await Promise.all([call(actions, alice, replay), call(actions, alice, replay)]);
  for (const response of duplicate) {
    assert.equal(response.status, 200);
    const { game } = await response.json();
    assert.equal(game.entries.length, 1);
    version = game.version;
  }
  assert.equal((await call(actions, alice, { ...replay, playerId: second })).status, 409);
  assert.equal((await call(actions, alice, { ...replay, id: randomUUID() })).status, 409);
  assert.equal((await call(actions, alice, { id: randomUUID(), version, type: "configure", name: "Updated", buyIn: 6000, chipsPerBuyIn: 100 })).status, 409);
  const extra = await act({ type: "entry", playerId: first });
  await act({ type: "void-entry", entryId: extra });
  await act({ type: "entry", playerId: first });
  await act({ type: "entry", playerId: second });

  const resumed = (await (await call(path, await login("Alice"))).json()).active;
  assert.equal(resumed.entries.length, 4);
  assert.equal(resumed.entries.filter(({ voided }) => !voided).length, 3);
  assert.equal((await call(actions, alice, { id: randomUUID(), version, type: "close", stacks: { [first]: 280, [second]: 0 } })).status, 400);
  await act({ type: "close", stacks: { [first]: 280, [second]: 20 } });
  const closed = await (await call(path, alice)).json();
  assert.equal(closed.active, null);
  assert.deepEqual(closed.recent.settlement.players.map(({ paid, payout, profit }) => [paid, payout, profit]), [
    [10000, 14000, 4000], [5000, 1000, -4000],
  ]);
  assert.equal((await (await call(path, bob)).json()).recent, null);

  const history = `${path}/history`;
  const details = `${history}/${newGame.id}`;
  assert.equal((await call(history)).status, 401);
  assert.equal((await call(details, bob)).status, 404);
  assert.equal((await call(`${history}?before=invalid`, alice)).status, 400);
  const saved = await (await call(details, alice)).json();
  assert.deepEqual(saved.game.settlement, closed.recent.settlement);
  assert.equal(saved.game.entries, undefined);
  assert.equal(saved.game.ownerId, undefined);
  const owner = [...accounts.users.values()].find((account) => account.username === "Alice");
  const older = [];
  for (let index = 0; index < 23; index += 1) {
    const id = randomUUID();
    const date = new Date("2025-01-01T12:00:00.000Z");
    await homeCashStore.insert({
      ...createGame(String(owner._id), { ...newGame, id }, date),
      status: "closed", settlement: closed.recent.settlement,
    });
    older.push(id);
  }
  const activeId = randomUUID();
  assert.equal((await call(path, alice, { ...newGame, id: activeId })).status, 201);
  assert.equal((await call(`${history}/${activeId}`, alice)).status, 404);
  const firstPage = await (await call(history, alice)).json();
  assert.equal(firstPage.games.length, 20);
  assert.equal(firstPage.games[0].id, newGame.id);
  assert(firstPage.next);
  const secondPage = await (await call(`${history}?before=${encodeURIComponent(firstPage.next)}`, alice)).json();
  assert.equal(secondPage.next, null);
  assert.deepEqual([...firstPage.games, ...secondPage.games].map((game) => game.id), [
    newGame.id, ...older.sort().reverse(),
  ]);
  assert.deepEqual((await (await call(history, bob)).json()).games, []);
});
