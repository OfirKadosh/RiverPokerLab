const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");

const source = readFileSync(join(__dirname, "../src/lib/homeCashTransfers.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exportsForTest = {};
new Function("exports", code)(exportsForTest);
const { suggestedTransfers } = exportsForTest;

test("Suggested transfers settle every balance to the agora without changing the results", () => {
  const players = [
    { id: "a", name: "Dana", profit: 3201 },
    { id: "b", name: "Ron", profit: -2000 },
    { id: "c", name: "Tal", profit: 600 },
    { id: "d", name: "Lee", profit: -1801 },
    { id: "e", name: "Yuval", profit: 0 },
  ].map(Object.freeze);
  const transfers = suggestedTransfers(players);
  assert.deepEqual(transfers.map(({ from, to, amount }) => [from.id, to.id, amount]), [
    ["b", "a", 2000], ["d", "a", 1201], ["d", "c", 600],
  ]);
  const actual = new Map(players.map(({ id }) => [id, 0]));
  for (const { from, to, amount } of transfers) {
    actual.set(from.id, actual.get(from.id) - amount);
    actual.set(to.id, actual.get(to.id) + amount);
  }
  assert.deepEqual([...actual.values()], players.map(({ profit }) => profit));
});

test("Break-even games have no transfers and inconsistent balances are rejected", () => {
  const player = { id: "a", name: "Dana", profit: 0 };
  assert.deepEqual(suggestedTransfers([player]), []);
  assert.equal(suggestedTransfers([{ ...player, profit: 1 }]), null);
  assert.equal(suggestedTransfers([{ ...player, profit: 0.5 }]), null);
});
