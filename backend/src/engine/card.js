const { ValidationError } = require("./errors");
// This is the single card encoding used by the parser and both game evaluators.
const RANKS = [..."23456789TJQKA"];
const SUITS = ["s", "h", "d", "c"];
function normalizeCard(card, label = "Card") {
  if (
    typeof card !== "string" ||
    !/^(10|[2-9TJQKA])[shdc]$/i.test(card.trim())
  ) {
    throw new ValidationError(
      `${label} must be a valid card, such as Ah, Tc, or 10d.`,
    );
  }
  const value = card.trim();
  const rank = value.slice(0, -1).toUpperCase();
  return (rank === "10" ? "T" : rank) + value.slice(-1).toLowerCase();
}
function cardFromString(card) {
  const value = normalizeCard(card);
  return RANKS.indexOf(value[0]) * 4 + SUITS.indexOf(value[1]);
}
function cardToString(card) {
  if (!Number.isInteger(card) || card < 0 || card > 51) {
    throw new ValidationError("Numeric card must be an integer from 0 to 51.");
  }
  return RANKS[Math.floor(card / 4)] + SUITS[card % 4];
}
function createDeck() {
  return Array.from({ length: 52 }, (_, index) => index);
}
function shuffleDeck(deck) {
  const result = [...deck];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
module.exports = {
  RANKS,
  SUITS,
  normalizeCard,
  cardFromString,
  cardToString,
  createDeck,
  shuffleDeck,
};
