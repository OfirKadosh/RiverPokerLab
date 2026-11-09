const { randomInt } = require("node:crypto");

const templates = {
  cash: [
    { pot: 100, stack: 50, weakerWeight: 18 },
    { pot: 100, stack: 50, weakerWeight: 42 },
    { pot: 100, stack: 50, weakerWeight: 25 },
    { pot: 80, stack: 60, weakerWeight: 28 },
  ],
  tournament: [
    { pot: 4, stack: 98, outside: 98, weakerWeight: 40 },
    { pot: 4, stack: 98, outside: 98, weakerWeight: 60 },
    { pot: 4, stack: 98, outside: 98, weakerWeight: 85 },
    { pot: 12, stack: 94, outside: 22, weakerWeight: 58 },
  ],
};

function makeRiverSpot(mode, choose = randomInt) {
  const choices = templates[mode];
  const { pot, stack, weakerWeight, outside } = choices[choose(choices.length)];
  const suits = "shdc";
  const shift = choose(suits.length);
  const cards = (values) => values.map((card) => card[0] + suits[(suits.indexOf(card[1]) + shift) % suits.length]);
  const board = cards(["2s", "3d", "7h", "8c", "9s"]);
  const hand = cards(["Qh", "Qc"]);
  const range = [
    { cards: cards(["Ah", "Ac"]), percent: 100 - weakerWeight },
    { cards: cards(["Th", "Tc"]), percent: weakerWeight },
  ];
  const spot = {
    gameType: "holdem", gameMode: mode, board, potSize: pot, chipUnit: 1,
    minBet: 2, betSizes: [], maxRaises: 0, raiseSizes: [], includeAllIn: true,
    players: [
      { name: "Hero", stack, input: hand },
      { name: "Villain", stack, input: { type: "range", range: range.map(({ cards, percent }) => `${cards.join("")}@${percent}%`).join(",") } },
    ],
  };
  const question = { mode, board, hand, pot: pot + stack, toCall: stack, range };
  if (mode === "cash") return { kind: "riverTree", input: spot, question };

  const passive = { check: 1, call: 1, fold: 1, bet: 0, raise: 0, allin: 0 };
  const payouts = [50, 50, 0];
  return {
    kind: "tournamentTree",
    question: { ...question, fieldStacks: [stack + pot / 2, stack + pot / 2, outside], payouts },
    input: {
      analysisKind: "fixed-policy-icm", street: "river", spot: { ...spot, solverStreet: "river" },
      tournament: {
        fieldConfirmed: true, handStartStacks: [stack + pot / 2, stack + pot / 2],
        otherPlayers: [{ name: "Outside", stack: outside }], payouts, eliminationRule: "starting-stack-split",
      },
      responsePolicy: {
        confirmed: true, players: [
          { turn: passive, river: passive },
          { turn: passive, river: { ...passive, check: 0, allin: 1 } },
        ],
      },
    },
  };
}

function riverDecision(mode, analysis) {
  const tournament = mode === "tournament";
  const nodes = tournament ? analysis.tree : analysis.nodes;
  const afterCheck = nodes[nodes[0].actions.find(({ type }) => type === "check").nodeId];
  const facing = nodes[afterCheck.actions.find(({ type }) => type === "bet").nodeId];
  const actions = facing.actions.map(({ type, nodeId }, index) => tournament
    ? { type, chipEv: analysis.nodes[facing.id].actions[index].chipNet, prizeEv: analysis.nodes[facing.id].actions[index].prizeEv }
    : { type, chipEv: nodes[nodeId].outcome.netFromRiver[0] });
  const measure = tournament ? "prizeEv" : "chipEv";
  if (actions.length !== 2 || actions.map(({ type }) => type).join(",") !== "fold,call" ||
      actions.some((action) => !Number.isFinite(action.chipEv) || !Number.isFinite(action[measure]))) {
    throw Error("Practice spot did not produce a supported decision.");
  }
  const best = Math.max(...actions.map((action) => action[measure]));
  const tolerance = 0.01;
  return { actions, accepted: actions.filter((action) => best - action[measure] <= tolerance).map(({ type }) => type), tolerance };
}

module.exports = { makeRiverSpot, riverDecision };
