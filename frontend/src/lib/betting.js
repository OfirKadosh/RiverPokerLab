const ValidationError = Error;
import { buildHandSetup } from "./handSetup.js";
const STREETS = ["preflop", "flop", "turn", "river"];
const BOARD_COUNTS = [0, 3, 4, 5];
function units(value, label = "Amount") {
  const scaled = value * 100;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isSafeInteger(Math.round(scaled)) ||
    Math.abs(scaled - Math.round(scaled)) > 0.000001
  )
    throw new ValidationError(
      `${label} must be a non-negative number with at most two decimal places and safe chip precision.`,
    );
  return Math.round(scaled);
}
const chips = (value) => value / 100;
function replayBetting(config, actions = [], boardCount = 0) {
  if (!config || !["holdem", "omaha"].includes(config.gameType))
    throw new ValidationError("Betting game type must be holdem or omaha.");
  if (!Array.isArray(actions) || actions.length > 512)
    throw new ValidationError(
      "Betting history must contain at most 512 actions.",
    );
  if (!BOARD_COUNTS.includes(boardCount))
    throw new ValidationError("Betting board must contain 0, 3, 4 or 5 cards.");
  const setup = buildHandSetup(
    config.seats,
    config.dealerSeatId,
    config.smallBlind,
    config.bigBlind,
  );
  const bb = units(config.bigBlind, "Big blind");
  units(config.smallBlind, "Small blind");
  const players = setup.positions.map((position) => ({
    id: position.seatId,
    starting: units(position.startingStack, "Starting stack"),
    remaining: units(position.startingStack, "Starting stack"),
    committed: 0,
    streetCommitted: 0,
    folded: false,
    actedAt: null,
  }));
  if (
    !Number.isSafeInteger(
      players.reduce((sum, player) => sum + player.starting, 0),
    )
  )
    throw new ValidationError("Total starting chips exceed safe precision.");
  const blindDeficit =
    units(config.smallBlind) +
    bb -
    setup.positions.reduce((sum, position) => sum + units(position.posted), 0);
  const lookup = (id) => players.find((player) => player.id === id);
  let pot = 0,
    street = 0,
    currentBet = bb,
    lastRaise = bb,
    actor = null,
    roundClosed = false,
    status = "playing",
    winnerSeatId = null,
    award = 0;
  let pending = new Set();
  const log = [];
  const active = () => players.filter((player) => !player.folded);
  const able = () => active().filter((player) => player.remaining > 0);
  function pay(player, amount) {
    if (
      !Number.isSafeInteger(amount) ||
      amount < 0 ||
      amount > player.remaining
    )
      throw new ValidationError("Action exceeds the player stack.");
    player.remaining -= amount;
    player.committed += amount;
    player.streetCommitted += amount;
    pot += amount;
  }
  for (const position of setup.positions)
    pay(lookup(position.seatId), units(position.posted));
  const ring = [...players]
    .sort((a, b) => a.id - b.id)
    .map((player) => player.id);
  function nextPending(after) {
    const at = ring.indexOf(after);
    for (let i = 1; i <= ring.length; i++) {
      const id = ring[(at + i) % ring.length];
      if (pending.has(id)) return id;
    }
    return null;
  }
  function callTarget(player) {
    return able().length === 1
      ? Math.max(
          0,
          ...players
            .filter((other) => other.id !== player.id)
            .map((other) => other.streetCommitted),
        )
      : currentBet;
  }
  function finishRound() {
    const sorted = [...players].sort(
      (a, b) => b.streetCommitted - a.streetCommitted,
    );
    const excess = sorted[0].streetCommitted - sorted[1].streetCommitted;
    if (excess > 0 && !sorted[0].folded) {
      const player = sorted[0];
      player.streetCommitted -= excess;
      player.committed -= excess;
      player.remaining += excess;
      pot -= excess;
      log.push({
        type: "refund",
        seatId: player.id,
        amount: chips(excess),
        street: STREETS[street],
      });
    }
    currentBet = Math.max(...players.map((player) => player.streetCommitted));
    roundClosed = true;
    actor = null;
    if (street === 3) status = "showdown";
  }
  function settle(after) {
    if (active().length === 1) {
      const winner = active()[0];
      winnerSeatId = winner.id;
      award = pot;
      winner.remaining += pot;
      pot = 0;
      status = "uncontested";
      roundClosed = true;
      actor = null;
      pending.clear();
      log.push({
        type: "award",
        seatId: winner.id,
        amount: chips(award),
        street: STREETS[street],
      });
      return;
    }
    for (const id of pending) {
      const player = lookup(id);
      if (player.folded || player.remaining === 0) pending.delete(id);
    }
    if (able().length === 1) {
      const player = able()[0];
      if (player.streetCommitted >= callTarget(player)) pending.clear();
      else pending = new Set([player.id]);
    }
    if (!pending.size) finishRound();
    else actor = nextPending(after);
  }
  function beginRound() {
    const order = street === 0 ? setup.preflopOrder : setup.postflopOrder;
    pending = new Set(
      order.filter((id) => !lookup(id).folded && lookup(id).remaining > 0),
    );
    if (street > 0 && able().length <= 1) pending.clear();
    const first = [...pending][0];
    settle(
      first === undefined
        ? ring[0]
        : ring[(ring.indexOf(first) - 1 + ring.length) % ring.length],
    );
  }
  function legalFor(player) {
    const target = callTarget(player);
    const owed = Math.max(0, target - player.streetCommitted);
    const canRaise =
      able().length >= 2 &&
      (player.actedAt === null ||
        player.actedAt === 0 ||
        currentBet - player.actedAt >= lastRaise);
    const minTo = currentBet === 0 ? bb : currentBet + lastRaise;
    // Pot-limit uses the actual pot plus full nominal blind bring-ins preflop.
    const potLimit =
      player.streetCommitted +
      pot +
      (street === 0 ? blindDeficit : 0) +
      2 * owed;
    const stackTo = player.streetCommitted + player.remaining;
    const maxTo = Math.min(
      stackTo,
      config.gameType === "omaha" ? potLimit : stackTo,
    );
    const canIncrease =
      canRaise && maxTo > currentBet && (maxTo >= minTo || maxTo === stackTo);
    return {
      toCall: chips(Math.min(owed, player.remaining)),
      fullToCall: chips(owed),
      canCheck: owed === 0,
      canFold: owed > 0,
      canRaise: canIncrease,
      minRaiseTo: chips(minTo),
      maxRaiseTo: chips(maxTo),
      canAllIn: stackTo <= target || (canIncrease && stackTo <= maxTo),
      actorSeatId: player.id,
    };
  }
  beginRound();
  for (const action of actions) {
    if (!action || typeof action !== "object" || Array.isArray(action))
      throw new ValidationError("Each betting action must be an object.");
    if (action.type === "advance") {
      if (status !== "playing" || !roundClosed || street >= 3)
        throw new ValidationError(
          "Finish the current betting round before advancing.",
        );
      if (boardCount < BOARD_COUNTS[street + 1])
        throw new ValidationError(
          "Choose the next street board cards before advancing.",
        );
      if (action.amount !== undefined || action.seatId !== undefined)
        throw new ValidationError(
          "Street advancement cannot contain a player or amount.",
        );
      street++;
      currentBet = 0;
      lastRaise = bb;
      roundClosed = false;
      for (const player of players) {
        player.streetCommitted = 0;
        player.actedAt = null;
      }
      log.push({ type: "advance", street: STREETS[street] });
      beginRound();
      continue;
    }
    if (status !== "playing" || roundClosed || action.seatId !== actor)
      throw new ValidationError(
        "Action is out of turn or the betting round is closed.",
      );
    const player = lookup(actor),
      legal = legalFor(player);
    const type = action.type;
    if (!["check", "call", "fold", "bet", "raise", "allin"].includes(type))
      throw new ValidationError("Unknown betting action.");
    if (!["bet", "raise"].includes(type) && action.amount !== undefined)
      throw new ValidationError("Only bet and raise actions accept an amount.");
    let cost = 0,
      target = player.streetCommitted;
    if (type === "fold") {
      if (!legal.canFold)
        throw new ValidationError(
          "Fold is available only when facing a wager.",
        );
      player.folded = true;
    }
    if (type === "check" && !legal.canCheck)
      throw new ValidationError("Cannot check while facing a wager.");
    if (type === "call") {
      if (legal.canCheck)
        throw new ValidationError("There is no wager to call.");
      cost = units(legal.toCall);
      target += cost;
    }
    if (["bet", "raise", "allin"].includes(type)) {
      if (type === "bet" && currentBet !== 0)
        throw new ValidationError("Use raise when a wager is already open.");
      if (type === "raise" && currentBet === 0)
        throw new ValidationError("Use bet to open a street.");
      target =
        type === "allin"
          ? player.streetCommitted + player.remaining
          : units(action.amount, "Raise-to amount");
      if (type === "allin" && target <= callTarget(player)) {
        cost = player.remaining;
      } else {
        if (!legal.canRaise || target <= currentBet)
          throw new ValidationError(
            "Raising is not currently available or has not reopened.",
          );
        if (target > units(legal.maxRaiseTo))
          throw new ValidationError(
            "Wager exceeds the stack or pot-limit maximum.",
          );
        if (
          target < units(legal.minRaiseTo) &&
          target !== player.streetCommitted + player.remaining
        )
          throw new ValidationError(
            "Wager is below the minimum full raise and is not all-in.",
          );
        cost = target - player.streetCommitted;
        const increment = target - currentBet;
        if (target >= units(legal.minRaiseTo))
          lastRaise = currentBet === 0 ? target : increment;
        currentBet = target;
        for (const other of able())
          if (other.id !== player.id && other.streetCommitted < currentBet)
            pending.add(other.id);
      }
    }
    pay(player, cost);
    player.actedAt = currentBet;
    pending.delete(player.id);
    log.push({
      type,
      seatId: player.id,
      amount: chips(cost),
      to: chips(target),
      street: STREETS[street],
    });
    settle(player.id);
  }
  const eligibleSeatIds = active().map((player) => player.id);
  const levels = [
    ...new Set(
      players.map((player) => player.committed).filter((amount) => amount > 0),
    ),
  ].sort((a, b) => a - b);
  let previous = 0;
  const pots =
    status === "uncontested"
      ? []
      : levels.map((level) => {
          const contributors = players.filter(
            (player) => player.committed >= level,
          );
          const amount = (level - previous) * contributors.length;
          previous = level;
          return {
            amount: chips(amount),
            eligibleSeatIds: contributors
              .filter((player) => !player.folded)
              .map((player) => player.id),
          };
        });
  if (
    players.reduce((sum, player) => sum + player.remaining, 0) + pot !==
    players.reduce((sum, player) => sum + player.starting, 0)
  )
    throw new Error("Chip conservation failed.");
  return {
    street: STREETS[street],
    requiredBoardCount: BOARD_COUNTS[street],
    nextBoardCount: street < 3 ? BOARD_COUNTS[street + 1] : null,
    actorSeatId: actor,
    roundClosed,
    status,
    pot: chips(pot),
    currentBet: chips(currentBet),
    lastFullRaise: chips(lastRaise),
    winnerSeatId,
    award: chips(award),
    eligibleSeatIds,
    pots,
    legal: actor === null ? null : legalFor(lookup(actor)),
    players: players.map((player) => ({
      seatId: player.id,
      remaining: chips(player.remaining),
      committed: chips(player.committed),
      streetCommitted: chips(player.streetCommitted),
      folded: player.folded,
      allIn: !player.folded && player.remaining === 0,
    })),
    log,
  };
}
export { replayBetting };
