const { test } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const { validateTableState } = require("../tableState");
const { ValidationError } = require("../validation");
const Spot = require("../../models/Spot");
const app = require("./support/app");
const players = [
  ["Ah", "Ac"],
  ["Kh", "Kc"],
];
const state = () => ({
  seats: [
    { id: 0, name: "Hero", stack: 200, cards: players[0] },
    { id: 4, name: "Villain", stack: 150, cards: players[1] },
  ],
  heroSeatId: 0,
  bigBlind: 2,
});

test("Legacy requests can omit table metadata", () =>
  assert.equal(validateTableState(undefined, players), undefined));
test("Table metadata normalizes cards and names without mutating input", () => {
  const input = state();
  input.seats[0] = { ...input.seats[0], name: " Hero ", cards: ["ah", "AC"] };
  const copy = structuredClone(input);
  assert.equal(validateTableState(input, players).seats[0].name, "Hero");
  assert.deepEqual(
    validateTableState(input, players).seats[0].cards,
    players[0],
  );
  assert.deepEqual(input, copy);
});
const invalid = [
  null,
  [],
  {},
  { ...state(), seats: [] },
  { ...state(), seats: [null, state().seats[1]] },
  { ...state(), seats: [{ ...state().seats[0], id: 4 }, state().seats[1]] },
  { ...state(), seats: [{ ...state().seats[0], id: 9 }, state().seats[1]] },
  { ...state(), seats: [{ ...state().seats[0], name: " " }, state().seats[1]] },
  {
    ...state(),
    seats: [{ ...state().seats[0], name: "X".repeat(41) }, state().seats[1]],
  },
  { ...state(), seats: [{ ...state().seats[0], stack: -1 }, state().seats[1]] },
  {
    ...state(),
    seats: [{ ...state().seats[0], stack: Infinity }, state().seats[1]],
  },
  {
    ...state(),
    seats: [{ ...state().seats[0], cards: ["2s", "3s"] }, state().seats[1]],
  },
  {
    ...state(),
    seats: [{ ...state().seats[0], cards: ["Ah"] }, state().seats[1]],
  },
  { ...state(), heroSeatId: 7 },
  { ...state(), bigBlind: 0 },
  { ...state(), bigBlind: "2" },
];
invalid.forEach((value, index) =>
  test(`Rejects inconsistent table metadata case ${index + 1}`, () => {
    assert.throws(() => validateTableState(value, players), ValidationError);
  }),
);
test("Optional metadata is retained by the Spot schema and absent in legacy spots", () => {
  const document = new Spot({
    gameType: "holdem",
    players,
    tableState: state(),
  });
  assert.deepEqual(document.toObject().tableState, state());
  assert.equal(new Spot({ players }).toObject().tableState, undefined);
});
test("API saves table metadata and rejects bad metadata without writing to MongoDB", async (context) => {
  let saved;
  let writes = 0;
  context.mock.method(Spot.prototype, "save", async function () {
    saved = this.toObject();
    writes++;
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
    assert.equal((await post(state())).status, 200);
    assert.deepEqual(saved.tableState, state());
    const bad = await post({ ...state(), heroSeatId: 7 });
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).success, false);
    assert.equal(writes, 1);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
