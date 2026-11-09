const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const source = readFileSync(join(__dirname, "../src/lib/bankroll.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
const exportsForTest = {};
new Function("exports", code)(exportsForTest);
const { bankrollPeriod, allEntries } = exportsForTest;

const ledger = {
  openingBalance: 10_000,
  balance: 14_200,
  entries: [
    { kind: "cash", date: "2026-11-06", buyIn: 800, cashOut: 200 },
    { kind: "withdrawal", date: "2026-11-05", amount: 500 },
    { kind: "tournament", date: "2026-11-03", buyIn: 1700, cashOut: 0 },
    { kind: "cash", date: "2026-11-03", buyIn: 1000, cashOut: 3000 },
    { kind: "deposit", date: "2026-11-01", amount: 5000 },
  ],
};
const chartDay = (day) => Date.parse(`2026-11-0${day}`) / 86_400_000;

test("Date filters include boundary dates, carry in prior entries and retain same-day net movement", () => {
  const period = bankrollPeriod(ledger, { from: "2026-11-03", to: "2026-11-05", game: "all" });
  assert.equal(period.opening, 15_000);
  assert.equal(period.closing, 14_800);
  assert.equal(period.pokerProfit, 300);
  assert.equal(period.netTransfers, -500);
  assert.equal(period.sessions, 2);
  assert.deepEqual(period.points, [
    { day: chartDay(3), balance: 15_000 },
    { day: chartDay(4), balance: 15_300 },
    { day: chartDay(6), balance: 14_800 },
  ]);
  assert.equal(ledger.balance, 14_200);
});

test("Game filters affect poker profit and sessions while transfers and balance remain complete", () => {
  const all = bankrollPeriod(ledger, allEntries);
  const cash = bankrollPeriod(ledger, { ...allEntries, game: "cash" });
  const tournament = bankrollPeriod(ledger, { ...allEntries, game: "tournament" });
  assert.equal(cash.pokerProfit, 1400);
  assert.equal(cash.sessions, 2);
  assert.deepEqual(cash.entries.map(({ kind }) => kind), ["cash", "withdrawal", "cash", "deposit"]);
  assert.equal(tournament.pokerProfit, -1700);
  assert.equal(tournament.sessions, 1);
  assert.equal(tournament.netTransfers, 4500);
  assert.deepEqual(cash.points, all.points);
  assert.deepEqual(tournament.points, all.points);
  assert.equal(all.closing, ledger.balance);
});

test("Empty or single-day ranges still show the correct carried balance", () => {
  const quiet = bankrollPeriod(ledger, { from: "2026-11-04", to: "2026-11-04", game: "all" });
  assert.deepEqual(quiet.entries, []);
  assert.deepEqual(quiet.points, [
    { day: chartDay(4), balance: 15_300 },
    { day: chartDay(5), balance: 15_300 },
  ]);
  const earliest = bankrollPeriod(ledger, { ...allEntries, to: "2026-11-01" });
  assert.equal(earliest.closing, 15_000);
  const latest = bankrollPeriod(ledger, { ...allEntries, from: "2026-11-06" });
  assert.equal(latest.opening, 14_800);
  assert.equal(latest.closing, 14_200);
  assert.equal(bankrollPeriod(ledger, { ...allEntries, from: "2026-11-06", to: "2026-11-05" }), null);
  assert.equal(bankrollPeriod(ledger, { ...allEntries, to: "2150-01-01" }), null);
});
