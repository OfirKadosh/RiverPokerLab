const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const {
  validateTournament,
  resolveTournamentOutcome,
} = require("../tournament");
const { analyzeClosingCall } = require("../analysis");
const { replayBetting } = require("../betting");
const { calculateICM } = require("../icm");
const { ValidationError } = require("../errors");
const app = require("./support/app");
const Spot = require("../../models/Spot");
const near = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
const initial = [
  { type: "call", seatId: 0 },
  { type: "call", seatId: 1 },
  { type: "check", seatId: 2 },
  { type: "advance" },
  { type: "check", seatId: 1 },
  { type: "check", seatId: 2 },
  { type: "check", seatId: 0 },
  { type: "advance" },
];
function scenario({
  stacks = [100, 100, 100],
  players = [
    ["9s", "9d"],
    ["Ah", "Kh"],
    ["5s", "6s"],
  ],
  board = ["Jh", "Th", "2c", "8s"],
  actions = [
    ...initial,
    { type: "allin", seatId: 1 },
    { type: "fold", seatId: 2 },
  ],
  hero = 0,
  otherPlayers = [],
  payouts = [50, 50, 0],
  method = "exact",
  iterations = 1,
} = {}) {
  const config = {
    seats: stacks.map((startingStack, id) => ({ id, startingStack })),
    dealerSeatId: 0,
    smallBlind: 1,
    bigBlind: 2,
    gameType: "holdem",
  };
  const tableState = {
    seats: stacks.map((stack, id) => ({
      id,
      name: `P${id}`,
      stack,
      startingStack: stack,
      cards: players[id],
    })),
    heroSeatId: hero,
    bigBlind: 2,
    handSetup: { dealerSeatId: 0, smallBlind: 1 },
    betting: { actions },
  };
  const raw = {
    fieldConfirmed: true,
    eliminationRule: "starting-stack-split",
    tableSeats: stacks.map((startingStack, seatId) => ({
      seatId,
      startingStack,
    })),
    otherPlayers,
    payouts,
  };
  return {
    players,
    board,
    gameType: "holdem",
    gameMode: "tournament",
    iterations,
    tableState,
    settings: { method, chipUnit: 1 },
    bettingState: replayBetting(config, actions, board.length),
    tournament: validateTournament(raw, tableState, "tournament"),
  };
}
test("Simultaneous eliminations rank by hand-start stacks and conserve all prizes", () => {
  const r = resolveTournamentOutcome([0, 0, 130], [10, 20, 100], [50, 30, 20]);
  assert.deepEqual(r.values, [20, 30, 50]);
  assert.deepEqual(
    r.awards.map((a) => a.playerIndex),
    [1, 0],
  );
  const tie = resolveTournamentOutcome([0, 0, 30], [10, 10, 10], [50, 30, 20]);
  assert.deepEqual(tie.values, [25, 25, 50]);
  assert.equal(tie.awards[0].firstPlace, 2);
  assert.equal(tie.awards[0].lastPlace, 3);
});
test("Elimination cash and surviving-player ICM include outside-table players without double-counting", () => {
  const r = resolveTournamentOutcome(
    [0, 0, 130, 50],
    [10, 20, 100, 50],
    [50, 30, 20, 0],
  );
  near(r.values[0], 0);
  near(r.values[1], 20);
  near(r.values[2], (130 / 180) * 50 + (50 / 180) * 30);
  near(
    r.values.reduce((a, b) => a + b, 0),
    100,
  );
  assert.throws(
    () => resolveTournamentOutcome([0, 0, 31], [10, 10, 10], [50, 30, 20]),
    ValidationError,
  );
});
test("Exact closing call can be profitable in chips and losing in ICM prize EV", () => {
  const result = analyzeClosingCall(scenario());
  assert.equal(result.samples, 42);
  assert.ok(result.callEV > 0);
  assert.equal(result.decision, "Call");
  assert.equal(result.icm.decision, "Fold");
  near(result.icm.expectedCallPrize, (24 / 42) * 50);
  assert.ok(result.icm.deltaCallVsFold < 0);
  assert.ok(result.icm.expectedFoldPrize > 0);
  assert.equal(result.icm.standardError, 0);
  assert.equal(result.icm.confidence95, null);
  const atMean = calculateICM({
    players: [
      { name: "P0", stack: 115.43 },
      { name: "P1", stack: 86.57 },
      { name: "P2", stack: 98 },
    ],
    payouts: [50, 50, 0],
  }).results[0].prizeEquity;
  assert.ok(Math.abs(atMean - result.icm.expectedCallPrize) > 1);
  const weighted = result.icm.outcomes.reduce(
    (sum, o) => sum + o.probability * o.heroCallValue,
    0,
  );
  near(weighted, result.icm.expectedCallPrize);
  for (const key of ["expectedCallPrize", "expectedFoldPrize"])
    near(
      result.icm.players.reduce((sum, p) => sum + p[key], 0),
      100,
    );
});
test("Side-pot outcomes are evaluated separately and Fold includes opponents showdown and possible eliminations", () => {
  const params = scenario({
    stacks: [10, 20, 100],
    players: [
      ["Ah", "Ac"],
      ["Kh", "Kc"],
      ["Qh", "Qc"],
    ],
    board: ["2s", "3d", "7h", "8c"],
    hero: 2,
    actions: [
      ...initial,
      { type: "check", seatId: 1 },
      { type: "check", seatId: 2 },
      { type: "allin", seatId: 0 },
      { type: "allin", seatId: 1 },
    ],
    payouts: [70, 30, 0],
  });
  const result = analyzeClosingCall(params);
  assert.equal(result.icm.available, true);
  assert.equal(result.icm.outcomeCount, 3);
  assert.ok(
    new Set(result.icm.outcomes.map((o) => o.heroFoldValue.toFixed(9))).size >
      1,
  );
  assert.ok(
    result.icm.outcomes.some(
      (o) => JSON.stringify(o.callStacks) === "[30,20,80]",
    ),
  );
  assert.ok(
    result.icm.outcomes.some((o) =>
      o.foldEliminations.some((a) => a.playerIndex === 0),
    ),
  );
  near(
    result.icm.outcomes.reduce(
      (sum, o) => sum + o.probability * o.heroFoldValue,
      0,
    ),
    result.icm.expectedFoldPrize,
  );
  for (const o of result.icm.outcomes) {
    near(
      o.callStacks.reduce((a, b) => a + b, 0),
      130,
    );
    near(
      o.foldStacks.reduce((a, b) => a + b, 0),
      130,
    );
  }
});
test("Other-table stack and prize configuration affect ICM without entering card simulation", () => {
  const params = scenario({
    otherPlayers: [{ name: "Outside", stack: 50 }],
    payouts: [50, 30, 20, 0],
  });
  const result = analyzeClosingCall(params);
  assert.equal(result.samples, 42);
  assert.equal(result.icm.players.length, 4);
  for (const o of result.icm.outcomes) {
    assert.equal(o.callStacks[3], 50);
    assert.equal(o.foldStacks[3], 50);
  }
  near(
    result.icm.players.reduce((sum, p) => sum + p.expectedCallPrize, 0),
    100,
  );
});
test("Paired Monte Carlo uncertainty is calculated from Call minus Fold on the same physical deal", (context) => {
  let seed = 123;
  context.mock.method(Math, "random", () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  });
  const r = analyzeClosingCall(
    scenario({ method: "monteCarlo", iterations: 2000 }),
  );
  const m = r.icm.deltaCallVsFold;
  const variance = r.icm.outcomes.reduce(
    (sum, o) => sum + o.count * (o.heroCallValue - o.heroFoldValue - m) ** 2,
    0,
  );
  near(r.icm.standardError, Math.sqrt(variance / (1999 * 2000)));
  near(r.icm.confidence95[0], m - 1.96 * r.icm.standardError);
  const single = analyzeClosingCall(
    scenario({ method: "monteCarlo", iterations: 1 }),
  );
  assert.equal(single.icm.decision, "Uncertain");
});
test("Missing tournament settings retain legacy chip analysis with an explicit ICM scope message", () => {
  const p = scenario();
  delete p.tournament;
  const r = analyzeClosingCall(p);
  assert.equal(r.available, true);
  assert.equal(r.icm.available, false);
  assert.match(r.icm.reason, /Apply complete/);
});
for (const [label, mutate] of [
  ["unconfirmed", (t) => ({ ...t, fieldConfirmed: false })],
  ["wrong elimination rule", (t) => ({ ...t, eliminationRule: "random" })],
  ["missing others", (t) => ({ ...t, otherPlayers: undefined })],
  [
    "changed seat",
    (t) => ({
      ...t,
      tableSeats: [{ seatId: 8, startingStack: 100 }, ...t.tableSeats.slice(1)],
    }),
  ],
  [
    "changed starting stack",
    (t) => ({
      ...t,
      tableSeats: [{ seatId: 0, startingStack: 99 }, ...t.tableSeats.slice(1)],
    }),
  ],
  [
    "too many remaining players",
    (t) => ({
      ...t,
      otherPlayers: Array(7).fill({ name: "Other", stack: 10 }),
    }),
  ],
  [
    "zero outside stack",
    (t) => ({ ...t, otherPlayers: [{ name: "Other", stack: 0 }] }),
  ],
  ["ascending prizes", (t) => ({ ...t, payouts: [10, 20] })],
  ["missing table seats", (t) => ({ ...t, tableSeats: undefined })],
])
  test(`Tournament settings reject ${label}`, () => {
    const p = scenario();
    assert.throws(
      () => validateTournament(mutate(p.tournament), p.tableState, p.gameMode),
      ValidationError,
    );
  });
