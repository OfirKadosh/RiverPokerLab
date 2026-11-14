const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const { createApiClient } = require("@river-poker-lab/core");
const { analyzeMultiway } = require("../multiway");
const { resolveTournamentOutcome } = require("../tournament");
const { createPreviewApp } = require("../../dev/preview");

const fixture = () => ({
  mode: "cash", board: ["2s", "7d", "Tc", "3c", "9c"], dealer: 0, samples: 200,
  sizes: [25], players: [
    { name: "Hero", input: ["Ah", "Ad"], invested: 20, behind: 100 },
    { name: "Seat 2", input: ["Kh", "Kd"], invested: 20, behind: 40, callFrequency: 1 },
    { name: "Short all-in", input: ["Qc", "Jc"], invested: 10, behind: 0 },
  ],
});
const close = (actual, expected) => assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("An all-in can win the main pot while Hero's bet earns a separate side pot", () => {
  const { actions: [check, bet] } = analyzeMultiway(fixture());
  close(check.chipEv, 20);
  close(bet.chipEv, 45);
  close(bet.delta, 25);
  assert.deepEqual(bet.interval95, [25, 25]);
});

test("A short call preserves the uncalled refund and both players' respective ICM payouts", () => {
  const input = fixture();
  input.mode = "tournament";
  input.players[0].behind = 10;
  input.players[1].invested = 45;
  input.players[1].behind = 15;
  delete input.sizes;
  input.facingBet = 25;
  input.tournament = { confirmed: true, payouts: [50, 30, 20], outsidePlayers: [{ name: "Outside", stack: 40 }] };
  const { actions: [fold, call] } = analyzeMultiway(input);
  close(fold.chipEv, 0);
  close(call.chipEv, 30);
  const starting = [30, 60, 10, 40];
  const prize = stacks => resolveTournamentOutcome(stacks, starting, [50, 30, 20, 0]).values[0];
  close(fold.prizeEv, prize([10, 60, 30, 40]));
  close(call.prizeEv, prize([40, 30, 30, 40]));
  close(call.delta, call.prizeEv - fold.prizeEv);
});

test("Weighted holdings and board runouts are deterministic for a supplied seed", () => {
  const input = fixture();
  input.board = input.board.slice(0, 3);
  input.players[1].input = { type: "range", range: "KK, QQ@25%" };
  assert.deepEqual(analyzeMultiway(input), analyzeMultiway(input));
  assert.throws(() => analyzeMultiway({ ...input, samples: 6001 }), /samples/);
  assert.throws(() => analyzeMultiway({ ...input, mode: "tournament" }), /confirm/i);
  input.players[1].invested = 21;
  assert.throws(() => analyzeMultiway(input), /equal commitments/);
});

test("A tied river uses dealer order when distributing an odd chip", () => {
  const input = fixture();
  input.board = ["As", "Ks", "Qs", "Js", "Ts"];
  input.players[0].invested = 1;
  input.players[1].invested = 1;
  input.players[2].invested = 1;
  input.players[2].input = ["9c", "8c"];
  input.players[1].callFrequency = 0;
  input.sizes = [1];
  close(analyzeMultiway(input).actions[1].chipEv, 1);
  close(analyzeMultiway({ ...input, dealer: 2 }).actions[1].chipEv, 2);
});

test("The preview API and portable client use the bounded worker", async (t) => {
  const server = createPreviewApp({ NODE_ENV: "development" }).listen(0, "127.0.0.1");
  t.after(() => new Promise(resolve => server.close(resolve)));
  await once(server, "listening");
  const client = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api` });
  assert.equal((await client.capabilities()).capabilities.multiway.enabled, true);
  const { analysis } = await client.analyzeMultiway(fixture());
  assert.deepEqual(analysis, analyzeMultiway(fixture()));
  await assert.rejects(client.analyzeMultiway({ ...fixture(), board: ["2s"] }), { status: 400 });
});
