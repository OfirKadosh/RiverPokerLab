const { ValidationError } = require("./errors");
const { createICMObserver } = require("./icmDecision");
const { replayBetting } = require("./betting");
const { runEquitySimulation } = require("./engine");
const { chipUnits, validateDenominations } = require("./payouts");
function calculationSettings(input = {}) {
  const method = input.calculationMethod ?? "monteCarlo",
    chipUnit = input.chipUnit ?? 0.01;
  if (!["auto", "exact", "monteCarlo"].includes(method))
    throw new ValidationError(
      "Calculation method must be auto, exact or monteCarlo.",
    );
  if (chipUnits(chipUnit, "Smallest chip") <= 0)
    throw new ValidationError("Smallest chip must be positive.");
  return { method, chipUnit };
}
function ledgerConfig(tableState, gameType) {
  return {
    seats: tableState.seats.map((seat) => ({
      id: seat.id,
      startingStack: seat.startingStack,
    })),
    dealerSeatId: tableState.handSetup.dealerSeatId,
    smallBlind: tableState.handSetup.smallBlind,
    bigBlind: tableState.bigBlind,
    gameType,
  };
}
function runoutLocked(state) {
  return (
    state.status === "showdown" ||
    state.status === "uncontested" ||
    (state.roundClosed &&
      state.players.filter((player) => !player.folded && player.remaining > 0)
        .length <= 1)
  );
}
function payoutOptions(state, tableState, settings) {
  const seatIds = tableState.seats.map((seat) => seat.id),
    eligibleIndices = seatIds.flatMap((id, index) =>
      state.eligibleSeatIds.includes(id) ? [index] : [],
    );
  return {
    ...settings,
    seatIds,
    dealerSeatId: tableState.handSetup.dealerSeatId,
    eligibleIndices,
    pots: state.pots.map((pot) => ({
      amount: pot.amount,
      eligibleIndices: pot.eligibleSeatIds.map((id) => seatIds.indexOf(id)),
    })),
  };
}
function calculateSnapshot({
  players,
  board,
  gameType,
  iterations,
  tableState,
  settings,
  bettingState,
}) {
  const seatIds = tableState?.seats.map((seat) => seat.id);
  let options = { ...settings };
  if (bettingState) {
    options.eligibleIndices = seatIds.flatMap((id, index) =>
      bettingState.eligibleSeatIds.includes(id) ? [index] : [],
    );
    if (runoutLocked(bettingState) && bettingState.status !== "uncontested") {
      validateDenominations(
        ledgerConfig(tableState, gameType),
        tableState.betting.actions,
        settings.chipUnit,
      );
      options = payoutOptions(bettingState, tableState, settings);
    }
  }
  const result = runEquitySimulation(
    players,
    board,
    gameType,
    iterations,
    options,
  );
  if (!bettingState) return result;
  if (bettingState.status === "uncontested")
    return {
      ...result,
      payoutSummary: {
        kind: "uncontested",
        winnerSeatId: bettingState.winnerSeatId,
        award: bettingState.award,
        endingStacks: bettingState.players.map((player) => ({
          seatId: player.seatId,
          stack: player.remaining,
        })),
        pots: [],
      },
    };
  if (!options.pots)
    return {
      ...result,
      payoutSummary: {
        kind: "unavailable",
        reason:
          "Future betting remains possible. Close the action before computing payout EV.",
      },
    };
  const endingStacks = seatIds.map((seatId, index) => ({
    seatId,
    stack: Number(
      (
        bettingState.players.find((player) => player.seatId === seatId)
          .remaining + result.payouts[index].expectedPayout
      ).toFixed(6),
    ),
  }));
  return {
    ...result,
    payoutSummary: {
      kind:
        result.settlement && bettingState.status === "showdown"
          ? "final"
          : "expectation",
      chipUnit: settings.chipUnit,
      endingStacks,
      payouts: result.payouts,
      pots: result.settlement?.pots || result.potExpectations,
    },
  };
}
function analyzeClosingCall({
  players,
  board,
  gameType,
  gameMode,
  iterations,
  tableState,
  settings,
  bettingState,
  tournament,
}) {
  const unavailable = (reason) => ({ available: false, reason });
  if (!tableState?.betting || !bettingState)
    return unavailable(
      "Start the hand builder to analyze a closing all-in call.",
    );
  if (bettingState.actorSeatId !== tableState.heroSeatId)
    return unavailable("Select the player currently acting as Hero.");
  if (!bettingState.legal || bettingState.legal.toCall <= 0)
    return unavailable(
      "Hero must be facing a wager to compare Call with Fold.",
    );
  const config = ledgerConfig(tableState, gameType),
    actor = bettingState.actorSeatId;
  const actions = [
    ...tableState.betting.actions,
    { type: "call", seatId: actor },
  ];
  const called = replayBetting(config, actions, board.length);
  if (!runoutLocked(called))
    return unavailable(
      "Calling leaves future betting possible. This version analyzes only calls that close all remaining betting.",
    );
  validateDenominations(config, actions, settings.chipUnit);
  const heroIndex = tableState.seats.findIndex((seat) => seat.id === actor);
  let icmObserver, icmUnavailable;
  if (gameMode === "tournament" && tournament) {
    const folded = replayBetting(
      config,
      [...tableState.betting.actions, { type: "fold", seatId: actor }],
      board.length,
    );
    if (!runoutLocked(folded))
      icmUnavailable = {
        available: false,
        reason:
          "Folding leaves future betting possible. ICM requires both branches to close all betting.",
      };
    else
      icmObserver = createICMObserver({
        tournament,
        tableState,
        called,
        folded,
        foldOptions: payoutOptions(folded, tableState, settings),
        heroIndex,
      });
  }
  const outcome = runEquitySimulation(players, board, gameType, iterations, {
    ...payoutOptions(called, tableState, settings),
    ...(icmObserver ? { onOutcome: icmObserver.observe } : {}),
  });
  const before = bettingState.players.find(
    (player) => player.seatId === actor,
  ).remaining;
  const after = called.players.find(
    (player) => player.seatId === actor,
  ).remaining;
  const payout = outcome.payouts[heroIndex];
  const ev = Number((after + payout.expectedPayout - before).toFixed(6));
  const uncertain =
    outcome.method === "monteCarlo" &&
    (outcome.samples < 30 || Math.abs(ev) <= 1.96 * payout.standardError);
  const decision = uncertain
    ? "Uncertain"
    : Math.abs(ev) < 0.000001
      ? "Indifferent"
      : ev > 0
        ? "Call"
        : "Fold";
  return {
    available: true,
    ...(gameMode === "tournament"
      ? {
          icm: icmObserver
            ? icmObserver.finish(outcome.method, outcome.samples)
            : icmUnavailable || {
                available: false,
                reason:
                  "Apply complete tournament settings to calculate monetary ICM EV.",
              },
        }
      : {}),
    scope: "closing-all-in-call",
    heroSeatId: actor,
    gameMode,
    unit: "chips",
    callCost: bettingState.legal.toCall,
    foldEV: 0,
    callEV: ev,
    expectedCallPayout: payout.expectedPayout,
    expectedStackAfterCall: Number((after + payout.expectedPayout).toFixed(6)),
    stackAfterFold: before,
    decision,
    standardError: payout.standardError,
    confidence95:
      outcome.method === "exact"
        ? null
        : [
            Number((ev - 1.96 * payout.standardError).toFixed(6)),
            Number((ev + 1.96 * payout.standardError).toFixed(6)),
          ],
    method: outcome.method,
    samples: outcome.samples,
    chipUnit: settings.chipUnit,
    pots: outcome.potExpectations,
    assumptions: [
      "No further betting remains after calling.",
      "Base weights and explicitly selected observed-action profiles are fixed inputs; hypothetical branches do not alter them.",
      "Previous contributions are sunk; Fold EV is zero at this decision.",
      "Chip EV excludes ICM; any ICM comparison is reported separately. No bounties, rake or future fold equity is included.",
    ],
  };
}
module.exports = {
  calculationSettings,
  ledgerConfig,
  runoutLocked,
  payoutOptions,
  calculateSnapshot,
  analyzeClosingCall,
};
