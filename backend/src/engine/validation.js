const { ValidationError } = require("./errors");
const { normalizeCard } = require("./card");
const { normalizeRangeInput } = require("./weightedRanges");

function validateSimulationInput(
  players,
  board = [],
  gameType = "holdem",
  iterations = 5000,
) {
  if (!["holdem", "omaha"].includes(gameType)) {
    throw new ValidationError("Game type must be holdem or omaha.");
  }
  if (!Array.isArray(players) || players.length < 2 || players.length > 9) {
    throw new ValidationError("Number of players must be between 2 and 9.");
  }
  if (!Array.isArray(board) || ![0, 3, 4, 5].includes(board.length)) {
    throw new ValidationError("Board must contain 0, 3, 4, or 5 cards.");
  }
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 100000) {
    throw new ValidationError(
      "Iterations must be an integer between 1 and 100000.",
    );
  }

  const handSize = gameType === "omaha" ? 4 : 2;
  const normalizedPlayers = Array.from(players, (hand, index) => {
    if (hand && !Array.isArray(hand) && typeof hand === "object") {
      if (hand.type === "range") {
        if (gameType !== "holdem")
          throw new ValidationError(
            "Ranges are only supported for Holdem. Omaha requires four specific cards.",
          );
        if (hand.cards !== undefined)
          throw new ValidationError(
            "A range input cannot also contain specific cards.",
          );
        return normalizeRangeInput(hand);
      }
      if (
        hand.type !== "hand" ||
        hand.range !== undefined ||
        hand.actionRanges !== undefined ||
        hand.rangeAction !== undefined
      )
        throw new ValidationError(
          "Player input must be a specific hand or a range.",
        );
      hand = hand.cards;
    }
    if (!Array.isArray(hand) || hand.length !== handSize) {
      throw new ValidationError(
        `Player ${index + 1} must have exactly ${handSize} hole cards for ${gameType}.`,
      );
    }
    return Array.from(hand, (card, cardIndex) =>
      normalizeCard(card, `Player ${index + 1}, card ${cardIndex + 1}`),
    );
  });
  const normalizedBoard = Array.from(board, (card, index) =>
    normalizeCard(card, `Board card ${index + 1}`),
  );
  const seen = new Set();
  for (const card of [
    ...normalizedPlayers.filter(Array.isArray).flat(),
    ...normalizedBoard,
  ]) {
    if (seen.has(card)) {
      throw new ValidationError(
        `Duplicate card detected: ${card}. Each card can only appear once across all hands and the board.`,
      );
    }
    seen.add(card);
  }
  return {
    players: normalizedPlayers,
    board: normalizedBoard,
    gameType,
    iterations,
  };
}

function validateCalculateInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  const {
    players,
    board = [],
    gameType = "holdem",
    iterations = 5000,
    gameMode = "cash",
    potSize,
    callAmount,
    saveSpot = false,
  } = input;
  if (input.playerInputs !== undefined && input.players !== undefined) {
    throw new ValidationError("Send either players or playerInputs, not both.");
  }
  const simulation = validateSimulationInput(
    input.playerInputs === undefined ? players : input.playerInputs,
    board,
    gameType,
    iterations,
  );
  if (!["cash", "tournament"].includes(gameMode)) {
    throw new ValidationError("Game mode must be cash or tournament.");
  }
  for (const [name, value] of Object.entries({ potSize, callAmount })) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new ValidationError(
        `${name} must be a finite, non-negative number.`,
      );
    }
  }
  if (!Number.isFinite(potSize + callAmount)) {
    throw new ValidationError(
      "The combined pot size and call amount must be finite.",
    );
  }
  if (typeof saveSpot !== "boolean") {
    throw new ValidationError("saveSpot must be a boolean.");
  }
  return { ...simulation, gameMode, potSize, callAmount, saveSpot };
}

module.exports = {
  ValidationError,
  normalizeCard,
  validateSimulationInput,
  validateCalculateInput,
};
