const { replayBetting } = require("./betting");
const { buildHandSetup } = require("./handSetup");
const { normalizeRangeInput } = require("./weightedRanges");
const { ValidationError, normalizeCard } = require("./validation");

// Optional table metadata is kept separate from showdown-equity inputs.
function validateTableState(
  tableState,
  players,
  gameType = "holdem",
  board = [],
) {
  if (tableState === undefined) return undefined;
  if (
    !tableState ||
    typeof tableState !== "object" ||
    Array.isArray(tableState)
  ) {
    throw new ValidationError("tableState must be an object.");
  }
  const { seats, heroSeatId, bigBlind } = tableState;
  if (!Array.isArray(seats) || seats.length !== players.length) {
    throw new ValidationError(
      "tableState must contain one seat per player, in player order.",
    );
  }
  const ids = new Set();
  const normalizedSeats = seats.map((seat, index) => {
    if (!seat || typeof seat !== "object" || Array.isArray(seat)) {
      throw new ValidationError(`Seat ${index + 1} must be an object.`);
    }
    if (
      !Number.isInteger(seat.id) ||
      seat.id < 0 ||
      seat.id > 8 ||
      ids.has(seat.id)
    ) {
      throw new ValidationError(
        "Seat IDs must be unique integers from 0 to 8.",
      );
    }
    ids.add(seat.id);
    if (
      typeof seat.name !== "string" ||
      !seat.name.trim() ||
      seat.name.trim().length > 40
    ) {
      throw new ValidationError(
        "Player names must contain 1 to 40 characters.",
      );
    }
    if (
      typeof seat.stack !== "number" ||
      !Number.isFinite(seat.stack) ||
      seat.stack < 0
    ) {
      throw new ValidationError(
        "Player stacks must be finite, non-negative numbers.",
      );
    }
    const starting =
      seat.startingStack === undefined
        ? {}
        : { startingStack: seat.startingStack };
    if (
      seat.startingStack !== undefined &&
      (typeof seat.startingStack !== "number" ||
        !Number.isFinite(seat.startingStack) ||
        seat.startingStack <= 0)
    )
      throw new ValidationError(
        "Starting stacks must be finite numbers greater than zero.",
      );
    const player = players[index];
    if (!Array.isArray(player)) {
      if (
        seat.mode !== "range" ||
        JSON.stringify(
          normalizeRangeInput({
            range: seat.range,
            ...(seat.actionRanges !== undefined
              ? { actionRanges: seat.actionRanges }
              : {}),
            ...(seat.rangeAction !== undefined
              ? { rangeAction: seat.rangeAction }
              : {}),
          }),
        ) !== JSON.stringify(player) ||
        !Array.isArray(seat.cards) ||
        seat.cards.length !== 0
      ) {
        throw new ValidationError(
          "Range seat metadata must match the corresponding player range and contain no specific cards.",
        );
      }
      return {
        id: seat.id,
        name: seat.name.trim(),
        stack: seat.stack,
        ...starting,
        cards: [],
        mode: "range",
        range: player.range,
        ...(player.actionRanges !== undefined
          ? { actionRanges: player.actionRanges }
          : {}),
        ...(player.rangeAction !== undefined
          ? { rangeAction: player.rangeAction }
          : {}),
      };
    }
    if (seat.mode !== undefined && seat.mode !== "hand")
      throw new ValidationError("Specific hand seats must use hand mode.");
    if (!Array.isArray(seat.cards) || seat.cards.length !== player.length)
      throw new ValidationError(
        "Seat cards must match the corresponding player hand.",
      );
    const cards = Array.from(seat.cards, (card) => normalizeCard(card));
    if (cards.some((card, cardIndex) => card !== player[cardIndex]))
      throw new ValidationError(
        "Seat cards must match the corresponding player hand in order.",
      );
    return {
      id: seat.id,
      name: seat.name.trim(),
      stack: seat.stack,
      ...starting,
      cards,
      ...(seat.mode ? { mode: "hand" } : {}),
    };
  });
  if (!Number.isInteger(heroSeatId) || !ids.has(heroSeatId)) {
    throw new ValidationError("Hero seat must refer to an occupied seat.");
  }
  if (
    typeof bigBlind !== "number" ||
    !Number.isFinite(bigBlind) ||
    bigBlind <= 0
  ) {
    throw new ValidationError(
      "Big blind must be a finite number greater than zero.",
    );
  }
  let handSetup;
  if (tableState.handSetup !== undefined) {
    const input = tableState.handSetup;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ValidationError("handSetup must be an object.");
    handSetup = buildHandSetup(
      normalizedSeats,
      input.dealerSeatId,
      input.smallBlind,
      bigBlind,
    );
  }
  let betting;
  if (tableState.betting !== undefined) {
    if (
      !handSetup ||
      !tableState.betting ||
      typeof tableState.betting !== "object" ||
      !Array.isArray(tableState.betting.actions)
    )
      throw new ValidationError(
        "Betting history requires validated hand setup and an actions array.",
      );
    const actions = tableState.betting.actions;
    const state = replayBetting(
      {
        seats: normalizedSeats.map((seat) => ({
          id: seat.id,
          startingStack: seat.startingStack,
        })),
        dealerSeatId: handSetup.dealerSeatId,
        smallBlind: handSetup.smallBlind,
        bigBlind,
        gameType,
      },
      actions,
      board.length,
    );
    if (state.requiredBoardCount !== board.length)
      throw new ValidationError(
        "Board cards must match the current betting street; advance the street after completing its cards.",
      );
    betting = {
      actions: actions.map((action) =>
        action.type === "advance"
          ? { type: "advance" }
          : {
              type: action.type,
              seatId: action.seatId,
              ...(action.amount === undefined ? {} : { amount: action.amount }),
            },
      ),
    };
  }
  return {
    seats: normalizedSeats,
    heroSeatId,
    bigBlind,
    ...(handSetup ? { handSetup } : {}),
    ...(betting ? { betting } : {}),
  };
}

module.exports = { validateTableState };
