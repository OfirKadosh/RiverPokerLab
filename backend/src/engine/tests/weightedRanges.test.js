const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const {
  parseWeightedRange,
  normalizeRangeInput,
  effectiveRange,
  previewWeightedRange,
  comboKey,
} = require("../weightedRanges");
const { runEquitySimulation, evaluatePlayer } = require("../engine");
const { createJointSampler } = require("../rangeSampler");
const { cardFromString } = require("../card");
const { validateSimulationInput } = require("../validation");
const { validateTableState } = require("../tableState");
const { replayBetting } = require("../betting");
const { validateTournament } = require("../tournament");
const { analyzeClosingCall } = require("../analysis");
const { ValidationError } = require("../errors");
const Spot = require("../../models/Spot");
const app = require("./support/app");
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const mass = (r) => r.entries.reduce((sum, e) => sum + e.weight, 0);
const rng =
  (seed = 47) =>
  () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
const board = ["2c", "3d", "4h", "8s", "9c"];
test("Weighted classes expand into physical combos and suit-specific last overrides round-trip", () => {
  const pairs = parseWeightedRange("TT+@25%");
  assert.equal(pairs.entries.length, 30);
  near(mass(pairs), 7.5);
  const r = parseWeightedRange("AA@50%, AhAc@100%, AdAs@0%");
  assert.equal(r.entries.length, 5);
  near(mass(r), 3);
  const round = parseWeightedRange(r.canonicalRange);
  assert.deepEqual(
    new Map(round.entries.map((e) => [comboKey(e.cards), e.weight])),
    new Map(r.entries.map((e) => [comboKey(e.cards), e.weight])),
  );
  const alias = parseWeightedRange("aHkD@12.5%");
  assert.equal(alias.entries.length, 1);
  near(alias.entries[0].weight, 0.125);
});
for (const text of [
  "AA@101%",
  "AA@-1%",
  "AA@NaN%",
  "AA@50",
  "AA@1e2%",
  "AA@12.345%",
  "AhAh@50%",
  "AA@0%",
  "random, AA",
  "AA,,KK",
  "",
  null,
  {},
  "AA@Infinity%",
])
  test(`Weighted ranges reject ${JSON.stringify(text)}`, () =>
    assert.throws(() => parseWeightedRange(text), ValidationError));
test("Observed action is Bayes conditioning of base frequencies, not replacement", () => {
  const input = normalizeRangeInput({
    range: "AA@50%, KK",
    actionRanges: { raise: "AA@75%, KK@25%", call: "AA@25%, KK@75%" },
    rangeAction: "call",
  });
  const result = effectiveRange(input);
  assert.ok(result.entries.some((entry) => entry.weight === 0.125));
  near(mass(result), 6 * 0.5 * 0.25 + 6 * 0.75);
  assert.equal(Object.keys(input.actionRanges)[0], "call");
  const p = previewWeightedRange(input, ["Ah"]);
  assert.equal(p.effectiveAvailableCombos, 9);
  near(p.availableMass, 3 * 0.125 + 6 * 0.75);
  near(p.knownCardActionFrequency, (3 * 0.125 + 6 * 0.75) / (3 * 0.5 + 6));
});
for (const [name, input] of [
  [
    "overlapping action mass",
    { range: "AA", actionRanges: { call: "AA@60%", raise: "AA@50%" } },
  ],
  ["unknown action", { range: "AA", rangeAction: "shove" }],
  ["missing action profile", { range: "AA", rangeAction: "call" }],
  [
    "disjoint selected action",
    { range: "AA", actionRanges: { call: "KK" }, rangeAction: "call" },
  ],
  ["array profiles", { range: "AA", actionRanges: [] }],
  ["unknown profile", { range: "AA", actionRanges: { dance: "AA" } }],
])
  test(`Action profiles reject ${name}`, () =>
    assert.throws(() => normalizeRangeInput(input), ValidationError));
