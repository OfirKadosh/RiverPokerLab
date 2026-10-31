const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { calculateICM, validateICMInput } = require("../icm");
const { ValidationError } = require("../errors");
const app = require("./support/app");
const Spot = require("../../models/Spot");
const players = (stacks) =>
  stacks.map((stack, i) => ({ name: `P${i}`, stack }));
const close = (a, b, t = 1e-10) =>
  assert.ok(Math.abs(a - b) <= t, `${a} != ${b}`);
const valid = () => ({
  players: players([5000, 3000, 2000]),
  payouts: [50, 30, 20],
});
test("Three-player ICM matches hand-worked probabilities and prize values", () => {
  const r = calculateICM(valid());
  close(r.results[0].finishProbabilities[0], 1 / 2);
  close(r.results[0].finishProbabilities[1], 19 / 56);
  close(r.results[0].finishProbabilities[2], 9 / 56);
  close(r.results[0].prizeEquity, 38.39285714285714);
  close(r.results[1].prizeEquity, 32.75);
  close(r.results[2].prizeEquity, 28.857142857142858);
  close(r.totalPrize, 100);
  close(r.totalChips, 10000);
});
test("Heads-up includes guaranteed second-place prize", () => {
  const r = calculateICM({ players: players([75, 25]), payouts: [70, 30] });
  close(r.results[0].prizeEquity, 60);
  close(r.results[1].prizeEquity, 40);
});
test("Winner-take-all equals chip-proportional prize equity", () => {
  const r = calculateICM({
    players: players([11, 7, 3, 1]),
    payouts: [123.45],
  });
  assert.deepEqual(r.payouts, [123.45, 0, 0, 0]);
  for (const p of r.results) close(p.prizeEquity, p.proportionalPrize);
});
test("Equal stacks are symmetric and flat prizes give every player the same value", () => {
  for (let n = 2; n <= 9; n++) {
    const r = calculateICM({
      players: players(Array(n).fill(100)),
      payouts: [100, 50],
    });
    for (const p of r.results) {
      close(p.prizeEquity, 150 / n);
      for (const q of p.finishProbabilities) close(q, 1 / n);
    }
    const flat = calculateICM({
      players: players(Array.from({ length: n }, (_, i) => i + 1)),
      payouts: Array(n).fill(12.34),
    });
    for (const p of flat.results) close(p.prizeEquity, 12.34);
  }
});
function brute(stacks, payouts) {
  const finish = stacks.map(() => Array(stacks.length).fill(0));
  function walk(remaining, place, mass) {
    if (!remaining.length) return;
    const total = remaining.reduce((s, i) => s + stacks[i], 0);
    for (const i of remaining) {
      const p = (mass * stacks[i]) / total;
      finish[i][place] += p;
      walk(
        remaining.filter((j) => j !== i),
        place + 1,
        p,
      );
    }
  }
  walk(
    stacks.map((_, i) => i),
    0,
    1,
  );
  return finish.map((row) => ({
    row,
    value: row.reduce((s, p, i) => s + p * (payouts[i] || 0), 0),
  }));
}
test("Subset algorithm matches independent permutation oracle for five unequal stacks", () => {
  const stacks = [130, 70, 43, 11, 2],
    payouts = [100, 60, 20],
    expected = brute(stacks, payouts),
    r = calculateICM({ players: players(stacks), payouts });
  r.results.forEach((p, i) => {
    close(p.prizeEquity, expected[i].value);
    p.finishProbabilities.forEach((q, j) => close(q, expected[i].row[j]));
  });
});
test("Nine disparate stacks conserve prizes and normalize every finish row and column", () => {
  const r = calculateICM({
    players: players([
      0.01, 1, 3.14, 100, 1000, 5000, 12345, 1000000, 1000000000000,
    ]),
    payouts: [1000.01, 500, 200, 50, 20, 10, 5, 2, 1],
  });
  for (const p of r.results) {
    close(
      p.finishProbabilities.reduce((a, b) => a + b, 0),
      1,
    );
    assert.ok(Number.isFinite(p.prizeEquity));
  }
  for (let j = 0; j < 9; j++)
    close(
      r.results.reduce((s, p) => s + p.finishProbabilities[j], 0),
      1,
    );
  close(
    r.results.reduce((s, p) => s + p.prizeEquity, 0),
    r.totalPrize,
    1e-8,
  );
});
test("ICM preserves input order, stack scale invariance and original input", () => {
  const v = valid(),
    copy = structuredClone(v),
    r = calculateICM(v);
  assert.deepEqual(v, copy);
  const scaled = calculateICM({
      ...v,
      players: v.players.map((p) => ({ ...p, stack: p.stack * 13 })),
    }),
    reversed = calculateICM({ ...v, players: [...v.players].reverse() });
  r.results.forEach((p, i) => {
    close(scaled.results[i].prizeEquity, p.prizeEquity);
    close(reversed.results[2 - i].prizeEquity, p.prizeEquity);
    assert.equal(p.playerIndex, i);
  });
});
for (const [label, change] of [
  ["missing body", () => undefined],
  ["null body", () => null],
  ["array body", () => []],
  ["missing players", (v) => ({ ...v, players: undefined })],
  ["one player", (v) => ({ ...v, players: players([10]) })],
  ["ten players", (v) => ({ ...v, players: players(Array(10).fill(10)) })],
  ["null player", (v) => ({ ...v, players: [null, ...v.players.slice(1)] })],
  [
    "empty name",
    (v) => ({
      ...v,
      players: [{ name: " ", stack: 1 }, ...v.players.slice(1)],
    }),
  ],
  [
    "long name",
    (v) => ({
      ...v,
      players: [{ name: "x".repeat(41), stack: 1 }, ...v.players.slice(1)],
    }),
  ],
  ...[0, -1, Infinity, NaN, "100", null, 0.001, Number.MAX_SAFE_INTEGER].map(
    (stack) => [
      `bad stack ${String(stack)}`,
      (v) => ({ ...v, players: [{ name: "P", stack }, ...v.players.slice(1)] }),
    ],
  ),
  ["missing payouts", (v) => ({ ...v, payouts: undefined })],
  ["empty payouts", (v) => ({ ...v, payouts: [] })],
  ["too many payouts", (v) => ({ ...v, payouts: [50, 30, 20, 0] })],
  ["ascending payouts", (v) => ({ ...v, payouts: [20, 30] })],
  ["zero prizes", (v) => ({ ...v, payouts: [0, 0] })],
  ...[-1, Infinity, NaN, "50", null, 0.001, Number.MAX_SAFE_INTEGER].map(
    (prize) => [
      `bad prize ${String(prize)}`,
      (v) => ({ ...v, payouts: [prize] }),
    ],
  ),
  [
    "stack sum overflow",
    (v) => ({ ...v, players: players([60000000000000, 60000000000000]) }),
  ],
  [
    "prize sum overflow",
    (v) => ({ ...v, payouts: [60000000000000, 60000000000000] }),
  ],
])
  test(`ICM rejects ${label}`, () =>
    assert.throws(() => calculateICM(change(valid())), ValidationError));
test("Normalization trims names and pads unpaid places", () => {
  const r = validateICMInput({
    players: [
      { name: " Hero ", stack: 1 },
      { name: "Villain", stack: 1 },
    ],
    payouts: [1],
  });
  assert.equal(r.players[0].name, "Hero");
  assert.deepEqual(r.payouts, [1, 0]);
});
test("ICM API needs no cards or MongoDB and returns structured HTTP 400 errors", async (context) => {
  context.mock.method(Spot.prototype, "save", () => {
    throw Error("ICM must not write history");
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const post = async (body) => {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/icm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: r.status, data: await r.json() };
  };
  try {
    const r = await post(valid());
    assert.equal(r.status, 200);
    assert.equal(r.data.success, true);
    assert.equal(r.data.method, "exact-subset-dp");
    close(r.data.results[0].prizeEquity, 38.39285714285714);
    const invalid = await post({ ...valid(), payouts: [10, 20] });
    assert.equal(invalid.status, 400);
    assert.match(invalid.data.error, /highest to lowest/);
    assert.equal(
      (await post({ players: players([0, 10]), payouts: [10] })).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
