const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { buildHandSetup } = require("../handSetup");
const { validateTableState } = require("../tableState");
const { ValidationError } = require("../errors");
const app = require("./support/app");
const Spot = require("../../models/Spot");
const seats = (ids) => ids.map((id) => ({ id, startingStack: 200 }));

test("Heads-up button posts small blind, acts first preflop and last postflop", () => {
  const value = buildHandSetup(seats([0, 4]), 0, 1, 2);
  assert.equal(value.smallBlindSeatId, 0);
  assert.equal(value.bigBlindSeatId, 4);
  assert.deepEqual(value.preflopOrder, [0, 4]);
  assert.deepEqual(value.postflopOrder, [4, 0]);
  assert.deepEqual(
    value.positions.map((seat) => seat.position),
    ["BTN / SB", "BB"],
  );
  assert.equal(value.initialPot, 3);
  assert.deepEqual(
    value.positions.map((seat) => seat.remaining),
    [199, 198],
  );
});
test("Three-handed button acts first preflop and small blind first postflop", () => {
  const value = buildHandSetup(seats([1, 4, 8]), 4, 1, 2);
  assert.deepEqual(value.preflopOrder, [4, 8, 1]);
  assert.deepEqual(value.postflopOrder, [8, 1, 4]);
  assert.equal(value.smallBlindSeatId, 8);
  assert.equal(value.bigBlindSeatId, 1);
});
for (const [count, labels] of [
  [4, ["BTN", "SB", "BB", "CO"]],
  [5, ["BTN", "SB", "BB", "HJ", "CO"]],
  [6, ["BTN", "SB", "BB", "UTG", "HJ", "CO"]],
  [7, ["BTN", "SB", "BB", "UTG", "LJ", "HJ", "CO"]],
  [8, ["BTN", "SB", "BB", "UTG", "UTG+1", "LJ", "HJ", "CO"]],
  [9, ["BTN", "SB", "BB", "UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"]],
])
  test(`${count}-handed position names and preflop order`, () => {
    const value = buildHandSetup(
      seats(Array.from({ length: count }, (_, id) => id)),
      0,
      1,
      2,
    );
    assert.deepEqual(
      value.positions.map((seat) => seat.position),
      labels,
    );
    assert.deepEqual(value.preflopOrder, [
      ...Array.from({ length: count - 3 }, (_, index) => index + 3),
      0,
      1,
      2,
    ]);
  });
test("Short blinds post only available chips and forced all-in seats are skipped", () => {
  const value = buildHandSetup(
    [
      { id: 0, startingStack: 100 },
      { id: 3, startingStack: 0.5 },
      { id: 7, startingStack: 1 },
    ],
    0,
    1,
    2,
  );
  assert.equal(value.initialPot, 1.5);
  assert.deepEqual(value.preflopOrder, [0]);
  assert.deepEqual(value.postflopOrder, [0]);
  assert.ok(
    value.positions
      .filter((seat) => seat.seatId !== 0)
      .every((seat) => seat.forcedAllIn && seat.remaining === 0),
  );
  const allin = buildHandSetup(
    [
      { id: 0, startingStack: 1 },
      { id: 4, startingStack: 2 },
    ],
    0,
    1,
    2,
  );
  assert.deepEqual(allin.preflopOrder, []);
  assert.deepEqual(allin.postflopOrder, []);
});
test("Input order does not change clockwise seating and source arrays are unchanged", () => {
  const input = seats([8, 1, 4]);
  const copy = structuredClone(input);
  assert.deepEqual(
    buildHandSetup(input, 8, 1, 2),
    buildHandSetup(seats([1, 4, 8]), 8, 1, 2),
  );
  assert.deepEqual(input, copy);
});
for (const [label, input, dealer, sb, bb] of [
  ["missing dealer", seats([0, 4]), 3, 1, 2],
  ["one player", seats([0]), 0, 1, 2],
  ["duplicate seats", seats([0, 0]), 0, 1, 2],
  ["bad ID", seats([0, 9]), 0, 1, 2],
  ["zero SB", seats([0, 4]), 0, 0, 2],
  ["negative SB", seats([0, 4]), 0, -1, 2],
  ["SB above BB", seats([0, 4]), 0, 3, 2],
  ["infinite BB", seats([0, 4]), 0, 1, Infinity],
  ["string SB", seats([0, 4]), 0, "1", 2],
  [
    "zero starting stack",
    [
      { id: 0, startingStack: 0 },
      { id: 4, startingStack: 200 },
    ],
    0,
    1,
    2,
  ],
  [
    "negative starting stack",
    [
      { id: 0, startingStack: -1 },
      { id: 4, startingStack: 200 },
    ],
    0,
    1,
    2,
  ],
  [
    "missing starting stack",
    [{ id: 0 }, { id: 4, startingStack: 200 }],
    0,
    1,
    2,
  ],
  [
    "infinite starting stack",
    [
      { id: 0, startingStack: Infinity },
      { id: 4, startingStack: 200 },
    ],
    0,
    1,
    2,
  ],
])
  test(`Rejects ${label}`, () =>
    assert.throws(
      () => buildHandSetup(input, dealer, sb, bb),
      ValidationError,
    ));

