const { ValidationError } = require("./errors");
const { chipUnits } = require("./payouts");
const { validateICMInput, calculateICM } = require("./icm");

function validateTournament(input, tableState, gameMode) {
  if (input === undefined || input === null) return undefined;
  if (gameMode !== "tournament")
    throw new ValidationError("Tournament settings require Tournament mode.");
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    input.fieldConfirmed !== true
  )
    throw new ValidationError(
      "Confirm the entire remaining tournament field and prizes.",
    );
  if (input.eliminationRule !== "starting-stack-split")
    throw new ValidationError(
      "Unsupported elimination rule. Use starting-stack-split.",
    );
  if (
    !tableState ||
    !Array.isArray(input.tableSeats) ||
    input.tableSeats.length !== tableState.seats.length
  )
    throw new ValidationError(
      "Tournament settings must match the current table starting stacks. Reapply settings.",
    );
  const tablePlayers = tableState.seats.map((seat, index) => {
    const snapshot = input.tableSeats[index];
    if (
      !snapshot ||
      snapshot.seatId !== seat.id ||
      snapshot.startingStack !== seat.startingStack
    )
      throw new ValidationError(
        "Tournament table seats or starting stacks changed. Reapply settings.",
      );
    return { name: seat.name, stack: seat.startingStack };
  });
  if (!Array.isArray(input.otherPlayers))
    throw new ValidationError("Other tournament players must be an array.");
  const checked = validateICMInput({
    players: [...tablePlayers, ...input.otherPlayers],
    payouts: input.payouts,
  });
  return {
    fieldConfirmed: true,
    eliminationRule: "starting-stack-split",
    tableSeats: tableState.seats.map((seat) => ({
      seatId: seat.id,
      startingStack: seat.startingStack,
    })),
    otherPlayers: checked.players.slice(tablePlayers.length),
    payouts: checked.payouts,
  };
}

// Values every survivor and every player eliminated in THIS hand, conserving all prizes.
function resolveTournamentOutcome(stacks, startingStacks, payouts) {
  const n = startingStacks.length;
  if (!Array.isArray(stacks) || stacks.length !== n || payouts.length !== n)
    throw new ValidationError(
      "Tournament outcome vectors must have the same length.",
    );
  const units = stacks.map((stack) => chipUnits(stack));
  const starting = startingStacks.map((stack) => chipUnits(stack));
  if (
    starting.some((stack) => stack <= 0) ||
    units.reduce((a, b) => a + b, 0) !== starting.reduce((a, b) => a + b, 0)
  )
    throw new ValidationError(
      "Tournament outcome must conserve all starting chips.",
    );
  const survivors = units.flatMap((amount, index) =>
    amount > 0 ? [index] : [],
  );
  const eliminated = units
    .flatMap((amount, index) => (amount === 0 ? [index] : []))
    .sort((a, b) => starting[b] - starting[a]);
  const values = Array(n).fill(0),
    awards = [];
  let at = 0;
  while (at < eliminated.length) {
    let end = at + 1;
    while (
      end < eliminated.length &&
      starting[eliminated[end]] === starting[eliminated[at]]
    )
      end++;
    const firstPlace = survivors.length + at;
    const award =
      payouts
        .slice(firstPlace, survivors.length + end)
        .reduce((sum, prize) => sum + prize, 0) /
      (end - at);
    for (let i = at; i < end; i++) {
      const index = eliminated[i];
      values[index] = award;
      awards.push({
        playerIndex: index,
        firstPlace: firstPlace + 1,
        lastPlace: survivors.length + end,
        prize: award,
      });
    }
    at = end;
  }
  if (survivors.length === 1) values[survivors[0]] = payouts[0];
  else {
    const result = calculateICM({
      players: survivors.map((index) => ({
        name: `P${index}`,
        stack: stacks[index],
      })),
      payouts: payouts.slice(0, survivors.length),
    });
    result.results.forEach((player, index) => {
      values[survivors[index]] = player.prizeEquity;
    });
  }
  return { values, awards };
}
module.exports = { validateTournament, resolveTournamentOutcome };
