const { ValidationError } = require("./errors");
// Seat IDs follow the clockwise visual rail. Empty seats never take a position.
const EARLY_POSITIONS = {
  3: [],
  4: ["CO"],
  5: ["HJ", "CO"],
  6: ["UTG", "HJ", "CO"],
  7: ["UTG", "LJ", "HJ", "CO"],
  8: ["UTG", "UTG+1", "LJ", "HJ", "CO"],
  9: ["UTG", "UTG+1", "UTG+2", "LJ", "HJ", "CO"],
};
function buildHandSetup(seats, dealerSeatId, smallBlind, bigBlind) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 9)
    throw new ValidationError("Hand setup requires 2 to 9 occupied seats.");
  if (
    seats.some(
      (seat) =>
        !seat || !Number.isInteger(seat.id) || seat.id < 0 || seat.id > 8,
    ) ||
    new Set(seats.map((seat) => seat.id)).size !== seats.length
  )
    throw new ValidationError(
      "Hand setup requires unique seat IDs from 0 to 8.",
    );
  if (
    !Number.isInteger(dealerSeatId) ||
    !seats.some((seat) => seat.id === dealerSeatId)
  )
    throw new ValidationError("Dealer must be an occupied seat.");
  if (
    typeof smallBlind !== "number" ||
    !Number.isFinite(smallBlind) ||
    smallBlind <= 0 ||
    typeof bigBlind !== "number" ||
    !Number.isFinite(bigBlind) ||
    bigBlind <= 0 ||
    smallBlind > bigBlind ||
    !Number.isFinite(smallBlind + bigBlind)
  )
    throw new ValidationError(
      "Blinds must be finite and positive, with small blind no greater than big blind.",
    );
  if (
    seats.some(
      (seat) =>
        typeof seat.startingStack !== "number" ||
        !Number.isFinite(seat.startingStack) ||
        seat.startingStack <= 0,
    )
  )
    throw new ValidationError(
      "Every occupied seat must have a finite starting stack greater than zero.",
    );
  const sorted = [...seats].sort((a, b) => a.id - b.id);
  const at = sorted.findIndex((seat) => seat.id === dealerSeatId);
  const ring = [...sorted.slice(at), ...sorted.slice(0, at)];
  const headsUp = ring.length === 2;
  const sb = headsUp ? ring[0].id : ring[1].id;
  const bb = headsUp ? ring[1].id : ring[2].id;
  const labels = headsUp
    ? ["BTN / SB", "BB"]
    : ["BTN", "SB", "BB", ...EARLY_POSITIONS[ring.length]];
  const positions = ring.map((seat, index) => {
    const blind = seat.id === sb ? smallBlind : seat.id === bb ? bigBlind : 0;
    const posted = Math.min(blind, seat.startingStack);
    return {
      seatId: seat.id,
      position: labels[index],
      startingStack: seat.startingStack,
      posted,
      remaining: seat.startingStack - posted,
      forcedAllIn: posted === seat.startingStack,
    };
  });
  const preflop = headsUp ? ring : [...ring.slice(3), ...ring.slice(0, 3)];
  const postflop = [...ring.slice(1), ring[0]];
  const eligible = (order) =>
    order
      .filter(
        (seat) =>
          positions.find((item) => item.seatId === seat.id).remaining > 0,
      )
      .map((seat) => seat.id);
  return {
    dealerSeatId,
    smallBlind,
    bigBlind,
    smallBlindSeatId: sb,
    bigBlindSeatId: bb,
    positions,
    preflopOrder: eligible(preflop),
    postflopOrder: eligible(postflop),
    initialPot: positions.reduce((sum, seat) => sum + seat.posted, 0),
  };
}
module.exports = { buildHandSetup };
