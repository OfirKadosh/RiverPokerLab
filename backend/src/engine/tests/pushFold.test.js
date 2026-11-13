const assert = require("node:assert/strict");
const { once } = require("node:events");
const { test } = require("node:test");
const { analyzePushFold } = require("../pushFold");
const { createPreviewApp } = require("../../dev/preview");

const headsUp = {
  players: [{ name: "Button", stack: 1000 }, { name: "Big blind", stack: 1000 }],
  hero: 0, dealer: 0, smallBlind: 50, bigBlind: 100, ante: 10,
  payouts: [100], samples: 30, seed: 123, hand: ["As", "Ah"],
};

test("Uncalled shoves refund unmatched chips and folding awards the forced bets", () => {
  const { rows: [row] } = analyzePushFold(headsUp);
  assert(Math.abs(row.aggressive.chips - 110) < 1e-9);
  assert(Math.abs(row.fold.chips + 60) < 1e-9);
  assert(Math.abs(row.chipDelta - 170) < 1e-9);
  assert(Math.abs(row.prizeDelta - 8.5) < 1e-9);
  assert.equal(row.recommendation, "push");
});

test("Observed shoves condition cards, skip prior folders and retain outside tournament stacks", () => {
  const input = {
    ...headsUp,
    players: [
      { name: "Shove", stack: 400, pushRange: "AhAd" },
      { name: "Already folded", stack: 800, callRange: "random" },
      { name: "Hero", stack: 1000 },
    ],
    hero: 2, shover: 0, payouts: [65, 35], outsidePlayers: [{ name: "Other table", stack: 1600 }],
    hand: ["As", "Kh"],
  };
  const first = analyzePushFold(input);
  assert.deepEqual(first, analyzePushFold({
    ...input, players: input.players.map((p, i) => i === 1 ? { ...p, callRange: "" } : p),
  }));
  assert.equal(first.action, "call");
  assert(Math.abs(first.rows[0].fold.chips + 110) < 1e-9);
  assert.throws(() => analyzePushFold({ ...input, hand: ["Ah", "Kh"] }), /block every combo/);
  const matrix = analyzePushFold({ ...input, hand: undefined });
  assert.equal(matrix.rows.length + matrix.blockedHands.length, 169);
});

test("Nine players with unequal stacks and multiple callers conserve chips in winner-take-all ICM", () => {
  const input = {
    ...headsUp, hand: ["Qs", "Qh"], hero: 3,
    players: Array.from({ length: 9 }, (_, i) => ({
      name: `Player ${i + 1}`, stack: 450 + 95 * i, callRange: "random",
    })),
  };
  const [row] = analyzePushFold(input).rows;
  const total = input.players.reduce((sum, player) => sum + player.stack, 0);
  assert(Math.abs(row.chipDelta * 100 / total - row.prizeDelta) < 1e-9);
  assert(row.confidence95[0] <= row.prizeDelta && row.confidence95[1] >= row.prizeDelta);
});

test("Four-player bubble with multiple callers separates chip EV and prize EV", () => {
  const input = {
    ...headsUp, hero: 3, hand: ["Qs", "Qh"],
    players: [
      { name: "Button", stack: 1300, callRange: "random" },
      { name: "Small blind", stack: 900, callRange: "random" },
      { name: "Big blind", stack: 2000, callRange: "random" },
      { name: "Hero", stack: 1800 },
    ],
    payouts: [50, 30, 20], samples: 240,
  };
  const [row] = analyzePushFold(input).rows;
  assert(row.chipDelta > 0);
  assert(row.prizeDelta < row.chipDelta * 100 / 6000);
});

test("The portable API client runs the real preview worker and receives input errors", async (t) => {
  const app = createPreviewApp({ NODE_ENV: "development" });
  const server = app.listen(0, "127.0.0.1");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  await once(server, "listening");
  const { createApiClient } = require("@river-poker-lab/core");
  const client = createApiClient({ baseUrl: `http://127.0.0.1:${server.address().port}/api` });
  const { capabilities } = await client.capabilities();
  assert.equal(capabilities.icm.pushFold.evaluation, "fixed-response-policy");
  const result = await client.analyzePushFold(headsUp);
  assert.deepEqual(result.analysis, analyzePushFold(headsUp));
  await assert.rejects(client.analyzePushFold({ ...headsUp, hero: 1 }), { status: 400 });
});
