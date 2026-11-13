const {
  prepareTable, seededRandom, completeDeal, valueTerminal, comboIndex, HAND_CLASSES,
} = require("./pushFold");
const { ValidationError } = require("./errors");

const LIMITS = Object.freeze({ minRounds: 4, maxRounds: 16, dealsPerRound: 1500, dealsPerEvaluation: 6000 });
const HAND_COUNT = HAND_CLASSES.length;
const classByCombo = new Uint8Array(52 * 52);
for (const [index, { combos }] of HAND_CLASSES.entries()) {
  for (const [a, b] of combos) classByCombo[comboIndex(a, b)] = index;
}

function buildGame(table) {
  const { order, posted, available, bb } = table;
  const roots = Array(order.length);
  // Abstract prior callers by count for training, but keep their exact seats in every terminal pot.
  const contexts = [];
  const calls = new Map();
  const terminals = new Map();
  function context(seat, action, shover = null, priorCallers = 0) {
    const item = { id: contexts.length, seat, action, shover, priorCallers,
      regret: new Float64Array(HAND_COUNT), visits: new Uint32Array(HAND_COUNT),
      weightedVisits: new Float64Array(HAND_COUNT), squaredWeights: new Float64Array(HAND_COUNT),
      average: new Float64Array(HAND_COUNT), weight: new Float64Array(HAND_COUNT),
      policy: new Float64Array(HAND_COUNT).fill(0.5) };
    contexts.push(item);
    return item;
  }
  function terminal(shove, callers) {
    const key = shove * 512 + callers;
    if (terminals.has(key)) return terminals.get(key);
    const live = new Set(shove === -1 ? [bb] : [shove]);
    const bets = [...posted];
    if (shove !== -1) {
      bets[shove] = available[shove];
      const target = Math.max(bets[shove], ...posted);
      for (const seat of order) {
        if (!(callers & (1 << seat))) continue;
        live.add(seat);
        bets[seat] = Math.min(target, available[seat]);
      }
    }
    const leaf = { key, live, bets };
    terminals.set(key, leaf);
    return leaf;
  }
  function facing(position, shove, callers, count) {
    if (position === order.length) return terminal(shove, callers);
    const seat = order[position];
    if (posted[seat] >= Math.min(available[seat], Math.max(available[shove], ...posted))) {
      return facing(position + 1, shove, callers | (1 << seat), count + 1);
    }
    const key = `${seat}:${shove}:${count}`;
    if (!calls.has(key)) calls.set(key, context(seat, "call", shove, count));
    return {
      context: calls.get(key),
      aggressive: facing(position + 1, shove, callers | (1 << seat), count + 1),
      fold: facing(position + 1, shove, callers, count),
    };
  }
  roots[order.length - 1] = terminal(-1, 0);
  for (let position = order.length - 2; position >= 0; position--) {
    const seat = order[position];
    roots[position] = {
      context: context(seat, "push"), aggressive: facing(position + 1, seat, 0, 0), fold: roots[position + 1],
    };
  }
  return { root: roots[0], contexts, cache: { plans: new Map(), icm: new Map() } };
}

function play(table, game, sample, node, hands) {
  while (node.context) {
    const { context } = node;
    node = sample.rolls[context.seat] < context.policy[hands[context.seat]] ? node.aggressive : node.fold;
  }
  if (!sample.payoffs.has(node.key)) {
    sample.payoffs.set(node.key, valueTerminal(table, sample, node.bets, node.live, game.cache, node.key).values);
  }
  return sample.payoffs.get(node.key);
}

function sampleDecisions(table, game, rng, exploration, visit) {
  const sample = completeDeal(Array(table.order.length), rng);
  sample.payoffs = new Map();
  const hands = sample.holes.map(([a, b]) => classByCombo[comboIndex(a, b)]);
  let node = game.root;
  let reachWeight = 1;
  while (node.context) {
    const { context } = node;
    const { seat, policy } = context;
    const hand = hands[seat];
    const frequency = policy[hand];
    const gain = play(table, game, sample, node.aggressive, hands)[seat] -
      play(table, game, sample, node.fold, hands)[seat];
    visit(context, hand, frequency, gain, reachWeight);
    const behavior = frequency * (1 - exploration) + exploration / 2;
    const aggressive = rng() < behavior;
    reachWeight *= aggressive ? frequency / behavior : (1 - frequency) / (1 - behavior);
    node = aggressive ? node.aggressive : node.fold;
  }
}

