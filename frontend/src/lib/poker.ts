import type { GameType, GameMode, RangeAction, RangeConfig, RangeDraft, TableState, PlayerInput, EquityResult, CalculationMethod, PotResult, TournamentSettings, IcmDecision, DecisionAnalysis, PayoutSummary, Calculation, SavedSpot } from "@river-poker-lab/core";
export type { GameType, GameMode, RangeAction, RangeConfig, RangeDraft, TableState, PlayerInput, EquityResult, CalculationMethod, PotResult, TournamentSettings, IcmDecision, DecisionAnalysis, PayoutSummary, Calculation, SavedSpot } from "@river-poker-lab/core";
import {RANKS,SUITS,SYMBOLS,SUIT_NAMES,handSize} from "@river-poker-lab/core";
export {RANKS,SUITS,SYMBOLS,SUIT_NAMES,handSize} from "@river-poker-lab/core";
export interface Seat extends RangeConfig {
  id: number;
  name: string;
  stack: string;
  startingStack: string;
  cards: (string | null)[];
  mode: "hand" | "range";
  range: string;
}
export function makeSeat(id: number, type: GameType): Seat {
  return {
    id,
    name: `Player ${id + 1}`,
    stack: "200",
    startingStack: "200",
    cards: Array(handSize(type)).fill(null),
    mode: "hand",
    range: "",
  };
}
export function validateSpot(
  seats: Seat[],
  board: (string | null)[],
  type: GameType,
  pot: string,
  call: string,
): string | null {
  if (seats.length < 2 || seats.length > 9)
    return "Add between 2 and 9 players.";
  for (const seat of seats) {
    if (seat.mode === "range") {
      if (type !== "holdem")
        return "Omaha requires four specific cards per player.";
      if (!seat.range.trim())
        return `Choose a range for ${seat.name || `Seat ${seat.id + 1}`}.`;
      continue;
    }
    if (
      seat.cards.length !== handSize(type) ||
      seat.cards.some((card) => !card)
    )
      return `Choose ${handSize(type)} cards for ${seat.name || `Seat ${seat.id + 1}`}.`;
  }
  const count = board.filter(Boolean).length;
  if (
    ![0, 3, 4, 5].includes(count) ||
    board.slice(0, count).some((card) => !card)
  )
    return "Complete the flop first, then add the turn and river in order.";
  const cards = [
    ...seats
      .filter((seat) => seat.mode === "hand")
      .flatMap((seat) => seat.cards),
    ...board,
  ].filter(Boolean);
  if (new Set(cards).size !== cards.length)
    return "Each card can only appear once.";
  if (
    pot.trim() === "" ||
    call.trim() === "" ||
    !Number.isFinite(Number(pot)) ||
    !Number.isFinite(Number(call)) ||
    Number(pot) < 0 ||
    Number(call) < 0 ||
    !Number.isFinite(Number(pot) + Number(call))
  )
    return "Enter valid, non-negative pot and call amounts.";
  return null;
}
export function validateSetup(seats: Seat[], bigBlind: string): string | null {
  if (
    bigBlind.trim() === "" ||
    !Number.isFinite(Number(bigBlind)) ||
    Number(bigBlind) <= 0
  )
    return "Big blind must be greater than zero.";
  if (
    seats.some(
      (seat) =>
        seat.stack.trim() === "" ||
        !Number.isFinite(Number(seat.stack)) ||
        Number(seat.stack) < 0,
    )
  )
    return "Enter a valid, non-negative stack for every player.";
  if (seats.some((seat) => !seat.name.trim() || seat.name.length > 40))
    return "Player names must contain 1 to 40 characters.";
  return null;
}
export const formatChips = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
