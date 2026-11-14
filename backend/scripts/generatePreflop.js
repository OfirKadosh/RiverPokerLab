const { writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { solvePushFoldStrategy } = require("../src/engine/pushFoldSolver");

const version = "push-fold-v1";
const rounds = 16;
const seed = 73129;
const presets = [
  { id: "hu-8bb", label: "Heads-up · 8 BB", stacks: [800, 800], names: ["Button", "Big blind"], ante: 0,
    payouts: [65, 35], outsidePlayers: [] },
  { id: "hu-12bb", label: "Heads-up · 12 BB", stacks: [1200, 1200], names: ["Button", "Big blind"], ante: 0,
    payouts: [65, 35], outsidePlayers: [] },
  { id: "3max-uneven", label: "Three-handed · 8 / 6 / 12 BB", stacks: [800, 600, 1200],
    names: ["Button", "Small blind", "Big blind"], ante: 0, payouts: [50, 50, 0], outsidePlayers: [] },
];

const charts = {};
let hands;
for (const preset of presets) {
  for (const mode of ["cash", "tournament"]) {
    const id = `${mode}-${preset.id}`;
    const players = preset.stacks.map((stack, index) => ({ name: preset.names[index], stack }));
    const config = { players, dealer: 0, smallBlind: 50, bigBlind: 100, ante: preset.ante,
      ...(mode === "tournament" ? { payouts: preset.payouts, outsidePlayers: preset.outsidePlayers } : {}) };
    const valuation = mode === "cash" ? "chip-ev" : "icm-prize-ev";
    const solution = solvePushFoldStrategy({ ...config, rounds, seed }, valuation);
    hands = solution.hands;
    const compact = (value) => Number(value.toFixed(6));
    charts[id] = {
      id, mode, label: preset.label, valuation, config, seats: solution.seats,
      trainingDeals: solution.trainingDeals, evaluationDeals: solution.evaluationDeals,
      contexts: solution.contexts.map((context) => ({
        ...context, frequencies: context.frequencies.map((p) => p === null ? null : compact(p)),
      })),
      deviations: solution.deviations.map(({ seat, gain, confidence95 }) => ({
        seat, gain: compact(gain), confidence95: confidence95.map(compact),
      })),
    };
    process.stdout.write(`Generated ${id}\n`);
  }
}
const path = resolve(__dirname, "../src/data/preflopCharts.json");
writeFileSync(path, JSON.stringify({ version, rounds, seed, hands, charts }) + "\n");
