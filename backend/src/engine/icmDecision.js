const { ValidationError } = require("./errors");
const { chipUnits, preparePots, settleScores } = require("./payouts");
const { resolveTournamentOutcome } = require("./tournament");

function createICMObserver({
  tournament,
  tableState,
  called,
  folded,
  foldOptions,
  heroIndex,
}) {
  const tableSeats = tableState.seats;
  const names = [
    ...tableSeats.map((seat) => seat.name),
    ...tournament.otherPlayers.map((player) => player.name),
  ];
  const starts = [
    ...tableSeats.map((seat) => seat.startingStack),
    ...tournament.otherPlayers.map((player) => player.stack),
  ];
  const n = starts.length;
  const cache = new Map(),
    pairs = new Map();
  const foldPlan =
    folded.status === "uncontested"
      ? null
      : preparePots(
          foldOptions.pots,
          tableSeats.length,
          foldOptions.eligibleIndices,
          foldOptions.seatIds,
          foldOptions.dealerSeatId,
          foldOptions.chipUnit,
        );
  const meanCall = Array(n).fill(0),
    meanFold = Array(n).fill(0);
  let totalWeight = 0;
  let count = 0,
    meanDelta = 0,
    m2 = 0;
  function vector(state, payouts) {
    return [
      ...tableSeats.map(
        (seat, index) =>
          (chipUnits(
            state.players.find((player) => player.seatId === seat.id).remaining,
          ) +
            (payouts?.[index] || 0)) /
          100,
      ),
      ...tournament.otherPlayers.map((player) => player.stack),
    ];
  }
  function value(stacks) {
    const key = stacks.map((amount) => chipUnits(amount)).join(",");
    if (!cache.has(key)) {
      if (cache.size >= 4096)
        throw new ValidationError(
          "ICM outcome budget exceeded. Narrow the ranges or reduce samples. No partial decision is returned.",
        );
      cache.set(
        key,
        resolveTournamentOutcome(stacks, starts, tournament.payouts),
      );
    }
    return cache.get(key);
  }
  function observe({ scores, settlement, weight = 1 }) {
    const callStacks = vector(called, settlement.payouts);
    const foldStacks = vector(
      folded,
      foldPlan ? settleScores(scores, foldPlan).payouts : null,
    );
    const call = value(callStacks),
      fold = value(foldStacks);
    count++;
    totalWeight += weight;
    const delta = call.values[heroIndex] - fold.values[heroIndex],
      difference = delta - meanDelta;
    meanDelta += (weight * difference) / totalWeight;
    m2 += weight * difference * (delta - meanDelta);
    for (let i = 0; i < n; i++) {
      meanCall[i] += (weight * (call.values[i] - meanCall[i])) / totalWeight;
      meanFold[i] += (weight * (fold.values[i] - meanFold[i])) / totalWeight;
    }
    const key = JSON.stringify([callStacks, foldStacks]);
    if (!pairs.has(key))
      pairs.set(key, {
        count: 0,
        mass: 0,
        callStacks,
        foldStacks,
        heroCallValue: call.values[heroIndex],
        heroFoldValue: fold.values[heroIndex],
        callEliminations: call.awards,
        foldEliminations: fold.awards,
      });
    pairs.get(key).count++;
    pairs.get(key).mass += weight;
  }
  function finish(method, samples) {
    if (count !== samples) throw new Error("ICM observation count mismatch.");
    const standardError =
      method === "exact" || samples < 2
        ? 0
        : Math.sqrt(Math.max(0, m2) / (samples - 1) / samples);
    const uncertain =
      method === "monteCarlo" &&
      (samples < 30 || Math.abs(meanDelta) <= 1.96 * standardError);
    const decision = uncertain
      ? "Uncertain"
      : Math.abs(meanDelta) < 1e-8
        ? "Indifferent"
        : meanDelta > 0
          ? "Call"
          : "Fold";
    const outcomes = [...pairs.values()].sort((a, b) => b.mass - a.mass);
    return {
      available: true,
      model: "Malmuth-Harville ICM",
      unit: "prize-units",
      method,
      samples,
      decision,
      expectedCallPrize: meanCall[heroIndex],
      expectedFoldPrize: meanFold[heroIndex],
      deltaCallVsFold: meanDelta,
      standardError,
      confidence95:
        method === "exact"
          ? null
          : [
              meanDelta - 1.96 * standardError,
              meanDelta + 1.96 * standardError,
            ],
      totalPrize: tournament.payouts.reduce((a, b) => a + b, 0),
      eliminationRule: tournament.eliminationRule,
      players: names.map((name, playerIndex) => ({
        playerIndex,
        name,
        ...(playerIndex < tableSeats.length
          ? { seatId: tableSeats[playerIndex].id }
          : {}),
        expectedCallPrize: meanCall[playerIndex],
        expectedFoldPrize: meanFold[playerIndex],
      })),
      outcomeCount: outcomes.length,
      outcomes: outcomes
        .slice(0, 12)
        .map((outcome) => ({
          ...outcome,
          probability: outcome.mass / totalWeight,
        })),
      outcomesTruncated: outcomes.length > 12,
      assumptions: [
        "ICM is evaluated separately for each complete outcome, including the Fold branch.",
        "All remaining players and prizes are supplied; players at other tables retain their stacks.",
        "Both branches close all remaining betting. Hypothetical Fold/Call does not change the explicitly conditioned priors.",
        "Simultaneous eliminations rank by hand-start stacks; equal starting stacks share the combined prizes.",
        "Prize values include any guaranteed cash and elimination awards. No bounties, rake, skill edges or future-game simulation.",
      ],
    };
  }
  return { observe, finish };
}
module.exports = { createICMObserver };
