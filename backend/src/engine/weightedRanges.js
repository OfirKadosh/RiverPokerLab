const {
  ALL_CLASSES,
  expandRangeClasses,
  combosForClass,
} = require("./rangeParser");
const { cardFromString, cardToString } = require("./card");
const { ValidationError } = require("./errors");
const ACTIONS = ["fold", "check", "call", "bet", "raise", "allin"];
const MAX_RANGE_LENGTH = 32768;
const comboKey = (cards) => [...cards].sort((a, b) => a - b).join("-");
const classCombos = Object.fromEntries(
  ALL_CLASSES.map((hand) => [hand, combosForClass(hand)]),
);
function parseWeightedRange(text) {
  if (
    typeof text !== "string" ||
    !text.trim() ||
    text.length > MAX_RANGE_LENGTH
  )
    throw new ValidationError(
      `Range must contain 1 to ${MAX_RANGE_LENGTH} characters.`,
    );
  if (/^,|,$|,\s*,/.test(text.trim()))
    throw new ValidationError("Range contains an empty entry.");
  const tokens = text.trim().split(/[\s,]+/),
    map = new Map();
  for (const token of tokens) {
    const match = /^([^@]+)(?:@(\d+(?:\.\d{1,2})?)%)?$/.exec(token);
    if (!match)
      throw new ValidationError(
        `Invalid weighted token ${token}. Use AA@50% or AhKd@25%.`,
      );
    const body = match[1],
      weight = match[2] === undefined ? 1 : Number(match[2]) / 100;
    if (weight > 1)
      throw new ValidationError(
        "Range frequencies must be between 0% and 100%.",
      );
    if (body.toLowerCase() === "random" && tokens.length !== 1)
      throw new ValidationError("random must be used alone.");
    let combos;
    if (/^(?:[2-9TJQKA][shdc]){2}$/i.test(body)) {
      const cards = [
        cardFromString(body.slice(0, 2)),
        cardFromString(body.slice(2)),
      ];
      if (cards[0] === cards[1])
        throw new ValidationError(
          "A specific combo must contain two distinct cards.",
        );
      combos = [cards];
    } else
      combos = expandRangeClasses(body).flatMap((hand) => classCombos[hand]);
    for (const cards of combos)
      map.set(comboKey(cards), {
        cards: [...cards].sort((a, b) => a - b),
        weight,
      });
  }
  const entries = [...map.values()].filter((entry) => entry.weight > 0);
  if (!entries.length)
    throw new ValidationError("Range has no positive-weight combinations.");
  const pieces = [];
  for (const hand of ALL_CLASSES) {
    const all = classCombos[hand],
      selected = all
        .map((cards) => map.get(comboKey(cards)))
        .filter((entry) => entry?.weight > 0);
    if (!selected.length) continue;
    const same =
      selected.length === all.length &&
      selected.every((entry) => entry.weight === selected[0].weight);
    const suffix = (w) => (w === 1 ? "" : `@${Number((w * 100).toFixed(2))}%`);
    if (same) pieces.push(hand + suffix(selected[0].weight));
    else
      for (const entry of selected)
        pieces.push(
          entry.cards.map(cardToString).join("") + suffix(entry.weight),
        );
  }
  return { entries, canonicalRange: pieces.join(", ") };
}
function normalizeRangeInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ValidationError("Range configuration must be an object.");
  const base = parseWeightedRange(input.range);
  const result = { type: "range", range: base.canonicalRange };
  const profiles = input.actionRanges;
  if (profiles !== undefined) {
    if (
      !profiles ||
      typeof profiles !== "object" ||
      Array.isArray(profiles) ||
      Object.keys(profiles).some((key) => !ACTIONS.includes(key))
    )
      throw new ValidationError(
        "Action profiles must use fold, check, call, bet, raise or allin.",
      );
    const totals = new Map(),
      normalized = {};
    for (const action of ACTIONS.filter((key) => profiles[key] !== undefined)) {
      const text = profiles[action];
      const parsed = parseWeightedRange(text);
      normalized[action] = parsed.canonicalRange;
      for (const entry of parsed.entries) {
        const key = comboKey(entry.cards),
          total = (totals.get(key) || 0) + entry.weight;
        if (total > 1 + 1e-10)
          throw new ValidationError(
            `Action frequencies exceed 100% for combo ${entry.cards.map(cardToString).join("")}. Profiles must describe one decision point.`,
          );
        totals.set(key, total);
      }
    }
    result.actionRanges = normalized;
  }
  if (input.rangeAction !== undefined) {
    if (input.rangeAction !== "base" && !ACTIONS.includes(input.rangeAction))
      throw new ValidationError("Unknown observed range action.");
    if (
      input.rangeAction !== "base" &&
      !result.actionRanges?.[input.rangeAction]
    )
      throw new ValidationError("The selected observed action has no profile.");
    result.rangeAction = input.rangeAction;
  }
  if (result.rangeAction && result.rangeAction !== "base")
    effectiveRange(result);
  return result;
}
function effectiveRange(input) {
  const base = parseWeightedRange(input.range);
  if (!input.rangeAction || input.rangeAction === "base")
    return { ...base, baseEntries: base.entries };
  const profile = parseWeightedRange(input.actionRanges[input.rangeAction]);
  const frequencies = new Map(
    profile.entries.map((entry) => [comboKey(entry.cards), entry.weight]),
  );
  const entries = base.entries
    .map((entry) => ({
      ...entry,
      weight: entry.weight * (frequencies.get(comboKey(entry.cards)) || 0),
    }))
    .filter((entry) => entry.weight > 0);
  if (!entries.length)
    throw new ValidationError(
      "Observed action has no positive-weight overlap with the base range.",
    );
  return { ...base, entries, baseEntries: base.entries };
}
function previewWeightedRange(input, deadCards = []) {
  const normalized = normalizeRangeInput(
    typeof input === "string" ? { range: input } : input,
  );
  if (!Array.isArray(deadCards) || deadCards.length > 52)
    throw new ValidationError(
      "deadCards must be an array of at most 52 cards.",
    );
  const dead = deadCards.map(cardFromString);
  if (new Set(dead).size !== dead.length)
    throw new ValidationError("Duplicate dead cards are not allowed.");
  const blocked = new Set(dead),
    parsed = parseWeightedRange(normalized.range),
    effective = effectiveRange(normalized);
  const available = (entry) => entry.cards.every((card) => !blocked.has(card));
  const classes = [],
    counts = {},
    classWeights = {};
  for (const hand of ALL_CLASSES) {
    const keys = new Set(classCombos[hand].map(comboKey)),
      selected = parsed.entries.filter((entry) =>
        keys.has(comboKey(entry.cards)),
      );
    if (!selected.length) continue;
    classes.push(hand);
    counts[hand] = selected.filter(available).length;
    classWeights[hand] =
      selected.length === classCombos[hand].length &&
      selected.every((entry) => entry.weight === selected[0].weight)
        ? selected[0].weight
        : null;
  }
  const totalMass = effective.entries.reduce(
      (sum, entry) => sum + entry.weight,
      0,
    ),
    availableEntries = effective.entries.filter(available);
  const baseAvailableMass = parsed.entries
    .filter(available)
    .reduce((sum, e) => sum + e.weight, 0);
  return {
    ...normalized,
    canonicalRange: normalized.range,
    classes,
    counts,
    classWeights,
    totalCombos: parsed.entries.length,
    availableCombos: parsed.entries.filter(available).length,
    blockedCombos: parsed.entries.filter((entry) => !available(entry)).length,
    effectiveCombos: effective.entries.length,
    effectiveAvailableCombos: availableEntries.length,
    totalMass,
    availableMass: availableEntries.reduce((sum, e) => sum + e.weight, 0),
    observedAction: normalized.rangeAction || "base",
    knownCardActionFrequency: baseAvailableMass
      ? availableEntries.reduce((sum, e) => sum + e.weight, 0) /
        baseAvailableMass
      : null,
    combos: parsed.entries.map((entry) => ({
      cards: entry.cards.map(cardToString),
      weight: entry.weight,
      blocked: !available(entry),
    })),
  };
}
module.exports = {
  ACTIONS,
  MAX_RANGE_LENGTH,
  comboKey,
  parseWeightedRange,
  normalizeRangeInput,
  effectiveRange,
  previewWeightedRange,
};
