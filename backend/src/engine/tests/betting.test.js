const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { replayBetting: r } = require("../betting");
const { runEquitySimulation } = require("../engine");
const { ValidationError } = require("../errors");
const app = require("./support/app");
const Spot = require("../../models/Spot");
const config = (stacks = [100, 100], gameType = "holdem") => ({
  seats: stacks.map((startingStack, id) => ({ id, startingStack })),
  dealerSeatId: 0,
  smallBlind: 1,
  bigBlind: 2,
  gameType,
});
const call = (id) => ({ type: "call", seatId: id });
const check = (id) => ({ type: "check", seatId: id });
const raise = (id, amount) => ({ type: "raise", seatId: id, amount });
const bet = (id, amount) => ({ type: "bet", seatId: id, amount });
const fold = (id) => ({ type: "fold", seatId: id });
const allin = (id) => ({ type: "allin", seatId: id });
const advance = { type: "advance" };
const flop = [call(0), check(1), advance];
function balance(c, s) {
  assert.equal(
    Math.round(
      (s.players.reduce((sum, p) => sum + p.remaining, 0) + s.pot) * 100,
    ),
    Math.round(c.seats.reduce((sum, p) => sum + p.startingStack, 0) * 100),
  );
}

test("Blinds open heads-up action and preserve the big blind option", () => {
  const c = config();
  let s = r(c);
  assert.equal(s.actorSeatId, 0);
  assert.equal(s.pot, 3);
  assert.equal(s.legal.toCall, 1);
  s = r(c, [call(0)]);
  assert.equal(s.actorSeatId, 1);
  assert.equal(s.legal.canCheck, true);
  assert.equal(s.legal.minRaiseTo, 4);
  s = r(c, [call(0), check(1)]);
  assert.equal(s.roundClosed, true);
  assert.equal(s.pot, 4);
  balance(c, s);
});
test("Three-handed and sparse seats follow correct action order", () => {
  const c = config([100, 100, 100]);
  assert.equal(r(c).actorSeatId, 0);
  assert.equal(r(c, [call(0)]).actorSeatId, 1);
  assert.equal(r(c, [call(0), call(1)]).actorSeatId, 2);
  const sparse = {
    ...config(),
    seats: [
      { id: 1, startingStack: 100 },
      { id: 8, startingStack: 100 },
    ],
    dealerSeatId: 8,
  };
  assert.equal(r(sparse).actorSeatId, 8);
});
for (const [label, actions, count] of [
  ["out of turn", [call(1)], 0],
  ["check facing bet", [check(0)], 0],
  ["bet instead of raise", [bet(0, 5)], 0],
  ["non-all-in underraise", [raise(0, 3)], 0],
  ["negative amount", [raise(0, -1)], 0],
  ["excess precision", [raise(0, 4.001)], 0],
  ["over stack", [raise(0, 101)], 0],
  ["premature advance", [advance], 3],
  ["missing flop", [call(0), check(1), advance], 0],
  ["fold without facing bet", [call(0), fold(1)], 0],
  ["call without bet", [call(0), call(1)], 0],
  ["unknown action", [{ type: "dance", seatId: 0 }], 0],
  ["extra call amount", [{ ...call(0), amount: 1 }], 0],
])
  test(`Rejects ${label}`, () =>
    assert.throws(() => r(config(), actions, count), ValidationError));
