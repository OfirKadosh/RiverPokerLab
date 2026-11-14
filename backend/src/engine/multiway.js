const { ValidationError } = require("./errors");
const { validateSimulationInput } = require("./validation");
const { cardFromString, createDeck } = require("./card");
const { prepareRanges } = require("./rangeSampler");
const { evaluatePlayer } = require("./engine");
const { chipUnits, preparePots, settleScores } = require("./payouts");
const { validateICMInput } = require("./icm");
const { resolveTournamentOutcome } = require("./tournament");
const { seededRandom } = require("./pushFold");

const LIMITS = Object.freeze({ minPlayers: 3, maxPlayers: 6, minSamples: 200, maxSamples: 6000, maxBetSizes: 3 });
const deck = createDeck();
function requireInput(condition, message) {
  if (!condition) throw new ValidationError(message);
}

function readInput(input) {
  const { players, board, mode, dealer, sizes = [], facingBet, samples = 2000, seed = 73129,
    chipUnit = 1, tournament } = input ?? {};
  requireInput(["cash", "tournament"].includes(mode), "Choose cash or tournament.");
  requireInput(Array.isArray(players) && players.length >= LIMITS.minPlayers && players.length <= LIMITS.maxPlayers,
    "Enter 3–6 players in the hand.");
  requireInput(Number.isInteger(dealer) && dealer >= 0 && dealer < players.length, "Choose a dealer seat.");
  requireInput(Number.isInteger(samples) && samples >= LIMITS.minSamples && samples <= LIMITS.maxSamples,
    "Use 200–6000 samples.");
  requireInput(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, "Enter a valid seed.");
  requireInput(Array.isArray(board) && board.length >= 3 && board.length <= 5, "Enter a flop, turn or river board.");
  const normalized = validateSimulationInput(players.map(p => p?.input), board, "holdem", samples);
  const unit = chipUnits(chipUnit, "Smallest chip");
  requireInput(unit > 0, "Smallest chip must be positive.");
  function amount(value, label) {
    const units = chipUnits(value, label);
    requireInput(units <= 1e10 && units % unit === 0, `${label} must align with the smallest chip and be at most 100 million chips.`);
    return units / unit;
  }
  const seats = players.map((p, i) => {
    requireInput(typeof p.name === "string" && p.name.trim().length >= 1 && p.name.trim().length <= 40,
      "Enter a name of 1–40 characters per seat.");
    const behind = amount(p.behind, "Stack behind"), invested = amount(p.invested, "Committed chips");
    const { callFrequency = 0.5 } = p;
    requireInput(typeof callFrequency === "number" && callFrequency >= 0 && callFrequency <= 1,
      "Call frequencies must be between zero and one.");
    return { i, name: p.name.trim(), behind, invested, callFrequency };
  });
  const originalPot = seats.reduce((sum, p) => sum + p.invested, 0);
  requireInput(originalPot > 0 && seats[0].behind > 0, "Enter chips in the pot and a positive Hero stack behind.");
  requireInput(Array.isArray(sizes) && sizes.length <= LIMITS.maxBetSizes, "Enter up to three bet sizes.");
  const bets = sizes.map(size => amount(size, "Bet size"));
  requireInput(new Set(bets).size === bets.length && bets.every(bet => bet > 0 && bet <= seats[0].behind),
    "Enter distinct positive bet sizes no greater than Hero's stack behind.");
  let wager = 0;
  if (facingBet !== undefined) {
    wager = amount(facingBet, "Outstanding bet");
    requireInput(wager > 0 && bets.length === 0, "Facing a bet supports Fold and Call.");
    requireInput(wager <= seats[1].invested, "Include the outstanding bet in Seat 2's committed chips.");
  }
  // Reconstruct the matched commitment before the current bet. Shorter commitments
  // are legal only for players who were already all-in.
  const base = seats[0].invested;
  for (const p of seats) {
    const contribution = p.invested - (wager && p.i === 1 ? wager : 0);
    requireInput(contribution === base || (contribution >= 0 && contribution < base && p.behind === 0 && !(wager && p.i === 1)),
      "Players with chips behind must have equal commitments before the outstanding bet. Shorter commitments require an existing all-in.");
  }
  requireInput(!bets.length || seats.slice(1).some(p => p.behind > 0), "An opponent needs chips behind to respond to a bet.");
  const starting = seats.map(p => (p.invested + p.behind) * unit / 100);
  requireInput(starting.every(s => s > 0), "Every seat must have a positive hand-start stack.");
  let field;
  if (mode === "tournament") {
    requireInput(tournament?.confirmed === true && Array.isArray(tournament.outsidePlayers),
      "Confirm all remaining stacks and payouts for tournament ICM.");
    field = validateICMInput({
      players: [...seats.map((p, i) => ({ name: p.name, stack: starting[i] })), ...tournament.outsidePlayers],
      payouts: tournament.payouts,
    });
    requireInput(field.players.slice(seats.length).every(p => amount(p.stack, "Outside stack") > 0),
      "Outside stacks must be positive and align with the smallest chip.");
  }
  return { seats, normalized, mode, dealer, unit, bets, wager, samples, seed, field, originalPot };
}

