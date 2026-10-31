const { effectiveRange } = require("./weightedRanges");
const { cardFromString } = require("./card");
const { ValidationError } = require("./errors");
const maskOf = (cards) =>
  cards.reduce((mask, card) => mask | (1n << BigInt(card)), 0n);
function createJointSampler(
  candidates,
  board = [],
  random = Math.random,
  maxProposals = 2000000,
  candidateWeights,
) {
  const entries = candidates.map((combos, index) => {
    let total = 0;
    const weights = candidateWeights?.[index] || combos.map(() => 1);
    if (
      !Array.isArray(weights) ||
      weights.length !== combos.length ||
      weights.some(
        (w) => typeof w !== "number" || !Number.isFinite(w) || w <= 0,
      )
    )
      throw new ValidationError("Combo weights must be finite and positive.");
    const result = combos.map((cards, i) => ({
      cards,
      mask: maskOf(cards),
      cumulative: (total += weights[i]),
    }));
    if (!Number.isFinite(total))
      throw new ValidationError("Total combo weight must be finite.");
    return result;
  });
  if (entries.some((list) => !list.length))
    throw new ValidationError(
      "A player has no legal combinations after known-card blockers.",
    );
  const boardMask = maskOf(board);
  // Feasibility search is separate from sampling; its first solution is never used as a sample.
  const ordered = [...entries].sort((a, b) => a.length - b.length);
  const memo = new Set();
  let nodes = 0;
  function feasible(index, used) {
    if (index === ordered.length) return true;
    if (++nodes > 100000)
      throw new ValidationError(
        "Range compatibility search exceeded its limit. Narrow the ranges and retry.",
      );
    const key = `${index}:${used}`;
    if (memo.has(key)) return false;
    let union = 0n;
    for (let i = index; i < ordered.length; i++)
      for (const entry of ordered[i]) {
        if (!(entry.mask & used)) union |= entry.mask;
      }
    let available = 0;
    for (let bits = union; bits; bits &= bits - 1n) available++;
    if (available < 2 * (ordered.length - index)) return false;
    for (const entry of ordered[index])
      if (!(entry.mask & used) && feasible(index + 1, used | entry.mask))
        return true;
    memo.add(key);
    return false;
  }
  if (!feasible(0, boardMask))
    throw new ValidationError(
      "These ranges cannot be dealt together without duplicate cards.",
    );
  let proposals = 0;
  function draw() {
    while (proposals++ < maxProposals) {
      let used = boardMask;
      const hands = [];
      let valid = true;
      for (const list of entries) {
        // Independent weighted combo selection. Reject the complete proposal on any collision.
        const target = random() * list[list.length - 1].cumulative;
        let low = 0,
          high = list.length - 1;
        while (low < high) {
          const mid = (low + high) >> 1;
          if (target < list[mid].cumulative) high = mid;
          else low = mid + 1;
        }
        const entry = list[low];
        if (used & entry.mask) {
          valid = false;
          break;
        }
        used |= entry.mask;
        hands.push(entry.cards);
      }
      if (valid) return hands;
    }
    throw new ValidationError(
      "Range overlap is too high to complete the requested samples within the proposal limit. Narrow the ranges or reduce iterations. No partial equity is returned.",
    );
  }
  return {
    draw,
    get proposals() {
      return proposals;
    },
  };
}
function prepareRanges(players, board, iterations) {
  const known = new Set(
    [...board, ...players.filter(Array.isArray).flat()].map(cardFromString),
  );
  const rangeStats = [];
  const candidateWeights = [];
  const candidates = players.map((player, playerIndex) => {
    if (Array.isArray(player)) {
      candidateWeights.push([1]);
      return [player.map(cardFromString)];
    }
    const parsed = effectiveRange(player);
    const all = parsed.entries.map((entry) => entry.cards);
    const available = all.filter((combo) =>
      combo.every((card) => !known.has(card)),
    );
    if (!available.length)
      throw new ValidationError(
        `Player ${playerIndex + 1} has no combinations remaining after known-card blockers.`,
      );
    candidateWeights.push(
      parsed.entries
        .filter((entry) => entry.cards.every((card) => !known.has(card)))
        .map((entry) => entry.weight),
    );
    rangeStats.push({
      ...(player.actionRanges ||
      player.rangeAction ||
      parsed.entries.some((e) => e.weight !== 1)
        ? {
            observedAction: player.rangeAction || "base",
            totalMass: parsed.entries.reduce((sum, e) => sum + e.weight, 0),
            availableMass: parsed.entries
              .filter((e) => e.cards.every((card) => !known.has(card)))
              .reduce((sum, e) => sum + e.weight, 0),
          }
        : {}),
      playerIndex,
      totalCombos: all.length,
      availableCombos: available.length,
      blockedCombos: all.length - available.length,
    });
    return available;
  });
  return {
    rangeStats,
    candidates,
    candidateWeights,
    weighted: candidateWeights.some((list) =>
      list.some((weight) => weight !== 1),
    ),
    sampler: createJointSampler(
      candidates,
      board.map(cardFromString),
      Math.random,
      Math.min(2000000, Math.max(10000, iterations * 200)),
      candidateWeights,
    ),
  };
}
module.exports = { maskOf, createJointSampler, prepareRanges };
