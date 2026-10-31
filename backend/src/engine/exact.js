const { maskOf } = require("./rangeSampler");
const { createDeck } = require("./card");
function choose(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}
function walkDeals(
  candidates,
  board,
  { maxDeals = Infinity, maxSteps = 250000, candidateWeights } = {},
  visit = () => {},
) {
  const lists = candidates
    .map((combos, index) => ({
      index,
      combos: combos.map((cards, i) => ({
        cards,
        mask: maskOf(cards),
        weight: candidateWeights?.[index]?.[i] ?? 1,
      })),
    }))
    .sort((a, b) => a.combos.length - b.combos.length);
  const hands = Array(lists.length);
  let deals = 0,
    steps = 0,
    overflow = false;
  function walk(at, used, weight) {
    if (overflow) return;
    if (at === lists.length) {
      if (++deals > maxDeals) {
        overflow = true;
        return;
      }
      visit(hands, weight);
      return;
    }
    for (const entry of lists[at].combos) {
      if (++steps > maxSteps) {
        overflow = true;
        return;
      }
      if (entry.mask & used) continue;
      hands[lists[at].index] = entry.cards;
      walk(at + 1, used | entry.mask, weight * entry.weight);
      if (overflow) return;
    }
  }
  walk(0, maskOf(board), 1);
  return { deals, steps, overflow };
}
function planExact(candidates, board, gameType) {
  const holes = candidates.reduce(
    (sum, list) => sum + (list[0]?.length || 0),
    0,
  );
  const runouts = choose(52 - holes - board.length, 5 - board.length);
  const perState = candidates.length * (gameType === "omaha" ? 60 : 21);
  const limit = Math.min(50000, Math.floor(2000000 / perState));
  if (runouts > limit)
    return {
      available: false,
      reason: "Runout count exceeds the exact work budget.",
      runouts,
      stateLimit: limit,
    };
  const result = walkDeals(candidates, board, {
    maxDeals: Math.floor(limit / runouts),
  });
  if (result.overflow)
    return {
      available: false,
      reason: "Joint range enumeration exceeds the exact work/search budget.",
      runouts,
      stateLimit: limit,
    };
  return {
    available: true,
    states: result.deals * runouts,
    jointDeals: result.deals,
    runouts,
    stateLimit: limit,
  };
}
function enumerateStates(candidates, board, observe, candidateWeights) {
  let count = 0;
  walkDeals(candidates, board, { candidateWeights }, (hands, weight) => {
    const used = new Set([...board, ...hands.flat()]);
    const remaining = createDeck().filter((card) => !used.has(card));
    const needed = 5 - board.length;
    const runout = [];
    function visit(start) {
      if (runout.length === needed) {
        observe(hands, [...board, ...runout], weight);
        count++;
        return;
      }
      for (
        let i = start;
        i <= remaining.length - (needed - runout.length);
        i++
      ) {
        runout.push(remaining[i]);
        visit(i + 1);
        runout.pop();
      }
    }
    visit(0);
  });
  return count;
}
module.exports = { choose, walkDeals, planExact, enumerateStates };