function makePlan(config, action, mask) {
  const { seats, wager, unit, dealer } = config;
  const investments = seats.map(p => p.invested);
  const behind = seats.map(p => p.behind);
  const live = [];
  for (const p of seats) {
    const folds = p.i === 0 ? action.type === "fold" : mask & (1 << p.i);
    if (folds) continue;
    live.push(p.i);
    const owing = p.i === 0 ? action.amount : (wager && p.i === 1 ? 0 : wager || action.amount);
    const paid = Math.min(behind[p.i], owing);
    investments[p.i] += paid;
    behind[p.i] -= paid;
  }
  let previous = 0;
  const pots = [];
  for (const level of [...new Set(investments)].sort((a, b) => a - b)) {
    const contributors = seats.filter(p => investments[p.i] >= level).map(p => p.i);
    const eligibleIndices = contributors.filter(i => live.includes(i));
    const amount = (level - previous) * contributors.length;
    previous = level;
    if (!amount) continue;
    if (contributors.length === 1 && eligibleIndices.length === 1) behind[eligibleIndices[0]] += amount;
    else if (eligibleIndices.length) pots.push({ amount: amount * unit / 100, eligibleIndices });
    else {
      if (!pots.length) throw new Error("Dead money requires a live lower pot.");
      pots.at(-1).amount += amount * unit / 100;
    }
  }
  return { behind, plan: preparePots(pots, seats.length, live, seats.map(p => p.i), dealer, unit / 100) };
}

function analyzeMultiway(input) {
  const config = readInput(input);
  const { seats, normalized, mode, unit, bets, wager, samples, seed, field, originalPot } = config;
  const random = seededRandom(seed);
  const board = normalized.board.map(cardFromString);
  const { sampler, rangeStats } = prepareRanges(normalized.players, normalized.board, samples, random);
  const initial = seats[0].behind * unit / 100;
  const actions = wager ? [{ type: "fold", amount: 0 }, { type: "call", amount: Math.min(wager, seats[0].behind) }] :
    [{ type: "check", amount: 0 }, ...bets.map(amount => ({ type: "bet", amount }))];
  const rows = actions.map(action => ({
    action, plans: new Map(), chip: 0, prizes: 0, delta: 0, m2: 0,
  }));
  const startingField = field?.players.map(p => p.stack);
  const outside = startingField?.slice(seats.length) ?? [];
  const prizeCache = new Map();
  for (let n = 1; n <= samples; n++) {
    const hands = sampler.draw();
    const used = new Set([...board, ...hands.flat()]);
    const remaining = deck.filter(card => !used.has(card));
    const runout = [...board];
    for (let i = 0; runout.length < 5; i++) {
      const j = i + Math.floor(random() * (remaining.length - i));
      [remaining[i], remaining[j]] = [remaining[j], remaining[i]];
      runout.push(remaining[i]);
    }
    const scores = hands.map(cards => evaluatePlayer(cards, runout, "holdem"));
    const responseMask = seats.reduce((mask, p) =>
      p.i !== 0 && !(wager && p.i === 1) && p.behind > 0 && random() >= p.callFrequency ? mask | (1 << p.i) : mask, 0);
    let reference = 0;
    for (const row of rows) {
      const mask = wager || row.action.amount ? responseMask : 0;
      if (!row.plans.has(mask)) row.plans.set(mask, makePlan(config, row.action, mask));
      const { behind, plan } = row.plans.get(mask);
      const { payouts } = settleScores(scores, plan);
      const stacks = behind.map((balance, i) => (balance * unit + payouts[i]) / 100);
      const chip = stacks[0] - initial;
      row.chip += (chip - row.chip) / n;
      let value = chip;
      if (field) {
        const key = stacks.join(",");
        if (!prizeCache.has(key)) {
          const { values } = resolveTournamentOutcome([...stacks, ...outside], startingField, field.payouts);
          if (prizeCache.size >= 8192) prizeCache.clear();
          prizeCache.set(key, values[0]);
        }
        value = prizeCache.get(key);
        row.prizes += (value - row.prizes) / n;
      }
      if (row === rows[0]) reference = value;
      const delta = value - reference;
      const offset = delta - row.delta;
      row.delta += offset / n;
      row.m2 += offset * (delta - row.delta);
    }
  }
  return {
    model: "fixed-response-checkdown", mode, samples, seed, board: normalized.board,
    pot: originalPot * unit / 100, hero: seats[0].name, rangeStats,
    ...(field ? { field: field.players, payouts: field.payouts } : {}),
    actions: rows.map(row => {
      const margin = 1.96 * Math.sqrt(Math.max(0, row.m2) / (samples - 1) / samples);
      return { type: row.action.type, amount: row.action.amount * unit / 100,
        chipEv: row.chip, prizeEv: mode === "tournament" ? row.prizes : null,
        delta: row.delta, interval95: [row.delta - margin, row.delta + margin] };
    }),
  };
}
module.exports = { analyzeMultiway, LIMITS };
