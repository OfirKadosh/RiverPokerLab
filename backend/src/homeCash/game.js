const { createHash } = require("node:crypto");

const MAX_PLAYERS = 24;
const MAX_OPERATIONS = 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class GameError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function required(condition, message, status = 400) {
  if (!condition) throw new GameError(status, message);
}

function integer(value, min, max) {
  return Number.isSafeInteger(value) && value >= min && value <= max;
}

function name(value, max) {
  const clean = typeof value === "string" ? value.trim() : "";
  required(clean.length > 0 && clean.length <= max, `Enter a name of 1–${max} characters.`);
  return clean;
}

function configuration(input) {
  required(integer(input.buyIn, 1, 1_000_000), "Enter a buy-in of ₪0.01–₪10,000.");
  required(integer(input.chipsPerBuyIn, 1, 1_000_000), "Enter 1–1,000,000 chips per buy-in.");
  return { name: name(input.name, 60), buyIn: input.buyIn, chipsPerBuyIn: input.chipsPerBuyIn };
}

function createGame(ownerId, input, now) {
  required(typeof input?.id === "string" && uuid.test(input.id), "Invalid game ID.");
  const config = configuration(input);
  return {
    _id: input.id, ownerId, ...config,
    openingFingerprint: createHash("sha256").update(JSON.stringify(config)).digest("hex"),
    status: "active", version: 0, players: [], entries: [], cashOuts: [], operations: [],
    settlement: null, createdAt: now, updatedAt: now,
  };
}

function activeEntries(game) {
  return game.entries.filter((entry) => !entry.voided);
}

function entryValues(game, entry) {
  return { amount: entry.amount ?? game.buyIn, chips: entry.chips ?? game.chipsPerBuyIn };
}

function gameTotals(game) {
  const paidByPlayer = new Map();
  let collected = 0;
  let issuedChips = 0;
  for (const entry of activeEntries(game)) {
    const { amount, chips } = entryValues(game, entry);
    collected += amount;
    issuedChips += chips;
    paidByPlayer.set(entry.playerId, (paidByPlayer.get(entry.playerId) ?? 0) + amount);
  }
  return { paidByPlayer, collected, issuedChips };
}

function recordedCashOuts(game) {
  return new Map((game.cashOuts ?? []).filter((entry) => !entry.voided)
    .map((entry) => [entry.playerId, entry]));
}

function settle(game, stacks) {
  const { paidByPlayer, collected, issuedChips } = gameTotals(game);
  const cashOuts = recordedCashOuts(game);
  const players = game.players.filter((player) => paidByPlayer.has(player.id));
  required(players.length >= 2, "Record a buy-in for at least two players.");
  const playing = players.filter(({ id }) => !cashOuts.has(id));
  const chipsCashedOut = [...cashOuts.values()].reduce((sum, entry) => sum + entry.chips, 0);
  const outstanding = issuedChips - chipsCashedOut;
  required(stacks && typeof stacks === "object" && !Array.isArray(stacks) &&
    Object.keys(stacks).length === playing.length &&
    playing.every(({ id }) => Object.hasOwn(stacks, id) && integer(stacks[id], 0, outstanding)),
    "Enter final chips for every player still in the game.");
  const returned = playing.reduce((sum, player) => sum + stacks[player.id], 0);
  required(returned === outstanding, `Chip count does not balance. Outstanding ${outstanding}, entered ${returned}.`);

  // Allocate any remaining agorot to the largest remainders, then by seating order.
  const rows = players.map(({ id, name }, order) => {
    const cashOut = cashOuts.get(id);
    const chips = cashOut?.chips ?? stacks[id];
    const numerator = chips * game.buyIn;
    const paid = paidByPlayer.get(id);
    return { id, name, chips, paid, ...(cashOut ? { cashOutPaid: cashOut.amount } : {}), payout: Math.floor(numerator / game.chipsPerBuyIn),
      remainder: numerator % game.chipsPerBuyIn, order };
  });
  const remaining = collected - rows.reduce((sum, row) => sum + row.payout, 0);
  const byRemainder = [...rows].sort((a, b) => b.remainder - a.remainder || a.order - b.order);
  for (const row of byRemainder.slice(0, remaining)) row.payout += 1;
  return { collected, issuedChips, players: rows.map(({ remainder, order, ...row }) => ({
    ...row, profit: row.payout - row.paid,
  })) };
}

