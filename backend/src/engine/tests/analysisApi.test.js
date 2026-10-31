const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const app = require("./support/app");
const Spot = require("../../models/Spot");
const { replayBetting } = require("../betting");
const players = [
  ["Ah", "Ac"],
  ["Kh", "Kc"],
];
function input(actions = [], board = []) {
  const tableState = {
    seats: players.map((cards, id) => ({
      id,
      name: `P${id}`,
      stack: 10,
      startingStack: 10,
      cards,
    })),
    heroSeatId: 1,
    bigBlind: 2,
    handSetup: { dealerSeatId: 0, smallBlind: 1 },
    betting: { actions },
  };
  const state = replayBetting(
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
    board.length,
  );
  return {
    players,
    board,
    gameType: "holdem",
    gameMode: "cash",
    potSize: state.pot,
    callAmount: state.legal?.toCall || 0,
    iterations: 50,
    saveSpot: false,
    calculationMethod: "auto",
    chipUnit: 1,
    tableState,
  };
}
test("Analysis API validates methods and ledger, reports unsupported spots, and persists decision scope", async (context) => {
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
    for (const extra of [
      { calculationMethod: "bad" },
      { chipUnit: 0 },
      { chipUnit: "1" },
      { includeDecisionAnalysis: 1 },
    ])
      assert.equal(
        (await post("calculate", { ...input(), ...extra })).status,
        400,
      );
    const unsupported = await post("analyze-decision", input());
    assert.equal(unsupported.status, 200);
    assert.equal(unsupported.data.analysis.available, false);
    const pending = input([{ type: "allin", seatId: 0 }]);
    const decision = await post("analyze-decision", pending);
    assert.equal(decision.status, 200);
    assert.equal(decision.data.analysis.available, true);
    assert.equal(decision.data.analysis.callCost, 8);
    assert.equal(decision.data.analysis.foldEV, 0);
    assert.equal(
      (await post("analyze-decision", { ...pending, potSize: 999 })).status,
      400,
    );
    const savedResult = await post("calculate", {
      ...pending,
      saveSpot: true,
      includeDecisionAnalysis: true,
    });
    assert.equal(savedResult.status, 200);
    assert.equal(saved.calculationMethod, "auto");
    assert.equal(saved.chipUnit, 1);
    assert.equal(saved.decisionAnalysis.available, true);
    assert.equal(saved.payoutSummary.kind, "unavailable");
    const actions = [
      { type: "allin", seatId: 0 },
      { type: "call", seatId: 1 },
      { type: "advance" },
      { type: "advance" },
      { type: "advance" },
    ];
    const final = await post(
      "calculate",
      input(actions, ["2s", "3d", "7h", "8c", "9s"]),
    );
    assert.equal(final.status, 200);
    assert.equal(final.data.method, "exact");
    assert.equal(final.data.samples, 1);
    assert.equal(final.data.payoutSummary.kind, "final");
    assert.deepEqual(
      final.data.payoutSummary.endingStacks.map((item) => item.stack),
      [20, 0],
    );
    const forced = await post("calculate", {
      ...input(),
      calculationMethod: "exact",
    });
    assert.equal(forced.status, 400);
    assert.match(forced.data.error, /budget/);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
