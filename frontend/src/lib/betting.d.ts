export type BettingAction =
  | {
      type: "fold" | "check" | "call" | "bet" | "raise" | "allin";
      seatId: number;
      amount?: number;
    }
  | { type: "advance" };
export interface BettingState {
  street: string;
  requiredBoardCount: number;
  nextBoardCount: number | null;
  actorSeatId: number | null;
  roundClosed: boolean;
  status: "playing" | "showdown" | "uncontested";
  pot: number;
  currentBet: number;
  lastFullRaise: number;
  winnerSeatId: number | null;
  award: number;
  eligibleSeatIds: number[];
  pots: { amount: number; eligibleSeatIds: number[] }[];
  legal: null | {
    toCall: number;
    fullToCall: number;
    canCheck: boolean;
    canFold: boolean;
    canRaise: boolean;
    minRaiseTo: number;
    maxRaiseTo: number;
    canAllIn: boolean;
    actorSeatId: number;
  };
  players: {
    seatId: number;
    remaining: number;
    committed: number;
    streetCommitted: number;
    folded: boolean;
    allIn: boolean;
  }[];
  log: {
    type: string;
    seatId?: number;
    amount?: number;
    to?: number;
    street: string;
  }[];
}
export function replayBetting(
  config: {
    seats: { id: number; startingStack: number }[];
    dealerSeatId: number;
    smallBlind: number;
    bigBlind: number;
    gameType: string;
  },
  actions?: BettingAction[],
  boardCount?: number,
): BettingState;