test("Preflop raises use total street commitments and full raise increments", () => {
  const s = r(config(), [raise(0, 6)]);
  assert.equal(s.pot, 8);
  assert.equal(s.legal.toCall, 4);
  assert.equal(s.lastFullRaise, 4);
  assert.equal(s.legal.minRaiseTo, 10);
  assert.equal(s.players[0].remaining, 94);
});
test("Postflop begins out of position with a new minimum opening bet", () => {
  const s = r(config(), flop, 3);
  assert.equal(s.street, "flop");
  assert.equal(s.actorSeatId, 1);
  assert.equal(s.pot, 4);
  assert.equal(s.currentBet, 0);
  assert.equal(s.legal.minRaiseTo, 2);
});
test("Uncalled wager is refunded when all opponents can only make short calls", () => {
  const c = config([100, 10]);
  const s = r(c, [raise(0, 50), allin(1)]);
  assert.equal(s.roundClosed, true);
  assert.equal(s.pot, 20);
  assert.equal(s.players[0].remaining, 90);
  assert.ok(
    s.log.some((entry) => entry.type === "refund" && entry.amount === 40),
  );
  balance(c, s);
});
test("Short forced blinds refund uncalled excess before all-in runout", () => {
  const c = config([0.5, 100]);
  const s = r(c);
  assert.equal(s.roundClosed, true);
  assert.equal(s.pot, 1);
  assert.equal(s.players[1].remaining, 99.5);
  balance(c, s);
});
test("A last non-all-in player can call an outstanding short blind but cannot raise alone", () => {
  const s = r(config([100, 1.5]));
  assert.equal(s.legal.toCall, 0.5);
  assert.equal(s.legal.canRaise, false);
  assert.equal(s.legal.canAllIn, false);
  const closed = r(config([100, 1.5]), [call(0)]);
  assert.equal(closed.pot, 3);
});
test("Fold awards the gross pot to the sole live hand and conserves chips", () => {
  const c = config();
  const s = r(c, [fold(0)]);
  assert.equal(s.status, "uncontested");
  assert.equal(s.winnerSeatId, 1);
  assert.equal(s.pot, 0);
  assert.equal(s.award, 3);
  assert.deepEqual(
    s.players.map((p) => p.remaining),
    [99, 101],
  );
  assert.equal(s.actorSeatId, null);
  balance(c, s);
  assert.throws(() => r(c, [fold(0), call(1)]), ValidationError);
});
test("One short all-in does not reopen an already-faced full wager", () => {
  const c = config([100, 100, 12]);
  const a = [raise(0, 10), call(1), allin(2)];
  const s = r(c, a);
  assert.equal(s.actorSeatId, 0);
  assert.equal(s.legal.toCall, 2);
  assert.equal(s.legal.canRaise, false);
  assert.throws(
    () => r(c, [...a, raise(0, 20)]),
    /not currently available|not reopened/,
  );
  const end = r(c, [...a, call(0), call(1)]);
  assert.equal(end.pot, 36);
  assert.equal(end.roundClosed, true);
});
test("Cumulative short all-ins reopen betting when a full raise is faced", () => {
  const c = config([16, 100, 100, 12]);
  const a = [raise(3, 10), call(0), allin(1)];
  // Explicit sparse setup: A seat3 opens10, seat0 short-shoves12, seat1 short-shoves18, seat2 calls18; A now faces8, its last full raise.
  const c2 = config([12, 18, 100, 100]);
  const moves = [raise(3, 10), allin(0), allin(1), call(2)];
  const s = r(c2, moves);
  assert.equal(s.actorSeatId, 3);
  assert.equal(s.lastFullRaise, 8);
  assert.equal(s.legal.canRaise, true);
  assert.equal(s.legal.minRaiseTo, 26);
});
test("A postflop check does not prevent a raise against a later opening bet", () => {
  const s = r(config(), [...flop, check(1), bet(0, 4)], 3);
  assert.equal(s.actorSeatId, 1);
  assert.equal(s.legal.canRaise, true);
  assert.equal(s.legal.minRaiseTo, 8);
});
test("Omaha pot limit caps the opening raise at seven with 1/2 blinds", () => {
  const c = config([100, 100, 100], "omaha");
  const s = r(c);
  assert.equal(s.legal.maxRaiseTo, 7);
  assert.equal(s.legal.canAllIn, false);
  assert.throws(() => r(c, [raise(0, 8)]), /pot-limit/);
  assert.equal(r(c, [raise(0, 7)]).legal.maxRaiseTo, 23);
});
test("Pot-limit preflop calculation assumes both blinds were posted in full", () => {
  const s = r(config([100, 0.5, 100], "omaha"));
  assert.equal(s.pot, 2.5);
  assert.equal(s.legal.maxRaiseTo, 7);
  const bbShort = r(config([100, 100, 1], "omaha"));
  assert.equal(bbShort.legal.maxRaiseTo, 7);
});
test("Pot-limit postflop uses the actual pot", () => {
  const c = config([100, 100], "omaha");
  const s = r(c, flop, 3);
  assert.equal(s.legal.maxRaiseTo, 4);
  const response = r(c, [...flop, bet(1, 4)], 3);
  assert.equal(response.legal.maxRaiseTo, 16);
});
test("All-in calls are capped at the remaining stack", () => {
  const c = config([100, 8]);
  const s = r(c, [raise(0, 20)]);
  assert.equal(s.legal.toCall, 6);
  assert.equal(s.legal.fullToCall, 18);
  assert.equal(r(c, [raise(0, 20), call(1)]).pot, 16);
});
test("Multiple all-ins produce contribution layers and no premature chip awards", () => {
  const c = config([10, 20, 100]);
  const s = r(c, [allin(0), allin(1), call(2)]);
  assert.equal(s.pot, 50);
  assert.equal(s.roundClosed, true);
  assert.deepEqual(
    s.pots.map((p) => p.amount),
    [30, 20],
  );
  assert.deepEqual(s.pots[1].eligibleSeatIds, [1, 2]);
  balance(c, s);
});
test("Runouts advance street by street and reach showdown without extra betting", () => {
  const c = config([10, 10]);
  const a = [allin(0), call(1), advance, advance, advance];
  const s = r(c, a, 5);
  assert.equal(s.status, "showdown");
  assert.equal(s.street, "river");
  assert.equal(s.pot, 20);
  assert.equal(s.actorSeatId, null);
  assert.throws(() => r(c, [...a, advance], 5), ValidationError);
});
test("Decimal chips conserve exactly at cent precision", () => {
  const c = { ...config([1.23, 2.34]), smallBlind: 0.1, bigBlind: 0.2 };
  const s = r(c, [raise(0, 0.55), call(1)]);
  assert.equal(s.pot, 1.1);
  balance(c, s);
});
test("Undo via prefix replay restores action, pot and stacks without mutating inputs", () => {
  const c = config();
  const a = [raise(0, 6), call(1)];
  const copy = structuredClone(a);
  const before = r(c, a.slice(0, -1));
  assert.equal(before.actorSeatId, 1);
  assert.equal(before.pot, 8);
  assert.deepEqual(a, copy);
  assert.equal(r(c, []).pot, 3);
});
test("Folded specific hands remain blockers but cannot win showdown equity", () => {
  const value = runEquitySimulation(
    [
      ["Ah", "Ac"],
      ["Kh", "Kc"],
      ["Qh", "Qc"],
    ],
    ["2s", "3d", "7h", "8c", "9s"],
    "holdem",
    1,
    { eligibleIndices: [1, 2] },
  );
  assert.deepEqual(value.results, [
    { playerIndex: 0, equity: 0 },
    { playerIndex: 1, equity: 100 },
    { playerIndex: 2, equity: 0 },
  ]);
});
test("Random legal histories preserve chips and browser/server replay agrees", async () => {
  const browser = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../../frontend/src/lib/betting.js"),
    ).href
  );
  let seed = 37;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let sample = 0; sample < 120; sample++) {
    const c = config(
      Array.from(
        { length: 2 + (sample % 8) },
        () => 10 + Math.floor(random() * 100),
      ),
      sample % 2 ? "omaha" : "holdem",
    );
    let a = [];
    for (let step = 0; step < 80; step++) {
      const s = r(c, a, 5);
      balance(c, s);
      assert.deepEqual(browser.replayBetting(c, a, 5), s);
      if (s.status !== "playing") break;
      if (s.roundClosed) {
        a.push(advance);
        continue;
      }
      const l = s.legal;
      const choices = [l.canCheck ? check(s.actorSeatId) : call(s.actorSeatId)];
      if (l.canFold) choices.push(fold(s.actorSeatId));
      if (l.canRaise)
        choices.push({
          type: s.currentBet ? "raise" : "bet",
          seatId: s.actorSeatId,
          amount: Math.min(l.minRaiseTo, l.maxRaiseTo),
        });
      if (l.canAllIn) choices.push(allin(s.actorSeatId));
      a.push(choices[Math.floor(random() * choices.length)]);
    }
  }
});
test("API replays saved history, rejects forged pots and keeps new metadata on the model", async (context) => {
  let saved;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    return this;
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const tableState = {
      seats: [
        {
          id: 0,
          name: "A",
          stack: 100,
          startingStack: 100,
          cards: ["Ah", "Ac"],
        },
        {
          id: 1,
          name: "B",
          stack: 100,
          startingStack: 100,
          cards: ["Kh", "Kc"],
        },
      ],
      heroSeatId: 0,
      bigBlind: 2,
      handSetup: { dealerSeatId: 0, smallBlind: 1 },
      betting: { actions: [call(0), check(1), advance, check(1), bet(0, 4)] },
    };
    const payload = {
      players: [
        ["Ah", "Ac"],
        ["Kh", "Kc"],
      ],
      board: ["2s", "3d", "7h"],
      gameType: "holdem",
      iterations: 2,
      potSize: 8,
      callAmount: 4,
      saveSpot: true,
      tableState,
    };
    const post = (body) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    let response = await post(payload);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).bettingState.actorSeatId, 1);
    assert.deepEqual(
      saved.tableState.betting.actions,
      tableState.betting.actions,
    );
    assert.equal(
      new Spot(saved).toObject().tableState.betting.actions.length,
      5,
    );
    assert.equal((await post({ ...payload, potSize: 999 })).status, 400);
    assert.equal((await post({ ...payload, board: [] })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("A short all-in opening is raised by the minimum increment, not completed as a limit bet", () => {
  const c = config([100, 3, 100]);
  const moves = [call(0), call(1), check(2), advance, allin(1)];
  const s = r(c, moves, 3);
  assert.equal(s.currentBet, 1);
  assert.equal(s.legal.minRaiseTo, 3);
  const raised = r(c, [...moves, raise(2, 3)], 3);
  assert.equal(raised.lastFullRaise, 2);
  assert.equal(raised.legal.minRaiseTo, 5);
});
test("Players who checked can raise a later short opening all-in", () => {
  const c = config([100, 100, 3]);
  const moves = [
    call(0),
    call(1),
    check(2),
    advance,
    check(1),
    allin(2),
    call(0),
  ];
  const s = r(c, moves, 3);
  assert.equal(s.actorSeatId, 1);
  assert.equal(s.legal.canRaise, true);
  assert.equal(s.legal.minRaiseTo, 3);
});
test("The ledger rejects unrepresentable precision and excessive histories", () => {
  assert.throws(() => r(config([100.001, 100])), ValidationError);
  assert.throws(() => r(config(), Array(513).fill(call(0))), ValidationError);
});
