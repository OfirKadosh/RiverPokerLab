const { validateSimulationInput } = require("./validation");
const { evaluate5CardHand } = require("./evaluator");
const { cardFromString, createDeck } = require("./card");
const { ValidationError } = require("./errors");
const { preparePots, settleScores } = require("./payouts");
const { planExact, enumerateStates } = require("./exact");
const { prepareRanges } = require("./rangeSampler");
function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  return [
    ...getCombinations(arr.slice(1), k - 1).map((rest) => [arr[0], ...rest]),
    ...getCombinations(arr.slice(1), k),
  ];
}
const HOLDEM_PATTERNS = getCombinations([0, 1, 2, 3, 4, 5, 6], 5);
const OMAHA_HOLE_PATTERNS = getCombinations([0, 1, 2, 3], 2);
const OMAHA_BOARD_PATTERNS = getCombinations([0, 1, 2, 3, 4], 3);
function evaluatePlayer(hole, board, gameType) {
  let best = -1;
  if (gameType === "omaha") {
    for (const h of OMAHA_HOLE_PATTERNS)
      for (const b of OMAHA_BOARD_PATTERNS) {
        best = Math.max(
          best,
          evaluate5CardHand([
            hole[h[0]],
            hole[h[1]],
            ...b.map((index) => board[index]),
          ]),
        );
      }
  } else {
    const all = [...hole, ...board];
    for (const pattern of HOLDEM_PATTERNS)
      best = Math.max(
        best,
        evaluate5CardHand(pattern.map((index) => all[index])),
      );
  }
  return best;
}
function runEquitySimulation(
  players,
  board = [],
  gameType = "holdem",
  iterations = 5000,
  options = {},
) {
  ({ players, board, gameType, iterations } = validateSimulationInput(
    players,
    board,
    gameType,
    iterations,
  ));
  const eligible = options.eligibleIndices || players.map((_, index) => index);
  if (
    !Array.isArray(eligible) ||
    !eligible.length ||
    new Set(eligible).size !== eligible.length ||
    eligible.some(
      (index) =>
        !Number.isInteger(index) || index < 0 || index >= players.length,
    )
  )
    throw new (require("./errors").ValidationError)(
      "Eligible player indices are invalid.",
    );
  const numericBoard = board.map(cardFromString);
  const hasRanges = players.some((player) => !Array.isArray(player));
  const prepared = hasRanges ? prepareRanges(players, board, iterations) : null;
  const fixedHands = hasRanges
    ? null
    : players.map((hand) => hand.map(cardFromString));
  const method = options.method || "monteCarlo";
  if (!["auto", "exact", "monteCarlo"].includes(method))
    throw new ValidationError(
      "Calculation method must be auto, exact or monteCarlo.",
    );
  const candidates = prepared?.candidates || fixedHands.map((hand) => [hand]);
  const exactPlan =
    method === "monteCarlo"
      ? null
      : planExact(candidates, numericBoard, gameType);
  if (method === "exact" && !exactPlan.available)
    throw new ValidationError(exactPlan.reason + " Use Auto or Monte Carlo.");
  const useExact = !!exactPlan?.available;
  if (useExact && exactPlan.states === 0)
    throw new ValidationError("No legal joint deals remain.");
  const payoutPlan = options.pots
    ? preparePots(
        options.pots,
        players.length,
        eligible,
        options.seatIds || players.map((_, i) => i),
        options.dealerSeatId ?? 0,
        options.chipUnit ?? 0.01,
      )
    : null;
  const wins = Array(players.length).fill(0),
    means = Array(players.length).fill(0),
    m2 = Array(players.length).fill(0);
  const potMeans = payoutPlan?.pots.map(() => Array(players.length).fill(0));
  let totalWeight = 0;
  let samples = 0,
    deterministicSettlement;
  function observe(hands, sampledBoard, weight = 1) {
    const scores = hands.map((hand) =>
      evaluatePlayer(hand, sampledBoard, gameType),
    );
    const maximum = Math.max(...eligible.map((index) => scores[index]));
    const winners = eligible.filter((index) => scores[index] === maximum);
    for (const winner of winners) wins[winner] += weight / winners.length;
    samples++;
    totalWeight += weight;
    if (payoutPlan) {
      const settled = settleScores(scores, payoutPlan);
      for (let i = 0; i < players.length; i++) {
        const value = settled.payouts[i] / 100,
          delta = value - means[i];
        means[i] += (weight * delta) / totalWeight;
        m2[i] += weight * delta * (value - means[i]);
      }
      settled.pots.forEach((pot, index) => {
        const amounts = Array(players.length).fill(0);
        for (const share of pot.shares)
          amounts[share.playerIndex] = share.amount;
        for (let i = 0; i < players.length; i++)
          potMeans[index][i] +=
            (weight * (amounts[i] - potMeans[index][i])) / totalWeight;
      });
      if (!hasRanges && board.length === 5) deterministicSettlement = settled;
      options.onOutcome?.({ scores, settlement: settled, weight });
    }
  }
  if (useExact) {
    const count = enumerateStates(
      candidates,
      numericBoard,
      observe,
      prepared?.candidateWeights,
    );
    if (count !== exactPlan.states)
      throw new Error("Exact state count mismatch.");
  } else
    for (let sample = 0; sample < iterations; sample++) {
      const hands = prepared ? prepared.sampler.draw() : fixedHands;
      const used = new Set([...numericBoard, ...hands.flat()]);
      const remaining = createDeck().filter((card) => !used.has(card));
      const sampledBoard = [...numericBoard];
      for (let i = 0; i < 5 - numericBoard.length; i++) {
        const j = i + Math.floor(Math.random() * (remaining.length - i));
        [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
        sampledBoard.push(remaining[i]);
      }
      observe(hands, sampledBoard);
    }
  const rounded = (value) => Number(value.toFixed(6));
  return {
    results: wins.map((win, playerIndex) => ({
      playerIndex,
      equity: Number(((win / totalWeight) * 100).toFixed(2)),
    })),
    rangeStats: prepared?.rangeStats || [],
    sampling: hasRanges
      ? prepared.weighted
        ? "weighted-combos-conditioned-on-no-collisions"
        : "uniform-combos-conditioned-on-no-collisions"
      : "specific-hands",
    method: useExact ? "exact" : "monteCarlo",
    samples,
    ...(exactPlan ? { enumeration: exactPlan } : {}),
    ...(prepared && !useExact ? { proposals: prepared.sampler.proposals } : {}),
    ...(payoutPlan
      ? {
          payouts: means.map((expectedPayout, playerIndex) => ({
            playerIndex,
            expectedPayout: rounded(expectedPayout),
            standardError:
              useExact || samples < 2
                ? 0
                : rounded(
                    Math.sqrt(
                      Math.max(0, m2[playerIndex]) / (samples - 1) / samples,
                    ),
                  ),
          })),
          potExpectations: payoutPlan.pots.map((pot, index) => ({
            potIndex: index,
            amount: pot.amount / 100,
            eligibleIndices: pot.eligibleIndices,
            expectedPayouts: potMeans[index].map(rounded),
          })),
          ...(deterministicSettlement
            ? {
                settlement: {
                  pots: deterministicSettlement.pots,
                  payouts: deterministicSettlement.payouts.map(
                    (value) => value / 100,
                  ),
                },
              }
            : {}),
        }
      : {}),
  };
}
// Preserve the original public function and its result shape for direct callers.
function runMonteCarloSimulation(
  players,
  board = [],
  gameType = "holdem",
  iterations = 5000,
) {
  return runEquitySimulation(players, board, gameType, iterations).results;
}
module.exports = {
  runMonteCarloSimulation,
  runEquitySimulation,
  cardToInt: cardFromString,
  evaluatePlayer,
};
