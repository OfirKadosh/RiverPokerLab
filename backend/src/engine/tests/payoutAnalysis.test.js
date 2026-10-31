const { test } = require("node:test");
const assert = require("node:assert/strict");
const { preparePots, settleScores } = require("../payouts");
const { runEquitySimulation } = require("../engine");
const { replayBetting } = require("../betting");
const { validateTableState } = require("../tableState");
const {
  calculationSettings,
  calculateSnapshot,
  analyzeClosingCall,
} = require("../analysis");
const { ValidationError } = require("../errors");
const players = [
    ["Ah", "Ac"],
    ["Kh", "Kc"],
    ["Qh", "Qc"],
  ],
  board = ["2s", "3d", "7h", "8c", "9s"];
function setup(
  stacks = [10, 20, 100],
  actions = [
    { type: "allin", seatId: 0 },
    { type: "allin", seatId: 1 },
    { type: "call", seatId: 2 },
  ],
) {
  const table = {
    seats: stacks.map((stack, id) => ({
      id,
      name: `P${id}`,
      stack,
      startingStack: stack,
      cards: players[id],
    })),
    heroSeatId: 2,
    bigBlind: 2,
    handSetup: { dealerSeatId: 0, smallBlind: 1 },
    betting: { actions },
  };
  const config = {
    seats: stacks.map((startingStack, id) => ({ id, startingStack })),
    dealerSeatId: 0,
    smallBlind: 1,
    bigBlind: 2,
    gameType: "holdem",
  };
  return { table, config, actions };
}
const settings = { method: "auto", chipUnit: 1 };
test("Main and side pots have independent eligible winners", () => {
  const plan = preparePots(
    [
      { amount: 30, eligibleIndices: [0, 1, 2] },
      { amount: 20, eligibleIndices: [1, 2] },
    ],
    3,
    [0, 1, 2],
    [0, 1, 2],
    0,
    1,
  );
  const s = settleScores([9, 8, 7], plan);
  assert.deepEqual(s.payouts, [3000, 2000, 0]);
  assert.deepEqual(
    s.pots.map((p) => p.winnerIndices),
    [[0], [1]],
  );
});
test("Odd chip goes to the first tied winner clockwise after dealer for each pot", () => {
  const plan = preparePots(
    [{ amount: 3, eligibleIndices: [0, 1] }],
    2,
    [0, 1],
    [0, 4],
    0,
    1,
  );
  assert.deepEqual(settleScores([9, 9], plan).payouts, [100, 200]);
  const reversed = preparePots(
    [{ amount: 3, eligibleIndices: [0, 1] }],
    2,
    [0, 1],
    [0, 4],
    4,
    1,
  );
  assert.deepEqual(settleScores([9, 9], reversed).payouts, [200, 100]);
});
test("Tie involving a folded contributor never awards that contributor", () => {
  const plan = preparePots(
    [{ amount: 9, eligibleIndices: [0, 2] }],
    3,
    [0, 2],
    [0, 3, 8],
    3,
    1,
  );
  assert.deepEqual(settleScores([9, 99, 9], plan).payouts, [400, 0, 500]);
});
test("Payout denominations and eligibility are validated", () => {
  assert.throws(
    () =>
      preparePots(
        [{ amount: 3.5, eligibleIndices: [0, 1] }],
        2,
        [0, 1],
        [0, 1],
        0,
        1,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      preparePots(
        [{ amount: 3, eligibleIndices: [] }],
        2,
        [0, 1],
        [0, 1],
        0,
        0.01,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      preparePots(
        [{ amount: 3, eligibleIndices: [1] }],
        2,
        [0],
        [0, 1],
        0,
        0.01,
      ),
    ValidationError,
  );
  assert.throws(() => calculationSettings({ chipUnit: 0 }), ValidationError);
});
test("Exact flop enumerates all 990 physical runouts and ignores RNG", (context) => {
  context.mock.method(Math, "random", () => {
    throw new Error("Exact calculation must not sample");
  });
  const result = runEquitySimulation(
    players.slice(0, 2),
    board.slice(0, 3),
    "holdem",
    1,
    { method: "exact" },
  );
  assert.equal(result.method, "exact");
  assert.equal(result.samples, 990);
  assert.equal(result.enumeration.jointDeals, 1);
  assert.equal(result.results[0].equity + result.results[1].equity, 100);
});
test("Turn, river and Omaha exact state counts use remaining physical cards", () => {
  assert.equal(
    runEquitySimulation(players.slice(0, 2), board.slice(0, 4), "holdem", 10, {
      method: "auto",
    }).samples,
    44,
  );
  assert.equal(
    runEquitySimulation(players.slice(0, 2), board, "holdem", 10, {
      method: "exact",
    }).samples,
    1,
  );
  const result = runEquitySimulation(
    [
      ["Ah", "Ac", "Ad", "As"],
      ["Kh", "Kc", "Kd", "Ks"],
    ],
    ["2s", "3d", "7h"],
    "omaha",
    10,
    { method: "exact" },
  );
  assert.equal(result.samples, 820);
});
test("Exact overlapping ranges count only legal joint deals, with no order bias", () => {
  const result = runEquitySimulation(
    [
      { type: "range", range: "AA" },
      { type: "range", range: "AA" },
    ],
    board,
    "holdem",
    1,
    { method: "exact" },
  );
  assert.equal(result.enumeration.jointDeals, 6);
  assert.equal(result.samples, 6);
  assert.equal(result.results[0].equity, 50);
  assert.equal(result.results[1].equity, 50);
});
test("Exact mixed classes weight physical combos rather than classes", () => {
  const result = runEquitySimulation(
    [["Ah", "Ad"], { type: "range", range: "AA, KK" }],
    ["2c", "3d", "4h", "8s", "9c"],
    "holdem",
    1,
    { method: "exact" },
  );
  assert.equal(result.samples, 7);
  assert.equal(result.results[0].equity, 92.86);
});
test("Auto falls back when the full exact state space exceeds budget; forced exact refuses", () => {
  const r = runEquitySimulation(players.slice(0, 2), [], "holdem", 10, {
    method: "auto",
  });
  assert.equal(r.method, "monteCarlo");
  assert.equal(r.samples, 10);
  assert.equal(r.enumeration.available, false);
  assert.throws(
    () =>
      runEquitySimulation(players.slice(0, 2), [], "holdem", 10, {
        method: "exact",
      }),
    /budget/,
  );
});
test("Concrete river settlement returns ending stacks and conserves initial chips", () => {
  const { table, config, actions } = setup();
  const sequence = [
    ...actions,
    { type: "advance" },
    { type: "advance" },
    { type: "advance" },
  ];
  table.betting.actions = sequence;
  const meta = validateTableState(table, players, "holdem", board);
  const state = replayBetting(config, sequence, 5);
  const result = calculateSnapshot({
    players,
    board,
    gameType: "holdem",
    iterations: 1,
    tableState: meta,
    settings,
    bettingState: state,
  });
  assert.equal(result.payoutSummary.kind, "final");
  assert.deepEqual(
    result.payoutSummary.endingStacks.map((p) => p.stack),
    [30, 20, 80],
  );
  assert.equal(
    result.payoutSummary.endingStacks.reduce((s, p) => s + p.stack, 0),
    130,
  );
});
test("All-in flop gets payout expectations, not a claim of known final stacks", () => {
  const { table, config, actions } = setup();
  table.betting.actions = [...actions, { type: "advance" }];
  const meta = validateTableState(table, players, "holdem", board.slice(0, 3));
  const state = replayBetting(config, table.betting.actions, 3);
  const result = calculateSnapshot({
    players,
    board: board.slice(0, 3),
    gameType: "holdem",
    iterations: 1,
    tableState: meta,
    settings,
    bettingState: state,
  });
  assert.equal(result.method, "exact");
  assert.equal(result.payoutSummary.kind, "expectation");
  assert.ok(
    Math.abs(
      result.payoutSummary.endingStacks.reduce((s, p) => s + p.stack, 0) - 130,
    ) < 0.00001,
  );
});
test("Range hands on river remain an expectation rather than known final settlement", () => {
  const { table, config, actions } = setup();
  const mixed = [players[0], { type: "range", range: "KK" }, players[2]];
  table.seats[1] = { ...table.seats[1], cards: [], mode: "range", range: "KK" };
  table.betting.actions = [
    ...actions,
    { type: "advance" },
    { type: "advance" },
    { type: "advance" },
  ];
  const meta = validateTableState(table, mixed, "holdem", board);
  const state = replayBetting(config, table.betting.actions, 5);
  const result = calculateSnapshot({
    players: mixed,
    board,
    gameType: "holdem",
    iterations: 1,
    tableState: meta,
    settings,
    bettingState: state,
  });
  assert.equal(result.payoutSummary.kind, "expectation");
});
test("Closing call EV uses side-pot entitlement and decision-time chips, not raw equity", () => {
  const { table, config, actions } = setup();
  table.betting.actions = actions.slice(0, -1);
  const meta = validateTableState(table, players, "holdem", []);
  const state = replayBetting(config, table.betting.actions, 0);
  const result = analyzeClosingCall({
    players,
    board: [],
    gameType: "holdem",
    gameMode: "cash",
    iterations: 20,
    tableState: meta,
    settings: { method: "monteCarlo", chipUnit: 1 },
    bettingState: state,
  });
  assert.equal(result.available, true);
  assert.equal(result.callCost, 18);
  assert.equal(result.foldEV, 0);
  assert.equal(result.unit, "chips");
  assert.ok(result.expectedCallPayout >= 0 && result.expectedCallPayout <= 50);
});
test("Calls with later betting and non-acting Hero are explicitly unsupported", () => {
  const { table, config } = setup([100, 100, 100], []);
  const meta = validateTableState(table, players, "holdem", []);
  let state = replayBetting(config, [], 0);
  assert.equal(
    analyzeClosingCall({
      players,
      board: [],
      gameType: "holdem",
      iterations: 1,
      tableState: meta,
      settings,
      bettingState: state,
    }).available,
    false,
  );
  meta.heroSeatId = 0;
  const result = analyzeClosingCall({
    players,
    board: [],
    gameType: "holdem",
    iterations: 1,
    tableState: meta,
    settings,
    bettingState: state,
  });
  assert.equal(result.available, false);
  assert.match(result.reason, /future betting/);
});

test('Seeded Monte Carlo payout mean agrees with exhaustive turn enumeration and reports sampling error', context => {
 let seed=123456;
 context.mock.method(Math,'random',()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
 const options={pots:[{amount:20,eligibleIndices:[0,1]}],seatIds:[0,1],dealerSeatId:0,chipUnit:1};
 const exact=runEquitySimulation(players.slice(0,2),board.slice(0,4),'holdem',1,{...options,method:'exact'});
 const sampled=runEquitySimulation(players.slice(0,2),board.slice(0,4),'holdem',10000,{...options,method:'monteCarlo'});
 assert.equal(exact.payouts[0].standardError,0);
 assert.ok(sampled.payouts[0].standardError>0);
 assert.ok(Math.abs(sampled.payouts[0].expectedPayout-exact.payouts[0].expectedPayout)<5*sampled.payouts[0].standardError);
 assert.ok(Math.abs(sampled.payouts.reduce((sum,p)=>sum+p.expectedPayout,0)-20)<0.00001);
});