function applyCommand(game, input, now) {
  required(typeof input?.id === "string" && uuid.test(input.id) && integer(input.version, 0, MAX_OPERATIONS), "Invalid operation ID or version.");
  const { id, version, ...command } = input;
  const fingerprint = createHash("sha256").update(JSON.stringify(command)).digest("hex");
  const previous = game.operations.find((item) => item.id === id);
  if (previous) {
    required(previous.fingerprint === fingerprint, "This operation ID was already used.", 409);
    return game;
  }
  required(game.version === version, "This game changed on another screen. Review the updated game before trying again.", 409);
  required(game.status === "active", "This game is already closed.", 409);
  if (["configure", "add-player", "entry", "cash-out"].includes(command.type)) {
    // Corrections and closing stay available when the entry log reaches its limit.
    required(game.version < MAX_OPERATIONS / 2, "The game log is full. Close this game to continue.", 409);
  }

  const next = structuredClone(game);
  switch (command.type) {
    case "configure":
      required(next.entries.length === 0, "The buy-in rate is locked after the first entry.", 409);
      Object.assign(next, configuration(command));
      break;
    case "cancel-empty":
      required(activeEntries(next).length === 0, "Correct all entries before cancelling an empty game.", 409);
      next.status = "cancelled";
      break;
    case "add-player": {
      const playerName = name(command.name, 40);
      required(next.players.length < MAX_PLAYERS, "This game already has 24 players.");
      required(!next.players.some((player) => player.name.toLowerCase() === playerName.toLowerCase()),
        "A player with that name is already listed.");
      next.players.push({ id, name: playerName });
      break;
    }
    case "remove-player":
      required(next.players.some((player) => player.id === command.playerId), "Player not found.");
      required(!activeEntries(next).some((entry) => entry.playerId === command.playerId),
        "Undo this player's entries before removing them.");
      next.players = next.players.filter((player) => player.id !== command.playerId);
      break;
    case "entry": {
      required(next.players.some((player) => player.id === command.playerId), "Player not found.");
      required(!recordedCashOuts(next).has(command.playerId), "This player has already cashed out.");
      const kind = activeEntries(next).some((entry) => entry.playerId === command.playerId) ? "rebuy" : "buy-in";
      const amount = command.amount === undefined ? next.buyIn : command.amount;
      required(integer(amount, 1, 1_000_000), "Enter a buy-in of ₪0.01–₪10,000.");
      const chips = (amount * next.chipsPerBuyIn) / next.buyIn;
      required(Number.isSafeInteger(chips) && chips > 0, "Choose an amount that converts to whole chips.");
      next.entries.push({ id, playerId: command.playerId, kind, amount, chips, at: now, voided: false });
      break;
    }
    case "cash-out": {
      const { paidByPlayer, issuedChips } = gameTotals(next);
      const cashOuts = recordedCashOuts(next);
      required(paidByPlayer.size >= 2 && paidByPlayer.has(command.playerId), "Record buy-ins for at least two players before cashing out.");
      required(!cashOuts.has(command.playerId), "This player has already cashed out.");
      const returned = [...cashOuts.values()].reduce((sum, entry) => sum + entry.chips, 0);
      const outstanding = issuedChips - returned;
      required(integer(command.chips, 0, outstanding), "Enter a whole number of chips within the outstanding total.");
      required(cashOuts.size < paidByPlayer.size - 1 || command.chips === outstanding,
        "The last player must return all outstanding chips.");
      const amount = Math.floor((command.chips * next.buyIn) / next.chipsPerBuyIn);
      (next.cashOuts ??= []).push({ id, playerId: command.playerId, chips: command.chips, amount, at: now, voided: false });
      break;
    }
    case "void-cash-out": {
      const cashOut = (next.cashOuts ?? []).find((item) => item.id === command.cashOutId && !item.voided);
      required(cashOut, "Cash-out already corrected or missing.");
      cashOut.voided = true;
      break;
    }
    case "void-entry": {
      const entry = next.entries.find((item) => item.id === command.entryId && !item.voided);
      required(entry, "Entry already corrected or missing.");
      if (entry.kind === "buy-in") {
        required(!activeEntries(next).some((item) => item.playerId === entry.playerId && item.kind === "rebuy"),
          "Undo this player's rebuys before undoing the first buy-in.");
      }
      const cashOuts = recordedCashOuts(next);
      required(!cashOuts.has(entry.playerId), "Undo this player's cash-out before correcting their entries.");
      entry.voided = true;
      const { issuedChips, paidByPlayer } = gameTotals(next);
      required(!cashOuts.size || paidByPlayer.size >= 2, "Undo the cash-outs before leaving fewer than two funded players.");
      const returned = [...cashOuts.values()].reduce((sum, item) => sum + item.chips, 0);
      required(returned <= issuedChips, "Undo a cash-out before removing these chips from the game.");
      required(paidByPlayer.size > cashOuts.size || returned === issuedChips,
        "Undo a cash-out before leaving outstanding chips with no players.");
      break;
    }
    case "close":
      next.settlement = settle(next, command.stacks);
      next.status = "closed";
      break;
    default:
      throw new GameError(400, "Unknown game action.");
  }
  next.operations.push({ id, fingerprint });
  next.version += 1;
  next.updatedAt = now;
  return next;
}

function publicGame(game) {
  if (!game) return null;
  const { _id, ownerId, operations, openingFingerprint, ...details } = game;
  return { id: _id, ...details, cashOuts: details.cashOuts ?? [],
    entries: details.entries.map((entry) => ({ ...entry, ...entryValues(game, entry) })),
  };
}

module.exports = { GameError, uuid, createGame, applyCommand, publicGame };
