export interface HandSetup {
  dealerSeatId: number;
  smallBlind: number;
  bigBlind: number;
  smallBlindSeatId: number;
  bigBlindSeatId: number;
  positions: {
    seatId: number;
    position: string;
    startingStack: number;
    posted: number;
    remaining: number;
    forcedAllIn: boolean;
  }[];
  preflopOrder: number[];
  postflopOrder: number[];
  initialPot: number;
}
export function buildHandSetup(
  seats: { id: number; startingStack: number }[],
  dealerSeatId: number,
  smallBlind: number,
  bigBlind: number,
): HandSetup;