function fitDeviations(table, game, rng) {
  const gains = game.contexts.map(() => new Float64Array(HAND_COUNT));
  const counts = game.contexts.map(() => new Uint32Array(HAND_COUNT));
  for (let i = 0; i < LIMITS.dealsPerEvaluation; i++) {
    sampleDecisions(table, game, rng, 0, (context, hand, _, gain) => {
      gains[context.id][hand] += gain;
      counts[context.id][hand]++;
    });
  }
  return game.contexts.map(({ id, policy }) => policy.map((frequency, hand) => {
    const gain = gains[id][hand];
    return counts[id][hand] < 4 || gain === 0 ? frequency : Number(gain > 0);
  }));
}

function measureDeviations(table, game, rng, deviations) {
  const sums = new Float64Array(table.order.length);
  const squares = new Float64Array(table.order.length);
  for (let i = 0; i < LIMITS.dealsPerEvaluation; i++) {
    sampleDecisions(table, game, rng, 0, (context, hand, frequency, gain) => {
      const change = (deviations[context.id][hand] - frequency) * gain;
      sums[context.seat] += change;
      squares[context.seat] += change ** 2;
    });
  }
  return Array.from(sums, (sum, seat) => {
    const n = LIMITS.dealsPerEvaluation;
    const gain = sum / n;
    const margin = 1.96 * Math.sqrt(Math.max(0, squares[seat] - sum * gain) / (n - 1) / n);
    return { seat, gain, confidence95: [gain - margin, gain + margin] };
  });
}

function solvePushFold(input) {
  const { rounds = 10, seed = 73129 } = input ?? {};
  if (!Number.isSafeInteger(rounds) || rounds < LIMITS.minRounds || rounds > LIMITS.maxRounds ||
      !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new ValidationError(`Use ${LIMITS.minRounds}–${LIMITS.maxRounds} training rounds and a valid seed.`);
  }
  const table = prepareTable(input);
  const game = buildGame(table);
  const rng = seededRandom(seed);
  const updates = game.contexts.map(() => new Float64Array(HAND_COUNT));
  for (let round = 0; round < rounds; round++) {
    for (const update of updates) update.fill(0);
    for (let deal = 0; deal < LIMITS.dealsPerRound; deal++) {
      sampleDecisions(table, game, rng, 0.25, (context, hand, frequency, gain, reachWeight) => {
        // The behavior policy explores. Importance weights recover reach under the frozen profile.
        updates[context.id][hand] += reachWeight * gain;
        context.visits[hand]++;
        context.weightedVisits[hand] += reachWeight;
        context.squaredWeights[hand] += reachWeight ** 2;
        if (round >= Math.floor(rounds / 2)) {
          context.average[hand] += reachWeight * frequency;
          context.weight[hand] += reachWeight;
        }
      });
    }
    for (const context of game.contexts) {
      for (let hand = 0; hand < HAND_COUNT; hand++) {
        context.regret[hand] += updates[context.id][hand];
        // Smooth binary best responses across batches. A tie retains the current mix.
        const gain = context.regret[hand];
        if (gain !== 0) context.policy[hand] = 0.5 * (context.policy[hand] + Number(gain > 0));
      }
    }
  }
  for (const context of game.contexts) {
    for (let hand = 0; hand < HAND_COUNT; hand++) {
      if (context.weight[hand]) context.policy[hand] = context.average[hand] / context.weight[hand];
    }
  }

  // Train candidate one-seat deviations on fresh deals and score them on a separate sample.
  const deviations = fitDeviations(table, game, rng);
  return {
    model: "sampled-iterative-icm", rounds, seed, trainingDeals: rounds * LIMITS.dealsPerRound,
    evaluationDeals: LIMITS.dealsPerEvaluation,
    hands: HAND_CLASSES.map(({ label }) => label),
    seats: table.order.map((seat) => ({
      seat, name: table.field[seat].name,
      position: table.positions.find(({ seatId }) => seatId === seat).position,
    })),
    contexts: game.contexts.map(({ id, seat, action, shover, priorCallers, visits, policy, weightedVisits, squaredWeights }) => ({
      id, seat, action, shover, priorCallers,
      visits: Array.from(visits),
      frequencies: Array.from(policy, (frequency, hand) => weightedVisits[hand] ** 2 >= 4 * squaredWeights[hand] && visits[hand] >= 4 && weightedVisits[hand] > 0 ? frequency : null),
    })),
    deviations: measureDeviations(table, game, rng, deviations),
  };
}

module.exports = { solvePushFold, LIMITS };
