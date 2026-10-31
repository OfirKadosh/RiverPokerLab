export type GameType = "holdem" | "omaha";
export type GameMode = "cash" | "tournament";
export type RangeAction =
  "base" | "fold" | "check" | "call" | "bet" | "raise" | "allin";
export interface RangeConfig {
  range: string;
  actionRanges?: Partial<Record<Exclude<RangeAction, "base">, string>>;
  rangeAction?: RangeAction;
}
export interface RangeDraft {
  range: string;
  actionRanges: Partial<Record<Exclude<RangeAction, "base">, string>>;
  rangeAction: RangeAction;
}
export interface Seat extends RangeConfig {
  id: number;
  name: string;
  stack: string;
  startingStack: string;
  cards: (string | null)[];
  mode: "hand" | "range";
  range: string;
}
export interface TableState {
  seats: {
    id: number;
    name: string;
    stack: number;
    startingStack?: number;
    cards: string[];
    mode?: "hand" | "range";
    range?: string;
    actionRanges?: RangeConfig["actionRanges"];
    rangeAction?: RangeAction;
  }[];
  heroSeatId: number;
  bigBlind: number;
  betting?: { actions: import("./betting").BettingAction[] };
  handSetup?: { dealerSeatId: number; smallBlind: number };
}
export type PlayerInput =
  { type: "hand"; cards: string[] } | ({ type: "range" } & RangeConfig);
export interface EquityResult {
  playerIndex: number;
  equity: number;
}
export type CalculationMethod = "auto" | "exact" | "monteCarlo";
export interface PotResult {
  potIndex: number;
  amount: number;
  eligibleIndices: number[];
  expectedPayouts?: number[];
  shares?: { playerIndex: number; amount: number; oddChip: boolean }[];
}
export interface TournamentSettings {
  fieldConfirmed: true;
  eliminationRule: "starting-stack-split";
  tableSeats: { seatId: number; startingStack: number }[];
  otherPlayers: { name: string; stack: number }[];
  payouts: number[];
}
export interface IcmDecision {
  available: boolean;
  reason?: string;
  decision?: string;
  expectedCallPrize?: number;
  expectedFoldPrize?: number;
  deltaCallVsFold?: number;
  standardError?: number;
  confidence95?: [number, number] | null;
  totalPrize?: number;
  outcomeCount?: number;
  outcomesTruncated?: boolean;
  players?: {
    playerIndex: number;
    name: string;
    seatId?: number;
    expectedCallPrize: number;
    expectedFoldPrize: number;
  }[];
  outcomes?: {
    probability: number;
    callStacks: number[];
    foldStacks: number[];
    heroCallValue: number;
    heroFoldValue: number;
    callEliminations: {
      playerIndex: number;
      firstPlace: number;
      lastPlace: number;
      prize: number;
    }[];
    foldEliminations: {
      playerIndex: number;
      firstPlace: number;
      lastPlace: number;
      prize: number;
    }[];
  }[];
  assumptions?: string[];
}
export interface DecisionAnalysis {
  icm?: IcmDecision;
  available: boolean;
  reason?: string;
  heroSeatId?: number;
  callCost?: number;
  callEV?: number;
  foldEV?: number;
  expectedStackAfterCall?: number;
  stackAfterFold?: number;
  decision?: string;
  standardError?: number;
  confidence95?: [number, number] | null;
  method?: "exact" | "monteCarlo";
  samples?: number;
  assumptions?: string[];
}
export interface PayoutSummary {
  kind: "unavailable" | "uncontested" | "final" | "expectation";
  reason?: string;
  winnerSeatId?: number;
  award?: number;
  endingStacks?: { seatId: number; stack: number }[];
  pots: PotResult[];
}
export interface Calculation {
  success: boolean;
  error?: string;
  results: EquityResult[];
  iterations: number;
  method?: "exact" | "monteCarlo";
  samples?: number;
  enumeration?: { available: boolean; reason?: string };
  payoutSummary?: PayoutSummary;
  decisionAnalysis?: DecisionAnalysis;
  tournament?: TournamentSettings;
  savedSpotId?: string;
  rangeStats?: {
    observedAction?: RangeAction;
    totalMass?: number;
    availableMass?: number;
    playerIndex: number;
    totalCombos: number;
    availableCombos: number;
    blockedCombos: number;
  }[];
}
export interface SavedSpot {
  _id: string;
  gameType: GameType;
  gameMode?: GameMode;
  players: string[][];
  playerInputs?: PlayerInput[];
  board: string[];
  potSize: number;
  callAmount: number;
  createdAt: string;
  calculationMethod?: CalculationMethod;
  chipUnit?: number;
  decisionAnalysis?: DecisionAnalysis;
  tournament?: TournamentSettings;
  tableState?: TableState;
}
export const RANKS = [
  "A",
  "K",
  "Q",
  "J",
  "T",
  "9",
  "8",
  "7",
  "6",
  "5",
  "4",
  "3",
  "2",
];
export const SUITS = ["s", "h", "c", "d"];
export const SYMBOLS: Record<string, string> = {
  s: "♠",
  h: "♥",
  c: "♣",
  d: "♦",
};
export const SUIT_NAMES: Record<string, string> = {
  s: "spades",
  h: "hearts",
  c: "clubs",
  d: "diamonds",
};
export const handSize = (type: GameType) => (type === "omaha" ? 4 : 2);
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
