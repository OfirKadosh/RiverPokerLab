const { ValidationError } = require("./errors");
const { chipUnits } = require("./payouts");

function validateICMInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("ICM input must be an object.");
  if (
    !Array.isArray(input.players) ||
    input.players.length < 2 ||
    input.players.length > 9
  )
    throw new ValidationError(
      "ICM supports all 2 to 9 remaining tournament players.",
    );
  const players = Array.from(input.players, (player, index) => {
    if (
      !player ||
      typeof player !== "object" ||
      Array.isArray(player) ||
      typeof player.name !== "string" ||
      !player.name.trim() ||
      player.name.trim().length > 40
    )
      throw new ValidationError(
        `Player ${index + 1} must have a name of 1 to 40 characters.`,
      );
    if (chipUnits(player.stack, `Player ${index + 1} stack`) <= 0)
      throw new ValidationError(
        "Every remaining player must have a positive stack. Remove eliminated players and their already awarded prizes.",
      );
    return { name: player.name.trim(), stack: player.stack };
  });
  if (
    !Array.isArray(input.payouts) ||
    input.payouts.length < 1 ||
    input.payouts.length > players.length
  )
    throw new ValidationError(
      "Enter 1 to N remaining payouts, ordered from first to last place.",
    );
  const payouts = Array.from(input.payouts, (amount, index) => {
    chipUnits(amount, `Place ${index + 1} payout`);
    if (index > 0 && amount > input.payouts[index - 1])
      throw new ValidationError(
        "Payouts must be ordered from highest to lowest.",
      );
    return amount;
  });
  const totalChips = players.reduce(
    (sum, player) => sum + chipUnits(player.stack),
    0,
  );
  const totalPrize = payouts.reduce(
    (sum, amount) => sum + chipUnits(amount),
    0,
  );
  if (!Number.isSafeInteger(totalChips) || !Number.isSafeInteger(totalPrize))
    throw new ValidationError(
      "Total chips and remaining prizes must stay within safe numeric precision.",
    );
  if (totalPrize <= 0)
    throw new ValidationError("At least one payout must be positive.");
  return {
    players,
    payouts: [...payouts, ...Array(players.length - payouts.length).fill(0)],
  };
}

// Subset DP: each mask records which players have already finished ahead.
// All finish orders are aggregated without Monte Carlo or factorial enumeration.
function calculateICM(input) {
  const { players, payouts } = validateICMInput(input);
  const n = players.length,
    states = 1 << n;
  const stacks = players.map((player) => chipUnits(player.stack));
  const totalChips = stacks.reduce((sum, stack) => sum + stack, 0);
  const totalPrize =
    payouts.reduce((sum, amount) => sum + chipUnits(amount), 0) / 100;
  const mass = new Float64Array(states);
  mass[0] = 1;
  const finish = players.map(() => Array(n).fill(0));
  for (let mask = 0; mask < states - 1; mask++) {
    let place = 0,
      remaining = 0;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) place++;
      else remaining += stacks[i];
    }
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const probability = mass[mask] * (stacks[i] / remaining);
      finish[i][place] += probability;
      mass[mask | (1 << i)] += probability;
    }
  }
  return {
    model: "Malmuth-Harville ICM",
    method: "exact-subset-dp",
    playerCount: n,
    totalChips: totalChips / 100,
    totalPrize,
    payouts,
    results: players.map((player, playerIndex) => {
      const chipShare = stacks[playerIndex] / totalChips;
      const prizeEquity = finish[playerIndex].reduce(
        (sum, probability, place) => sum + probability * payouts[place],
        0,
      );
      return {
        playerIndex,
        ...player,
        chipShare,
        prizeEquity,
        prizeShare: prizeEquity / totalPrize,
        proportionalPrize: chipShare * totalPrize,
        differenceFromProportional: prizeEquity - chipShare * totalPrize,
        finishProbabilities: finish[playerIndex],
      };
    }),
  };
}
module.exports = { validateICMInput, calculateICM };
