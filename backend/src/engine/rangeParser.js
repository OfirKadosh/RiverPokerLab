const { RANKS, SUITS, cardFromString, normalizeCard } = require("./card");
const { ValidationError } = require("./errors");
const DESC = [...RANKS].reverse();
const ALL_CLASSES = DESC.flatMap((r1, row) =>
  DESC.map((r2, col) =>
    row === col ? r1 + r2 : row < col ? r1 + r2 + "s" : r2 + r1 + "o",
  ),
);
function parseClass(token) {
  const match = /^([2-9TJQKA])([2-9TJQKA])([so])?$/i.exec(token);
  if (!match)
    throw new ValidationError(
      `Unsupported range token: ${token}. Use AA, AKs, AKo, AK, TT+, AJs+, or AA-TT.`,
    );
  let a = match[1].toUpperCase(),
    b = match[2].toUpperCase();
  const suffix = match[3]?.toLowerCase() || "";
  if (a === b && suffix)
    throw new ValidationError(
      `Pairs cannot use a suited/offsuit suffix: ${token}.`,
    );
  if (RANKS.indexOf(a) < RANKS.indexOf(b)) [a, b] = [b, a];
  return { a, b, suffix };
}
function expandRangeClasses(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 4096) {
    throw new ValidationError(
      "Range must be a non-empty string of at most 4096 characters.",
    );
  }
  if (text.trim().toLowerCase() === "random") return [...ALL_CLASSES];
  const tokens = text.trim().split(/[\s,]+/);
  if (
    text.trim().startsWith(",") ||
    text.trim().endsWith(",") ||
    /,\s*,/.test(text)
  ) {
    throw new ValidationError("Range contains an empty entry.");
  }
  const selected = new Set();
  function add(a, b, suffix) {
    if (a === b) selected.add(a + b);
    else if (suffix) selected.add(a + b + suffix);
    else {
      selected.add(a + b + "s");
      selected.add(a + b + "o");
    }
  }
  for (const token of tokens) {
    if (token.endsWith("+")) {
      const { a, b, suffix } = parseClass(token.slice(0, -1));
      if (a === b) {
        for (let rank = RANKS.indexOf(a); rank < RANKS.length; rank++)
          add(RANKS[rank], RANKS[rank], "");
      } else {
        for (let rank = RANKS.indexOf(b); rank < RANKS.indexOf(a); rank++)
          add(a, RANKS[rank], suffix);
      }
    } else if (token.includes("-")) {
      const parts = token.split("-");
      if (parts.length !== 2)
        throw new ValidationError(`Invalid range interval: ${token}.`);
      const first = parseClass(parts[0]),
        last = parseClass(parts[1]);
      if (first.a === first.b && last.a === last.b) {
        const bounds = [RANKS.indexOf(first.a), RANKS.indexOf(last.a)].sort(
          (a, b) => a - b,
        );
        for (let rank = bounds[0]; rank <= bounds[1]; rank++)
          add(RANKS[rank], RANKS[rank], "");
      } else if (
        first.a === last.a &&
        first.suffix === last.suffix &&
        first.a !== first.b &&
        last.a !== last.b
      ) {
        const bounds = [RANKS.indexOf(first.b), RANKS.indexOf(last.b)].sort(
          (a, b) => a - b,
        );
        for (let rank = bounds[0]; rank <= bounds[1]; rank++)
          add(first.a, RANKS[rank], first.suffix);
      } else
        throw new ValidationError(
          `Unsupported interval: ${token}. Use pair intervals or a fixed high rank and matching suffix, such as AJs-A8s.`,
        );
    } else {
      const { a, b, suffix } = parseClass(token);
      add(a, b, suffix);
    }
  }
  return ALL_CLASSES.filter((hand) => selected.has(hand));
}
function combosForClass(hand) {
  const [a, b] = hand;
  const combos = [];
  for (let i = 0; i < SUITS.length; i++)
    for (let j = 0; j < SUITS.length; j++) {
      if (a === b ? i >= j : hand[2] === "s" ? i !== j : i === j) continue;
      combos.push([cardFromString(a + SUITS[i]), cardFromString(b + SUITS[j])]);
    }
  return combos;
}
function parseRange(text) {
  return expandRangeClasses(text).flatMap(combosForClass);
}
function previewRange(text, deadCards = []) {
  if (!Array.isArray(deadCards) || deadCards.length > 52)
    throw new ValidationError(
      "deadCards must be an array of at most 52 cards.",
    );
  const dead = deadCards.map((card) => cardFromString(normalizeCard(card)));
  if (new Set(dead).size !== dead.length)
    throw new ValidationError("Duplicate dead cards are not allowed.");
  const blocked = new Set(dead);
  const classes = expandRangeClasses(text);
  const counts = Object.fromEntries(
    classes.map((hand) => [
      hand,
      combosForClass(hand).filter((combo) =>
        combo.every((card) => !blocked.has(card)),
      ).length,
    ]),
  );
  const totalCombos = classes.flatMap(combosForClass).length;
  const availableCombos = Object.values(counts).reduce(
    (sum, count) => sum + count,
    0,
  );
  return {
    classes,
    canonicalRange: classes.join(", "),
    totalCombos,
    availableCombos,
    blockedCombos: totalCombos - availableCombos,
    counts,
  };
}
module.exports = {
  ALL_CLASSES,
  expandRangeClasses,
  combosForClass,
  parseRange,
  previewRange,
};
