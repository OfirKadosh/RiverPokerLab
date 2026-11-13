const { validateICMInput } = require("./icm");
const { resolveTournamentOutcome } = require("./tournament");
const { buildHandSetup } = require("./handSetup");
const { preparePots, settleScores } = require("./payouts");
const { ALL_CLASSES, combosForClass } = require("./rangeParser");
const { parseWeightedRange } = require("./weightedRanges");
const { cardFromString, createDeck } = require("./card");
const { evaluatePlayer } = require("./engine");
const { ValidationError } = require("./errors");

const LIMITS = Object.freeze({ minSamplesPerHand: 30, maxSamplesPerHand: 240, maxRemainingPlayers: 9 });
const HAND_CLASSES = ALL_CLASSES.map((label) => ({ label, combos: combosForClass(label) }));
const deck = createDeck();

function requireInput(condition, message) {
  if (!condition) throw new ValidationError(message);
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

const comboIndex = (a, b) => Math.min(a, b) * 52 + Math.max(a, b);
const overlaps = (a, b) => a.includes(b[0]) || a.includes(b[1]);

function policy(text, cache) {
  requireInput(typeof text === "string" && text.length <= 2048, "Enter a range of at most 2048 characters per action.");
  const range = text.trim();
  if (!cache.has(range)) {
    const weights = new Float64Array(52 * 52);
    const entries = range ? parseWeightedRange(range).entries : [];
    for (const { cards: [a, b], weight } of entries) weights[comboIndex(a, b)] = weight;
    cache.set(range, { weights, entries });
  }
  return cache.get(range);
}

function prepare(input) {
  const { players, hero, dealer, shover, smallBlind, bigBlind, ante, payouts,
    outsidePlayers = [], samples = 120, seed = 73129, hand } = input ?? {};
  requireInput(Array.isArray(players) && players.length >= 2 && players.length <= LIMITS.maxRemainingPlayers &&
    Array.isArray(outsidePlayers) && players.length + outsidePlayers.length <= LIMITS.maxRemainingPlayers,
  "Enter 2–9 table players and all remaining stacks, up to 9 players in total.");
  const last = players.length - 1;
  requireInput(integer(hero, 0, last) && integer(dealer, 0, last) &&
    (shover === undefined || (integer(shover, 0, last) && shover !== hero)), "Choose valid seats.");
  requireInput(integer(smallBlind, 1, 1e8) && integer(bigBlind, smallBlind, 1e8) &&
    integer(ante, 0, 1e8), "Enter whole chips for blinds and per-player ante.");
  requireInput(integer(samples, LIMITS.minSamplesPerHand, LIMITS.maxSamplesPerHand) && integer(seed, 0, 0xffffffff),
    `Use ${LIMITS.minSamplesPerHand}–${LIMITS.maxSamplesPerHand} samples per hand and a valid seed.`);
  const { players: field, payouts: prizes } = validateICMInput({ players: [...players, ...outsidePlayers], payouts });
  requireInput(field.every(({ stack }) => integer(stack, 1, 1e8)), "Stacks must be positive whole chips.");
  const setup = buildHandSetup(field.slice(0, players.length).map(({ stack }, id) =>
    ({ id, startingStack: stack })), dealer, smallBlind, bigBlind);
  const posted = players.map((_, index) => setup.positions.find(({ seatId }) => seatId === index).posted);
  requireInput(players.every((_, index) => field[index].stack > ante + posted[index]),
    "Each table player must have chips behind after posting their ante and blind.");
  const order = setup.preflopOrder;
  const heroPosition = order.indexOf(hero);
  if (shover === undefined) requireInput(heroPosition < order.length - 1, "The big blind has no unopened push decision.");
  else {
    requireInput(order.indexOf(shover) < heroPosition, "The shover must act before Hero preflop.");
    requireInput(field[shover].stack - ante > posted[hero], "Hero must face an additional amount to call.");
  }

  const cache = new Map();
  const callPolicies = players.map((player, i) => i === hero || order.indexOf(i) < heroPosition
    ? null : policy(player.callRange ?? "", cache));
  const pushPolicies = players.map((player, i) => shover !== undefined || order.indexOf(i) <= heroPosition ||
    i === setup.bigBlindSeatId ? null : policy(player.pushRange ?? "", cache));
  const shove = shover === undefined ? null : policy(players[shover].pushRange ?? "", cache);
  requireInput(!shove || shove.entries.length > 0, "Enter the observed shover's range.");
  let classes = HAND_CLASSES;
  if (hand !== undefined) {
    requireInput(Array.isArray(hand) && hand.length === 2, "Enter exactly two Hero cards.");
    const cards = Array.from(hand, cardFromString);
    requireInput(cards[0] !== cards[1], "Hero cards must be distinct.");
    classes = [{ label: hand.join(" "), combos: [cards] }];
  }
  return {
    field, prizes, ante, posted, order, heroPosition, hero, dealer, shover, samples, seed, callPolicies, pushPolicies,
    shove, classes, bb: setup.bigBlindSeatId,
  };
}

function seededRandom(seed) {
  let state = seed;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function weightedChoice(entries, mass, rng) {
  let remaining = rng() * mass;
  for (const entry of entries) {
    remaining -= entry.weight;
    if (remaining < 0) return entry;
  }
  return entries[entries.length - 1];
}

function prepareDeals(combos, shove) {
  if (!shove) return { entries: combos.map((cards) => ({ cards, weight: 1 })), mass: combos.length };
  const entries = [];
  let mass = 0;
  for (const cards of combos) {
    const compatible = shove.entries.filter((entry) => !overlaps(cards, entry.cards));
    const weight = compatible.reduce((sum, entry) => sum + entry.weight, 0);
    if (weight > 0) {
      entries.push({ cards, compatible, weight });
      mass += weight;
    }
  }
  return { entries, mass };
}

function deal(config, distribution, rng) {
  const count = config.posted.length;
  const heroCombo = weightedChoice(distribution.entries, distribution.mass, rng);
  const holes = Array(count);
  holes[config.hero] = heroCombo.cards;
  if (config.shove) holes[config.shover] = weightedChoice(heroCombo.compatible, heroCombo.weight, rng).cards;
  const reserved = new Set(holes.flat());
  const available = deck.filter((card) => !reserved.has(card));
  let offset = 0;
  function draw() {
    const choice = offset + Math.floor(rng() * (available.length - offset));
    const card = available[choice];
    available[choice] = available[offset++];
    return card;
  }
  for (let i = 0; i < count; i++) if (!holes[i]) holes[i] = [draw(), draw()];
  return { holes, board: Array.from({ length: 5 }, draw), rolls: holes.map(() => rng()), scores: [] };
}

function resolveLine(config, sample, aggressive, cache) {
  const { hero, shover, ante, posted, field, order, heroPosition, callPolicies, pushPolicies, bb, dealer } = config;
  const available = field.slice(0, posted.length).map(({ stack }) => stack - ante);
  const bets = [...posted];
  const live = new Set();
  let firstShove = shover;
  if (shover === undefined && aggressive) firstShove = hero;
  if (firstShove !== undefined) {
    bets[firstShove] = available[firstShove];
    live.add(firstShove);
  }
  const rolls = sample.rolls;
  const handKeys = sample.holes.map(([a, b]) => comboIndex(a, b));

  for (const i of order.slice(heroPosition)) {
    if (i === firstShove) continue;
    if (i === hero && !aggressive) continue;
    if (firstShove === undefined) {
      if (i === bb) break;
      if (rolls[i] >= pushPolicies[i].weights[handKeys[i]]) continue;
      firstShove = i;
      bets[i] = available[i];
      live.add(i);
    } else {
      const target = Math.min(Math.max(bets[firstShove], ...posted), available[i]);
      if (i === hero || bets[i] >= target || rolls[i] < callPolicies[i].weights[handKeys[i]]) {
        bets[i] = target;
        live.add(i);
      }
    }
  }
  if (!live.size) live.add(bb);

  const key = bets.join(",") + "|" + [...live].sort((a, b) => a - b).join(",");
  let prepared = cache.plans.get(key);
  if (!prepared) {
    const remaining = available.map((stack, i) => stack - bets[i]);
    const eligible = [...live];
    const pots = [];
    let previous = 0;
    // Antes are dead chips. A layer without a live contributor joins the previous pot.
    for (const level of [...new Set(bets.filter(Boolean))].sort((a, b) => a - b)) {
      const contributors = bets.flatMap((bet, i) => bet >= level ? [i] : []);
      const contenders = contributors.filter((i) => live.has(i));
      const layer = (level - previous) * contributors.length;
      previous = level;
      if (contributors.length === 1 && contenders.length === 1) remaining[contenders[0]] += layer;
      else if (contenders.length) pots.push({ amount: layer, eligibleIndices: contenders });
      else if (pots.length) pots[pots.length - 1].amount += layer;
      else pots.push({ amount: layer, eligibleIndices: eligible });
    }
    if (pots.length) pots[0].amount += ante * posted.length;
    else if (ante) pots.push({ amount: ante * posted.length, eligibleIndices: eligible });
    prepared = { remaining, plan: preparePots(pots, posted.length, eligible, posted.map((_, i) => i), dealer, 1) };
    cache.plans.set(key, prepared);
  }
  const scores = posted.map(() => -1);
  if (live.size > 1) {
    for (const i of live) scores[i] = sample.scores[i] ??= evaluatePlayer(sample.holes[i], sample.board, "holdem");
  }
  const payouts = settleScores(scores, prepared.plan).payouts;
  const stacks = [...prepared.remaining.map((stack, i) => stack + payouts[i] / 100),
    ...field.slice(posted.length).map(({ stack }) => stack)];
  const outcomeKey = stacks.join(",");
  if (!cache.icm.has(outcomeKey)) {
    const result = resolveTournamentOutcome(stacks, cache.starting, config.prizes);
    if (cache.icm.size >= 8192) cache.icm.clear();
    cache.icm.set(outcomeKey, result.values[hero]);
  }
  return { chips: stacks[hero] - field[hero].stack, prize: cache.icm.get(outcomeKey) };
}

function analyzePushFold(input) {
  const config = prepare(input);
  const rng = seededRandom(config.seed);
  const cache = { plans: new Map(), icm: new Map(), starting: config.field.map(({ stack }) => stack) };
  const rows = [];
  const blockedHands = [];
  for (const { label, combos } of config.classes) {
    const distribution = prepareDeals(combos, config.shove);
    if (!distribution.mass) {
      blockedHands.push(label);
      continue;
    }
    const aggressive = { chips: 0, prize: 0 };
    const fold = { chips: 0, prize: 0 };
    let difference = 0;
    let m2 = 0;
    for (let sampleIndex = 1; sampleIndex <= config.samples; sampleIndex++) {
      const sample = deal(config, distribution, rng);
      const a = resolveLine(config, sample, true, cache);
      const f = resolveLine(config, sample, false, cache);
      aggressive.chips += a.chips / config.samples;
      aggressive.prize += a.prize / config.samples;
      fold.chips += f.chips / config.samples;
      fold.prize += f.prize / config.samples;
      const delta = a.prize - f.prize;
      const adjustment = delta - difference;
      difference += adjustment / sampleIndex;
      m2 += adjustment * (delta - difference);
    }
    const margin = 1.96 * Math.sqrt(Math.max(0, m2) / (config.samples - 1) / config.samples);
    const action = config.shove ? "call" : "push";
    const recommendation = difference - margin > 1e-8 ? action : difference + margin < -1e-8 ? "fold" : "close";
    rows.push({ hand: label, aggressive, fold, prizeDelta: difference, chipDelta: aggressive.chips - fold.chips,
      confidence95: [difference - margin, difference + margin], recommendation });
  }
  requireInput(rows.length > 0, "Hero's cards block every combo in the observed shove range.");
  return { model: "fixed-response-policy", method: "monte-carlo", samplesPerHand: config.samples,
    seed: config.seed, action: config.shove ? "call" : "push", rows, blockedHands };
}

module.exports = { analyzePushFold, LIMITS };