test("Browser and server produce identical positions for every occupied-seat subset and button", async () => {
  const browser = await import(
    pathToFileURL(
      path.resolve(__dirname, "../../../../frontend/src/lib/handSetup.js"),
    ).href
  );
  let cases = 0;
  for (let mask = 0; mask < 512; mask++) {
    const ids = Array.from({ length: 9 }, (_, id) => id).filter(
      (id) => mask & (1 << id),
    );
    if (ids.length < 2) continue;
    for (const dealer of ids) {
      const input = seats([...ids].reverse());
      const server = buildHandSetup(input, dealer, 0.5, 1);
      assert.deepEqual(browser.buildHandSetup(input, dealer, 0.5, 1), server);
      assert.equal(server.preflopOrder.length, ids.length);
      assert.equal(
        new Set(server.positions.map((seat) => seat.position)).size,
        ids.length,
      );
      cases++;
    }
  }
  assert.equal(cases, 2295);
});
const players = [
  ["Ah", "Ac"],
  ["Kh", "Kc"],
];
const metadata = () => ({
  seats: [
    { id: 0, name: "Hero", stack: 150, startingStack: 200, cards: players[0] },
    {
      id: 4,
      name: "Villain",
      stack: 100,
      startingStack: 300,
      cards: players[1],
    },
  ],
  heroSeatId: 0,
  bigBlind: 2,
  handSetup: { dealerSeatId: 0, smallBlind: 1 },
});
test("Metadata retains independent current and starting stacks and recomputes derived fields", () => {
  const input = metadata();
  input.handSetup.initialPot = 999;
  input.handSetup.preflopOrder = [4, 0];
  const value = validateTableState(input, players);
  assert.equal(value.seats[0].stack, 150);
  assert.equal(value.seats[0].startingStack, 200);
  assert.equal(value.handSetup.initialPot, 3);
  assert.deepEqual(value.handSetup.preflopOrder, [0, 4]);
  const stored = new Spot({ players, tableState: value }).toObject();
  assert.deepEqual(stored.tableState, value);
  const legacy = metadata();
  delete legacy.handSetup;
  legacy.seats.forEach((seat) => delete seat.startingStack);
  assert.equal(validateTableState(legacy, players).handSetup, undefined);
});
test("API persists hand setup, refuses illegal blinds, and leaves equity unchanged", async (context) => {
  let saved;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    return this;
  });
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const post = (tableState) =>
      fetch(`http://127.0.0.1:${server.address().port}/api/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          players,
          board: ["2s", "3d", "7h", "8c", "9s"],
          potSize: 100,
          callAmount: 0,
          iterations: 1,
          saveSpot: true,
          tableState,
        }),
      });
    const response = await post(metadata());
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).results, [
      { playerIndex: 0, equity: 100 },
      { playerIndex: 1, equity: 0 },
    ]);
    assert.equal(saved.potSize, 100);
    assert.equal(saved.tableState.handSetup.initialPot, 3);
    assert.equal(saved.tableState.seats[0].stack, 150);
    const bad = metadata();
    bad.handSetup.smallBlind = 3;
    assert.equal((await post(bad)).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