test("Known blockers remove physical combos without freeing zero or blocked mass", () => {
  const p = previewWeightedRange("AA@50%, AhAc@100%", ["Ah"]);
  assert.equal(p.totalCombos, 6);
  assert.equal(p.availableCombos, 3);
  near(p.availableMass, 1.5);
  assert.equal(p.classWeights.AA, null);
  assert.ok(p.combos.some((c) => c.blocked && c.weight === 1));
});
test("Exhaustive weighted equity and payouts match a hand-computed river result without RNG", (context) => {
  context.mock.method(Math, "random", () => {
    throw Error("Exact must not draw");
  });
  const r = runEquitySimulation(
    [["Ah", "Ad"], { type: "range", range: "AA, KK@25%" }],
    board,
    "holdem",
    1,
    {
      method: "exact",
      pots: [{ amount: 20, eligibleIndices: [0, 1] }],
      chipUnit: 1,
      seatIds: [0, 1],
      dealerSeatId: 0,
    },
  );
  assert.equal(r.samples, 7);
  assert.equal(r.results[0].equity, 80);
  near(r.payouts[0].expectedPayout, 16);
  near(r.payouts[1].expectedPayout, 4);
  assert.equal(r.sampling, "weighted-combos-conditioned-on-no-collisions");
  const conditioned = runEquitySimulation(
    [
      ["Ah", "Ad"],
      {
        type: "range",
        range: "AA, KK",
        actionRanges: { call: "AA@25%, KK" },
        rangeAction: "call",
      },
    ],
    board,
    "holdem",
    1,
    { method: "exact" },
  );
  assert.equal(conditioned.results[0].equity, 98);
});
test("Two colliding weighted ranges agree with a separate Cartesian oracle and player permutation", () => {
  const inputs = [
    { type: "range", range: "AA@50%, KK" },
    { type: "range", range: "AA, KK@25%" },
  ];
  const lists = inputs.map((p) => parseWeightedRange(p.range).entries);
  let total = 0,
    wins = 0;
  for (const a of lists[0])
    for (const b of lists[1]) {
      if (new Set([...a.cards, ...b.cards]).size !== 4) continue;
      const w = a.weight * b.weight;
      total += w;
      const scores = [a, b].map((e) =>
        evaluatePlayer(e.cards, board.map(cardFromString), "holdem"),
      );
      wins +=
        w * (scores[0] > scores[1] ? 1 : scores[0] === scores[1] ? 0.5 : 0);
    }
  const r = runEquitySimulation(inputs, board, "holdem", 1, {
      method: "exact",
    }),
    swap = runEquitySimulation([...inputs].reverse(), board, "holdem", 1, {
      method: "exact",
    });
  near(r.results[0].equity, Number(((100 * wins) / total).toFixed(2)));
  assert.equal(r.results[0].equity, swap.results[1].equity);
});
test("Joint weighted rejection sampler targets product weights conditional on collisions", () => {
  const s = createJointSampler(
    [
      [
        [0, 1],
        [0, 2],
      ],
      [
        [1, 3],
        [4, 5],
      ],
    ],
    [],
    rng(),
    200000,
    [
      [1, 3],
      [2, 1],
    ],
  );
  const counts = {};
  for (let i = 0; i < 20000; i++) {
    const hands = s.draw(),
      key = hands.map((h) => h.join("-")).join("/");
    counts[key] = (counts[key] || 0) + 1;
  }
  near(counts["0-1/4-5"] / 20000, 0.1, 0.015);
  near(counts["0-2/1-3"] / 20000, 0.6, 0.015);
  near(counts["0-2/4-5"] / 20000, 0.3, 0.015);
});
test("Seeded Monte Carlo weighted range equity agrees with the exhaustive distribution", (context) => {
  context.mock.method(Math, "random", rng(8123));
  const r = runEquitySimulation(
    [["Ah", "Ad"], { type: "range", range: "AA, KK@25%" }],
    board,
    "holdem",
    20000,
    { method: "monteCarlo" },
  );
  near(r.results[0].equity, 80, 1.5);
});
test("Folded weighted range remains dead-card evidence but cannot win", () => {
  const r = runEquitySimulation(
    [
      { type: "range", range: "AA@50%" },
      { type: "range", range: "AA" },
    ],
    board,
    "holdem",
    1,
    { method: "exact", eligibleIndices: [1] },
  );
  assert.equal(r.samples, 6);
  assert.equal(r.results[0].equity, 0);
  assert.equal(r.results[1].equity, 100);
});
function decisionInput() {
  const raw = [
    ["Ah", "Ad"],
    {
      type: "range",
      range: "AA, KK@25%",
      actionRanges: { call: "AA@50%, KK@50%", raise: "AA@50%, KK@50%" },
      rangeAction: "call",
    },
  ];
  const players = validateSimulationInput(raw, board, "holdem", 1).players;
  const actions = [
    { type: "call", seatId: 0 },
    { type: "check", seatId: 1 },
    { type: "advance" },
    { type: "check", seatId: 1 },
    { type: "check", seatId: 0 },
    { type: "advance" },
    { type: "check", seatId: 1 },
    { type: "check", seatId: 0 },
    { type: "advance" },
    { type: "allin", seatId: 1 },
  ];
  const table = {
    seats: [
      { id: 0, name: "Hero", stack: 10, startingStack: 10, cards: raw[0] },
      {
        id: 1,
        name: "Villain",
        stack: 10,
        startingStack: 10,
        mode: "range",
        cards: [],
        range: players[1].range,
        actionRanges: players[1].actionRanges,
        rangeAction: "call",
      },
    ],
    heroSeatId: 0,
    bigBlind: 2,
    handSetup: { dealerSeatId: 0, smallBlind: 1 },
    betting: { actions },
  };
  const tableState = validateTableState(table, players, "holdem", board),
    bettingState = replayBetting(
      {
        seats: [
          { id: 0, startingStack: 10 },
          { id: 1, startingStack: 10 },
        ],
        dealerSeatId: 0,
        smallBlind: 1,
        bigBlind: 2,
        gameType: "holdem",
      },
      actions,
      5,
    );
  const tournament = validateTournament(
    {
      fieldConfirmed: true,
      eliminationRule: "starting-stack-split",
      tableSeats: [
        { seatId: 0, startingStack: 10 },
        { seatId: 1, startingStack: 10 },
      ],
      otherPlayers: [{ name: "Other", stack: 10 }],
      payouts: [50, 30, 20],
    },
    tableState,
    "tournament",
  );
  return {
    players,
    board,
    gameType: "holdem",
    gameMode: "tournament",
    iterations: 1,
    tableState,
    bettingState,
    tournament,
    settings: { method: "exact", chipUnit: 1 },
  };
}
test("Weighted exhaustive ICM weights monetary outcomes rather than physical state counts", () => {
  const r = analyzeClosingCall(decisionInput());
  assert.equal(r.samples, 7);
  near(r.icm.expectedCallPrize, 0.4 * (100 / 3) + 0.6 * (130 / 3));
  near(
    r.icm.outcomes.reduce((sum, o) => sum + o.probability, 0),
    1,
  );
  near(
    r.icm.players.reduce((sum, p) => sum + p.expectedCallPrize, 0),
    100,
  );
  near(r.callEV, 8);
  assert.ok(r.icm.outcomes.some((o) => Math.abs(o.probability - 0.6) < 1e-8));
});
test("API previews, canonical persistence, action conditioning and schema survive without MongoDB", async (context) => {
  let saved;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    return this;
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const post = async (path, body) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  try {
    const preview = await post("ranges/preview", {
      range: "AA@50%, AhAc",
      deadCards: ["Ah"],
    });
    assert.equal(preview.status, 200);
    near(preview.data.availableMass, 1.5);
    const p = decisionInput();
    const body = {
      ...p,
      players: p.players,
      potSize: p.bettingState.pot,
      callAmount: p.bettingState.legal.toCall,
      calculationMethod: "exact",
      chipUnit: 1,
      includeDecisionAnalysis: true,
      saveSpot: true,
    };
    delete body.settings;
    delete body.bettingState;
    const r = await post("calculate", body);
    assert.equal(r.status, 200);
    near(r.data.decisionAnalysis.icm.expectedCallPrize, 118 / 3);
    assert.equal(saved.playerInputs[1].rangeAction, "call");
    assert.ok(saved.playerInputs[1].actionRanges.raise);
    assert.equal(saved.tableState.seats[1].rangeAction, "call");
    assert.ok(saved.tableState.seats[1].actionRanges.call);
    const explicit = await post("analyze-decision", body);
    assert.equal(explicit.status, 200);
    near(
      explicit.data.analysis.icm.expectedCallPrize,
      r.data.decisionAnalysis.icm.expectedCallPrize,
    );
    const mismatch = structuredClone(body);
    mismatch.tableState.seats[1].rangeAction = "raise";
    assert.equal((await post("calculate", mismatch)).status, 400);
    const excessive = await post("ranges/preview", {
      range: "AA",
      actionRanges: { call: "AA@60%", raise: "AA@50%" },
    });
    assert.equal(excessive.status, 400);
    const big = await post("ranges/preview", { range: "x".repeat(2100000) });
    assert.equal(big.status, 413);
    assert.equal(big.data.success, false);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Monte Carlo weighted ICM agrees with exhaustive values and reports paired sampling error", (context) => {
  context.mock.method(Math, "random", rng(827));
  const p = decisionInput();
  p.settings.method = "monteCarlo";
  p.iterations = 5000;
  const result = analyzeClosingCall(p);
  assert.ok(result.icm.standardError > 0);
  near(result.icm.expectedCallPrize, 118 / 3, 5 * result.icm.standardError);
  near(
    result.icm.players.reduce(
      (sum, player) => sum + player.expectedCallPrize,
      0,
    ),
    100,
  );
});

test("Malformed configuration and profile fields on a specific hand are rejected", () => {
  for (const input of [null, undefined, [], 1])
    assert.throws(() => normalizeRangeInput(input), ValidationError);
  assert.throws(
    () =>
      validateSimulationInput(
        [
          { type: "hand", cards: ["Ah", "Ad"], rangeAction: "call" },
          ["Kh", "Kd"],
        ],
        [],
        "holdem",
        1,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      createJointSampler(
        [
          [
            [0, 1],
            [2, 3],
          ],
        ],
        [],
        rng(),
        100,
        [[Number.MAX_VALUE, Number.MAX_VALUE]],
      ),
    ValidationError,
  );
});
