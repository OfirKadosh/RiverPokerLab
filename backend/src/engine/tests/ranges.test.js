const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const {
  RANKS,
  SUITS,
  cardFromString,
  cardToString,
  createDeck,
} = require("../card");
const {
  ALL_CLASSES,
  expandRangeClasses,
  parseRange,
  previewRange,
} = require("../rangeParser");
const { createJointSampler } = require("../rangeSampler");
const {
  runEquitySimulation,
  runMonteCarloSimulation,
  cardToInt,
} = require("../engine");
const { validateSimulationInput } = require("../validation");
const { ValidationError } = require("../errors");
const Spot = require("../../models/Spot");
const app = require("./support/app");
function rng(seed = 47) {
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("All 52 cards round-trip through one encoding used by engine and parser", () => {
  const ids = [];
  for (const rank of RANKS)
    for (const suit of SUITS) {
      const card = rank + suit;
      const id = cardFromString(card);
      assert.equal(cardToInt(card), id);
      assert.equal(cardToString(id), card);
      ids.push(id);
    }
  assert.deepEqual(
    [...ids].sort((a, b) => a - b),
    createDeck(),
  );
  assert.equal(cardFromString(" 10H "), cardFromString("Th"));
  for (const id of [-1, 52, 1.5, NaN, null])
    assert.throws(() => cardToString(id), ValidationError);
});
for (const [notation, count] of [
  ["AA", 6],
  ["AKs", 4],
  ["AKo", 12],
  ["AK", 16],
  ["TT+", 30],
  ["AJs+", 12],
  ["AA-TT", 30],
  ["TT-AA", 30],
  ["AJs-A8s", 16],
  ["A8s-AJs", 16],
  ["AA,AA,AKs,AK", 22],
  ["random", 1326],
  ["kAs", 4],
]) {
  test(`Range expansion: ${notation} produces ${count} unique combinations`, () => {
    const combos = parseRange(notation);
    assert.equal(combos.length, count);
    assert.equal(
      new Set(combos.map((combo) => [...combo].sort((a, b) => a - b).join("-")))
        .size,
      count,
    );
    assert.ok(combos.every(([a, b]) => a !== b));
  });
}
test("169 classes partition all 1326 possible hands", () => {
  assert.equal(ALL_CLASSES.length, 169);
  assert.equal(new Set(ALL_CLASSES).size, 169);
  const combos = parseRange(ALL_CLASSES.join(","));
  assert.equal(combos.length, 1326);
  assert.equal(
    new Set(combos.map((combo) => [...combo].sort((a, b) => a - b).join("-")))
      .size,
    1326,
  );
});
for (const text of [
  "",
  " ",
  "AA,,KK",
  ",AA",
  "AA,",
  "AAx",
  "AKx",
  "AAs",
  "72z",
  "100%",
  "AKs:50",
  "98s-65s",
  "AJs-ATo",
  "random,AA",
  null,
  {},
  "A".repeat(4097),
]) {
  test(`Rejects unsupported notation ${JSON.stringify(text)?.slice(0, 45)}`, () =>
    assert.throws(() => parseRange(text), ValidationError));
}
test("Blocker counts use physical combinations and normalize aliases", () => {
  assert.equal(previewRange("AA", ["ah"]).availableCombos, 3);
  assert.equal(previewRange("AA", ["ah", "AC"]).availableCombos, 1);
  assert.equal(previewRange("AKs", ["Ah"]).availableCombos, 3);
  assert.equal(previewRange("AKo", ["Ah"]).availableCombos, 9);
  assert.equal(previewRange("AA", ["Ah", "Ac", "Ad"]).availableCombos, 0);
  assert.equal(previewRange("random", ["Ah", "Ac"]).availableCombos, 1225);
  assert.throws(() => previewRange("AA", ["Ah", "ah"]), ValidationError);
  assert.throws(() => previewRange("AA", "Ah"), ValidationError);
});
test("Joint sampler is uniform over legal deals rather than sequentially resampling opponents", () => {
  const sampler = createJointSampler(
    [
      [
        [0, 1],
        [2, 3],
      ],
      [
        [0, 4],
        [5, 6],
      ],
    ],
    [],
    rng(),
    1000000,
  );
  const counts = { "0,1|5,6": 0, "2,3|0,4": 0, "2,3|5,6": 0 };
  for (let i = 0; i < 60000; i++) {
    const hands = sampler.draw();
    assert.equal(new Set(hands.flat()).size, 4);
    const key = hands.map((hand) => hand.join(",")).join("|");
    assert.ok(key in counts);
    counts[key]++;
  }
  for (const count of Object.values(counts))
    assert.ok(Math.abs(count / 60000 - 1 / 3) < 0.01, JSON.stringify(counts));
});
test("Sampler proposal order does not change uniform legal joint frequencies", () => {
  const sampler = createJointSampler(
    [
      [
        [0, 4],
        [5, 6],
      ],
      [
        [0, 1],
        [2, 3],
      ],
    ],
    [],
    rng(72),
    1000000,
  );
  let firstA = 0;
  for (let i = 0; i < 30000; i++) if (sampler.draw()[1][0] === 0) firstA++;
  assert.ok(Math.abs(firstA / 30000 - 1 / 3) < 0.015);
});
test("Impossible joint ranges are rejected before simulation", () => {
  assert.throws(
    () =>
      runEquitySimulation(
        Array.from({ length: 3 }, () => ({ type: "range", range: "AA" })),
        [],
        "holdem",
        10,
      ),
    /cannot be dealt together/,
  );
});
test("Empty blocked ranges and infeasible board masks are rejected", () => {
  assert.throws(
    () =>
      runEquitySimulation(
        [["Kh", "Kc"], { type: "range", range: "AA" }],
        ["Ah", "Ac", "Ad"],
        "holdem",
        1,
      ),
    /no combinations remaining/,
  );
  assert.throws(
    () => createJointSampler([[[0, 1]], [[2, 3]]], [0]),
    ValidationError,
  );
});
test("Proposal budget fails explicitly instead of returning biased or partial results", () => {
  const sampler = createJointSampler(
    [
      [
        [0, 1],
        [2, 3],
      ],
      [
        [0, 4],
        [5, 6],
      ],
    ],
    [],
    () => 0,
    5,
  );
  assert.throws(() => sampler.draw(), /No partial equity/);
});
test("Hand vs range reduces to the forced legal combination after blockers", () => {
  const value = runEquitySimulation(
    [["Kh", "Kc"], { type: "range", range: "AKs" }],
    ["Ah", "Ac", "Ad", "2s", "3s"],
    "holdem",
    10,
  );
  assert.deepEqual(value.results, [
    { playerIndex: 0, equity: 0 },
    { playerIndex: 1, equity: 100 },
  ]);
  assert.deepEqual(value.rangeStats, [
    { playerIndex: 1, totalCombos: 4, availableCombos: 1, blockedCombos: 3 },
  ]);
});
test("Range vs range handles overlapping ranges and split pots", () => {
  const results = runMonteCarloSimulation(
    [
      { type: "range", range: "AA" },
      { type: "range", range: "AA" },
    ],
    ["2s", "3d", "7h", "8c", "9s"],
    "holdem",
    100,
  );
  assert.deepEqual(results, [
    { playerIndex: 0, equity: 50 },
    { playerIndex: 1, equity: 50 },
  ]);
});
test("Unequal class sizes are weighted per combination, not per hand class", (context) => {
  context.mock.method(Math, "random", rng());
  const value = runEquitySimulation(
    [["Ah", "Ad"], { type: "range", range: "AA,KK" }],
    ["2c", "3d", "4h", "8s", "9c"],
    "holdem",
    10000,
  );
  assert.ok(Math.abs(value.results[0].equity - (100 * 6.5) / 7) < 1);
});
test("Omaha ranges and ambiguous hand/range objects are rejected", () => {
  assert.throws(
    () =>
      validateSimulationInput(
        [{ type: "range", range: "AA" }, ["Kh", "Kc", "Kd", "Ks"]],
        [],
        "omaha",
        1,
      ),
    ValidationError,
  );
  assert.throws(
    () =>
      validateSimulationInput(
        [{ type: "range", range: "AA", cards: ["Ah", "Ac"] }, ["Kh", "Kc"]],
        [],
        "holdem",
        1,
      ),
    ValidationError,
  );
});
test("Range requests and previews integrate with the API, persistence, and history schema", async (context) => {
  let saved;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    return this;
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const post = (path, body) =>
    fetch(`http://127.0.0.1:${server.address().port}/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  try {
    const range = { type: "range", range: "AA" };
    const request = {
      playerInputs: [{ type: "hand", cards: ["Kh", "Kc"] }, range],
      board: ["2s", "3d", "7h", "8c", "9s"],
      iterations: 10,
      potSize: 100,
      callAmount: 0,
      saveSpot: true,
      tableState: {
        seats: [
          {
            id: 0,
            name: "Hero",
            stack: 200,
            mode: "hand",
            cards: ["Kh", "Kc"],
          },
          {
            id: 4,
            name: "Villain",
            stack: 200,
            mode: "range",
            range: "aa",
            cards: [],
          },
        ],
        heroSeatId: 0,
        bigBlind: 2,
      },
    };
    const response = await post("calculate", request);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.rangeStats[0].availableCombos, 6);
    assert.equal(body.results[1].equity, 100);
    assert.deepEqual(saved.players, [["Kh", "Kc"], []]);
    assert.deepEqual(saved.playerInputs, [
      { type: "hand", cards: ["Kh", "Kc"] },
      range,
    ]);
    assert.equal(saved.tableState.seats[1].range, "AA");
    const stored = new Spot(saved).toObject();
    assert.equal(stored.playerInputs[1].range, "AA");
    const preview = await post("ranges/preview", {
      range: "TT+,AKs",
      deadCards: ["Ah"],
    });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).availableCombos, 30);
    assert.equal(
      (
        await post("calculate", {
          ...request,
          players: [
            ["Ah", "Ac"],
            ["Kh", "Kc"],
          ],
        })
      ).status,
      400,
    );
    assert.equal(
      (await post("ranges/preview", { range: "garbage" })).status,
      400,
    );
    assert.equal(
      (
        await post("calculate", {
          ...request,
          playerInputs: [
            { type: "hand", cards: ["Kh", "Kc"] },
            { type: "range", range: "XX" },
          ],
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await post("calculate", {
          ...request,
          tableState: {
            ...request.tableState,
            seats: [
              request.tableState.seats[0],
              { ...request.tableState.seats[1], range: "KK" },
            ],
          },
        })
      ).status,
      400,
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Nine random ranges respect a royal-flush board and split the pot nine ways", () => {
  const value = runEquitySimulation(
    Array.from({ length: 9 }, () => ({ type: "range", range: "random" })),
    ["As", "Ks", "Qs", "Js", "Ts"],
    "holdem",
    10,
  );
  assert.equal(value.results.length, 9);
  assert.ok(value.results.every((result) => result.equity === 11.11));
  assert.ok(value.rangeStats.every((stat) => stat.availableCombos === 1081));
});
