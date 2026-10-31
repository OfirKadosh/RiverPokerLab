const { ValidationError } = require("./errors");
function chipUnits(value, label = "Chip amount") {
  const raw = value * 100;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(Math.round(raw)) ||
    Math.abs(raw - Math.round(raw)) > 0.000001
  )
    throw new ValidationError(
      `${label} must use safe, non-negative amounts with at most two decimal places.`,
    );
  return Math.round(raw);
}
function preparePots(
  pots,
  playerCount,
  eligible,
  seatIds,
  dealerSeatId,
  chipUnit = 0.01,
) {
  const unit = chipUnits(chipUnit, "Smallest chip");
  if (unit <= 0) throw new ValidationError("Smallest chip must be positive.");
  if (
    !Array.isArray(seatIds) ||
    seatIds.length !== playerCount ||
    new Set(seatIds).size !== playerCount ||
    seatIds.some((id) => !Number.isInteger(id) || id < 0 || id > 8) ||
    !seatIds.includes(dealerSeatId)
  )
    throw new ValidationError("Payout seat order or dealer is invalid.");
  const clockwise = [...seatIds].sort((a, b) => a - b);
  const at = clockwise.indexOf(dealerSeatId);
  const order = [...clockwise.slice(at + 1), ...clockwise.slice(0, at + 1)].map(
    (id) => seatIds.indexOf(id),
  );
  if (!Array.isArray(pots) || pots.length > 9)
    throw new ValidationError(
      "Pot layers must be an array of at most nine pots.",
    );
  const plan = pots.map((pot, index) => {
    const amount = chipUnits(pot?.amount, "Pot amount");
    if (amount <= 0 || amount % unit !== 0)
      throw new ValidationError(
        "Every pot must be positive and divisible by the smallest chip.",
      );
    const indices = pot.eligibleIndices;
    if (
      !Array.isArray(indices) ||
      !indices.length ||
      new Set(indices).size !== indices.length ||
      indices.some((i) => !eligible.includes(i))
    )
      throw new ValidationError(
        "Each pot must have distinct eligible live players.",
      );
    return { potIndex: index, amount, eligibleIndices: [...indices] };
  });
  if (!Number.isSafeInteger(plan.reduce((sum, pot) => sum + pot.amount, 0)))
    throw new ValidationError("Total pot exceeds safe precision.");
  return { pots: plan, playerCount, order, unit };
}
function settleScores(scores, plan) {
  const payouts = Array(plan.playerCount).fill(0);
  const pots = plan.pots.map((pot) => {
    const best = Math.max(...pot.eligibleIndices.map((index) => scores[index]));
    const winners = plan.order.filter(
      (index) => pot.eligibleIndices.includes(index) && scores[index] === best,
    );
    const chips = pot.amount / plan.unit,
      base = Math.floor(chips / winners.length) * plan.unit,
      extra = chips % winners.length;
    const shares = winners.map((playerIndex, at) => {
      const amount = base + (at < extra ? plan.unit : 0);
      payouts[playerIndex] += amount;
      return { playerIndex, amount: amount / 100, oddChip: at < extra };
    });
    return {
      potIndex: pot.potIndex,
      amount: pot.amount / 100,
      eligibleIndices: pot.eligibleIndices,
      winnerIndices: winners,
      shares,
    };
  });
  if (
    payouts.reduce((sum, payout) => sum + payout, 0) !==
    plan.pots.reduce((sum, pot) => sum + pot.amount, 0)
  )
    throw new Error("Payout conservation failed.");
  return { payouts, pots };
}
function validateDenominations(config, actions, chipUnit) {
  const unit = chipUnits(chipUnit, "Smallest chip");
  if (unit <= 0) throw new ValidationError("Smallest chip must be positive.");
  for (const amount of [
    config.smallBlind,
    config.bigBlind,
    ...config.seats.map((seat) => seat.startingStack),
    ...actions
      .filter((action) => action.amount !== undefined)
      .map((action) => action.amount),
  ])
    if (chipUnits(amount) % unit !== 0)
      throw new ValidationError(
        "Blinds, starting stacks and wagers must be multiples of the smallest chip.",
      );
}
module.exports = {
  chipUnits,
  preparePots,
  settleScores,
  validateDenominations,
};
