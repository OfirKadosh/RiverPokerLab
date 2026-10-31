import type { BettingState } from "../lib/betting";
import type { HandSetup } from "../lib/handSetup";
import { Card } from "./Card";
import { formatChips, handSize } from "../lib/poker";
import type { Seat, GameType, EquityResult } from "../lib/poker";
interface Props {
  seats: Seat[];
  handSetup: HandSetup | null;
  bettingState?: BettingState | null;
  board: (string | null)[];
  gameType: GameType;
  heroSeatId: number;
  bigBlind: number;
  potSize: number;
  results: EquityResult[] | null;
  loading: boolean;
  onSeat: (id: number) => void;
  onBoard: (index: number) => void;
}
// A stable seat layout keeps existing players in place when a seat is added.
const positions = [
  [50, 89],
  [22, 83],
  [8, 59],
  [13, 30],
  [35, 11],
  [65, 11],
  [87, 30],
  [92, 59],
  [78, 83],
];
export function PokerTable({
  seats,
  handSetup,
  bettingState,
  board,
  gameType,
  heroSeatId,
  bigBlind,
  potSize,
  results,
  loading,
  onSeat,
  onBoard,
}: Props) {
  const count = board.filter(Boolean).length;
  return (
    <div className="table-stage">
      <div className="table-felt">
        <div className="felt-line" />
        <span className="felt-brand">
          RIVER<span>POKER LAB</span>
        </span>
      </div>
      <div className="table-center">
        <div className="pot-display">
          <span>TOTAL POT</span>
          <strong>
            <i className="chip-token" />
            {formatChips(Number.isFinite(potSize) ? potSize : 0)}
          </strong>
        </div>
        <div className="board-cards" aria-label="Community cards">
          {board.map((card, index) => (
            <Card
              key={index}
              value={card}
              label={
                [
                  "Flop card 1",
                  "Flop card 2",
                  "Flop card 3",
                  "Turn card",
                  "River card",
                ][index]
              }
              onClick={() => onBoard(index)}
            />
          ))}
        </div>
        <div className="street-label">
          <span className="live-dot" />
          {bettingState
            ? bettingState.street.toUpperCase()
            : count === 0
              ? "PREFLOP"
              : count < 3
                ? "BUILDING FLOP"
                : count === 3
                  ? "FLOP"
                  : count === 4
                    ? "TURN"
                    : "RIVER"}
          <span className="street-divider">/</span>
          {gameType === "holdem" ? "NO-LIMIT HOLD'EM" : "OMAHA HIGH"}
        </div>
      </div>
      {positions.map(([x, y], id) => {
        const seat = seats.find((item) => item.id === id);
        const playerIndex = seats.findIndex((item) => item.id === id);
        const result = results?.find(
          (item) => item.playerIndex === playerIndex,
        );
        return (
          <div
            key={id}
            className={`seat-position seat-position-${id} ${seat ? "occupied-position" : ""}`}
            style={
              {
                "--seat-x": `${x}%`,
                "--seat-y": `${y}%`,
              } as React.CSSProperties
            }
          >
            {seat ? (
              <button
                className={`player-seat ${bettingState?.actorSeatId === id ? "seat-to-act" : ""} ${bettingState?.players.find((player) => player.seatId === id)?.folded ? "seat-folded" : ""} ${heroSeatId === id ? "hero-seat" : ""} ${gameType === "omaha" ? "omaha-seat" : ""}`}
                onClick={() => onSeat(id)}
                aria-label={`Edit ${seat.name}, seat ${id + 1}`}
              >
                {seat.mode === "range" ? (
                  <div className="seat-range-badge">
                    RANGE
                    <span>
                      {seat.range
                        ? `${seat.range.split(",").length} hands`
                        : "Not set"}
                    </span>
                  </div>
                ) : (
                  <div className="seat-cards">
                    {seat.cards.map((card, index) => (
                      <Card key={index} value={card} small />
                    ))}
                  </div>
                )}
                {handSetup?.dealerSeatId === id && (
                  <span
                    className="dealer-chip"
                    role="img"
                    aria-label="Dealer button"
                  >
                    D
                  </span>
                )}
                <div className="player-name">
                  {handSetup && (
                    <span className="position-tag">
                      {
                        handSetup.positions.find((seat) => seat.seatId === id)
                          ?.position
                      }
                    </span>
                  )}
                  <span>{seat.name || `Seat ${id + 1}`}</span>
                  {heroSeatId === id && <b>H</b>}
                </div>
                <div className="seat-stack">
                  {seat.stack.trim() && Number.isFinite(Number(seat.stack))
                    ? formatChips(Number(seat.stack))
                    : "—"}
                  <span>
                    {seat.stack.trim() &&
                    bigBlind > 0 &&
                    Number.isFinite(Number(seat.stack))
                      ? `${formatChips(Number(seat.stack) / bigBlind)} BB`
                      : "— BB"}
                  </span>
                </div>
                <div className={`equity-badge ${result ? "has-equity" : ""}`}>
                  {bettingState?.players.find((player) => player.seatId === id)
                    ?.folded
                    ? "Folded"
                    : result
                      ? `${result.equity.toFixed(1)}%`
                      : loading
                        ? "···"
                        : seat.mode === "range"
                          ? "Range equity"
                          : `${seat.cards.filter(Boolean).length}/${handSize(gameType)} cards`}
                </div>
              </button>
            ) : (
              <button
                className="empty-seat"
                disabled={!!bettingState}
                onClick={() => onSeat(id)}
                aria-label={`Add player at seat ${id + 1}`}
              >
                <span>+</span>
                <small>SEAT {id + 1}</small>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