test("Tournament settings require Tournament mode and table metadata", () => {
  const p = scenario();
  assert.throws(
    () => validateTournament(p.tournament, p.tableState, "cash"),
    ValidationError,
  );
  assert.throws(
    () => validateTournament(p.tournament, undefined, "tournament"),
    ValidationError,
  );
});
test("Tournament API saves/restores normalized configuration and ICM results without MongoDB", async (context) => {
  let saved;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    return this;
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const p = scenario();
  const body = {
    players: p.players,
    board: p.board,
    gameType: p.gameType,
    gameMode: p.gameMode,
    iterations: 1,
    tableState: p.tableState,
    potSize: p.bettingState.pot,
    callAmount: p.bettingState.legal.toCall,
    calculationMethod: "exact",
    chipUnit: 1,
    tournament: p.tournament,
    saveSpot: true,
    includeDecisionAnalysis: true,
  };
  const post = async (path, input) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/${path}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    );
    return { status: response.status, data: await response.json() };
  };
  try {
    const r = await post("calculate", body);
    assert.equal(r.status, 200);
    assert.equal(r.data.decisionAnalysis.icm.decision, "Fold");
    assert.equal(saved.tournament.eliminationRule, "starting-stack-split");
    assert.deepEqual(saved.tournament.payouts, [50, 50, 0]);
    assert.equal(saved.decisionAnalysis.icm.available, true);
    const explicit = await post("analyze-decision", body);
    assert.equal(explicit.status, 200);
    near(
      explicit.data.analysis.icm.deltaCallVsFold,
      r.data.decisionAnalysis.icm.deltaCallVsFold,
    );
    assert.equal(
      (
        await post("calculate", {
          ...body,
          tournament: { ...body.tournament, fieldConfirmed: false },
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("calculate", { ...body, gameMode: "cash" })).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Pot-limit Omaha river closing call uses exact per-outcome ICM and cash for busting Hero", () => {
  const players = [
    ["Ah", "Ac", "4d", "5d"],
    ["Kh", "Kc", "6d", "Td"],
    ["Qh", "Qc", "Jd", "Js"],
  ];
  const actions = [
    { type: "call", seatId: 0 },
    { type: "call", seatId: 1 },
    { type: "check", seatId: 2 },
    { type: "advance" },
    { type: "bet", seatId: 1, amount: 6 },
    { type: "call", seatId: 2 },
    { type: "call", seatId: 0 },
    { type: "advance" },
    { type: "bet", seatId: 1, amount: 24 },
    { type: "fold", seatId: 2 },
    { type: "call", seatId: 0 },
    { type: "advance" },
    { type: "allin", seatId: 1 },
  ];
  const p = scenario({
    players,
    board: ["2s", "3d", "7h", "8c", "9s"],
    actions,
    payouts: [50, 30, 20],
  });
  p.gameType = "omaha";
  p.bettingState = replayBetting(
    {
      seats: [0, 1, 2].map((id) => ({ id, startingStack: 100 })),
      dealerSeatId: 0,
      smallBlind: 1,
      bigBlind: 2,
      gameType: "omaha",
    },
    actions,
    5,
  );
  const result = analyzeClosingCall(p);
  assert.equal(result.method, "exact");
  assert.equal(result.samples, 1);
  assert.equal(result.icm.decision, "Fold");
  near(result.icm.expectedCallPrize, 20);
  assert.equal(result.icm.outcomes[0].callEliminations[0].playerIndex, 0);
});
test("Nine-player tournament field includes all outside stacks and conserves expected prizes", () => {
  const p = scenario({
    otherPlayers: Array.from({ length: 6 }, (_, i) => ({
      name: `Other ${i}`,
      stack: 10 * (i + 1),
    })),
    payouts: [100, 60, 30, 20, 10],
  });
  const result = analyzeClosingCall(p);
  assert.equal(result.icm.players.length, 9);
  near(
    result.icm.players.reduce(
      (sum, player) => sum + player.expectedCallPrize,
      0,
    ),
    220,
  );
  near(
    result.icm.players.reduce(
      (sum, player) => sum + player.expectedFoldPrize,
      0,
    ),
    220,
  );
});

test("ICM distinct-outcome budget fails explicitly rather than returning partial expectations", () => {
  const { createICMObserver } = require("../icmDecision");
  const observer = createICMObserver({
    tournament: {
      payouts: [70, 30],
      otherPlayers: [],
      eliminationRule: "starting-stack-split",
    },
    tableState: {
      seats: [
        { id: 0, name: "P0", startingStack: 100 },
        { id: 1, name: "P1", startingStack: 100 },
      ],
    },
    called: {
      players: [
        { seatId: 0, remaining: 0 },
        { seatId: 1, remaining: 0 },
      ],
    },
    folded: {
      status: "uncontested",
      players: [
        { seatId: 0, remaining: 99 },
        { seatId: 1, remaining: 101 },
      ],
    },
    heroIndex: 0,
  });
  for (let i = 1; i <= 4095; i++)
    observer.observe({
      scores: [1, 0],
      settlement: { payouts: [i, 20000 - i] },
    });
  assert.throws(
    () =>
      observer.observe({
        scores: [1, 0],
        settlement: { payouts: [4096, 15904] },
      }),
    /outcome budget exceeded/,
  );
});
