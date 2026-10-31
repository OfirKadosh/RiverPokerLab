import type { BettingAction, BettingState } from "../lib/betting";
import type { Seat } from "../lib/poker";
import { formatChips } from "../lib/poker";
interface Props {
  amount: string;
  setAmount: (value: string) => void;
  seats: Seat[];
  active: boolean;
  state: BettingState | null;
  error: string | null;
  setupError: string | null;
  actionCount: number;
  boardCount: number;
  gameType: string;
  onStart: () => void;
  onExit: () => void;
  onAction: (action: BettingAction) => void;
  onUndo: () => void;
  onChooseBoard: () => void;
}
export function BettingPanel({
  amount,
  setAmount,
  seats,
  active,
  state,
  error,
  setupError,
  actionCount,
  boardCount,
  gameType,
  onStart,
  onExit,
  onAction,
  onUndo,
  onChooseBoard,
}: Props) {
  const name = (id: number | null | undefined) =>
    seats.find((seat) => seat.id === id)?.name || "Player";
  const legal = state?.legal;
  const act = (type: "fold" | "check" | "call" | "allin") => {
    if (state?.actorSeatId !== null && state?.actorSeatId !== undefined)
      onAction({ type, seatId: state.actorSeatId });
  };
  return (
    <section
      className="sidebar-section betting-panel"
      aria-label="Hand action builder"
    >
      <div className="section-heading">
        <h2>Hand action builder</h2>
        <span>4.2</span>
      </div>
      {!active ? (
        <>
          <p className="field-help">
            Record a hand from the blinds onward. Starting preflop clears
            community cards and keeps player hands and ranges.
          </p>
          <button
            className="primary-button full-width"
            disabled={!!setupError}
            onClick={onStart}
          >
            Start hand
          </button>
          <p className="field-help">
            {setupError ||
              "Free equity mode stays available outside the builder."}
          </p>
        </>
      ) : (
        <>
          <div className="builder-toolbar">
            <span>
              {gameType === "omaha" ? "POT-LIMIT OMAHA" : "NO-LIMIT HOLD’EM"}
            </span>
            <button className="text-button" onClick={onExit}>
              Exit builder
            </button>
          </div>
          {error && (
            <p className="validation-note" role="alert">
              {error}
            </p>
          )}
          {state && (
            <>
              <div className="betting-summary">
                <span>{state.street.toUpperCase()}</span>
                <strong>Pot {formatChips(state.pot)}</strong>
              </div>
              {state.status === "uncontested" ? (
                <p className="actor-banner">
                  {name(state.winnerSeatId)} receives {formatChips(state.award)}{" "}
                  uncontested.
                </p>
              ) : state.status === "showdown" ? (
                <p className="actor-banner">
                  Showdown reached. See the equity analysis panel for pot
                  payouts and ending stacks.
                </p>
              ) : state.roundClosed ? (
                <>
                  <p className="actor-banner">Betting round complete.</p>
                  <button
                    className="secondary-button full-width"
                    onClick={onChooseBoard}
                  >
                    Choose{" "}
                    {state.nextBoardCount === 3
                      ? "flop"
                      : state.nextBoardCount === 4
                        ? "turn"
                        : "river"}{" "}
                    cards
                  </button>
                  <button
                    className="primary-button full-width"
                    disabled={boardCount !== state.nextBoardCount}
                    onClick={() => onAction({ type: "advance" })}
                  >
                    Advance to{" "}
                    {state.nextBoardCount === 3
                      ? "flop"
                      : state.nextBoardCount === 4
                        ? "turn"
                        : "river"}
                  </button>
                </>
              ) : (
                legal && (
                  <>
                    <div className="actor-banner">
                      <strong>{name(state.actorSeatId)} to act</strong>
                      <span>
                        Call {formatChips(legal.toCall)}
                        {legal.fullToCall > legal.toCall
                          ? " · All-in call"
                          : ""}
                      </span>
                    </div>
                    <div className="action-buttons">
                      <button
                        className="secondary-button"
                        disabled={!legal.canFold}
                        onClick={() => act("fold")}
                      >
                        Fold
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!legal.canCheck}
                        onClick={() => act("check")}
                      >
                        Check
                      </button>
                      <button
                        className="secondary-button"
                        disabled={legal.canCheck}
                        onClick={() => act("call")}
                      >
                        Call {formatChips(legal.toCall)}
                      </button>
                    </div>
                    <label className="field-label">
                      BET / RAISE TO · STREET TOTAL
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        disabled={!legal.canRaise}
                        placeholder={String(legal.minRaiseTo)}
                      />
                    </label>
                    <div className="sizing-tools">
                      <button
                        className="text-button"
                        disabled={!legal.canRaise}
                        onClick={() =>
                          setAmount(
                            String(
                              Math.min(legal.minRaiseTo, legal.maxRaiseTo),
                            ),
                          )
                        }
                      >
                        Min
                      </button>
                      <button
                        className="text-button"
                        disabled={!legal.canRaise}
                        onClick={() => setAmount(String(legal.maxRaiseTo))}
                      >
                        Max
                      </button>
                      <span>
                        {legal.canRaise
                          ? `${formatChips(legal.minRaiseTo)} min · ${formatChips(legal.maxRaiseTo)} max`
                          : "Raising unavailable / not reopened"}
                      </span>
                    </div>
                    <div className="action-buttons">
                      <button
                        className="primary-button"
                        disabled={!legal.canRaise || amount.trim() === ""}
                        onClick={() =>
                          onAction({
                            type: state.currentBet === 0 ? "bet" : "raise",
                            seatId: state.actorSeatId!,
                            amount: Number(amount),
                          })
                        }
                      >
                        {state.currentBet === 0 ? "Bet" : "Raise"}
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!legal.canAllIn}
                        onClick={() => act("allin")}
                      >
                        All-in
                      </button>
                    </div>
                  </>
                )
              )}
              <div className="ledger-players">
                {state.players.map((player) => (
                  <div key={player.seatId}>
                    <span>
                      {name(player.seatId)}
                      {player.folded
                        ? " · Folded"
                        : player.allIn
                          ? " · All-in"
                          : ""}
                    </span>
                    <strong>{formatChips(player.remaining)} behind</strong>
                    <small>{formatChips(player.committed)} contributed</small>
                  </div>
                ))}
              </div>
              {!!state.pots.length && (
                <details>
                  <summary>Provisional pot layers</summary>
                  {state.pots.map((pot, index) => (
                    <p className="field-help" key={index}>
                      {formatChips(pot.amount)} · eligible:{" "}
                      {pot.eligibleSeatIds.map(name).join(", ") || "None"}
                    </p>
                  ))}
                </details>
              )}
              <details className="action-history" open>
                <summary>Action history ({actionCount})</summary>
                <ol>
                  {state.log.map((entry, index) => (
                    <li key={index}>
                      <b>{entry.street}</b>{" "}
                      {entry.seatId === undefined ? "" : name(entry.seatId)}{" "}
                      {entry.type}
                      {entry.to !== undefined &&
                      ["bet", "raise", "allin"].includes(entry.type)
                        ? ` to ${formatChips(entry.to)}`
                        : entry.amount !== undefined
                          ? ` ${formatChips(entry.amount)}`
                          : ""}
                    </li>
                  ))}
                </ol>
                {!state.log.length && (
                  <p className="field-help">
                    Blinds posted. Waiting for the first action.
                  </p>
                )}
              </details>
            </>
          )}
          <div className="action-buttons">
            <button
              className="secondary-button full-width"
              disabled={!actionCount}
              onClick={onUndo}
            >
              ↶ Undo last action
            </button>
          </div>
          <p className="field-help">
            Setup and seats are locked until you exit. Cards, ranges and Hero
            remain editable. Amounts use up to two decimal places. Undo rewinds
            future board cards when needed.
          </p>
          <p className="field-help">
            Equity is showdown share among players who have not folded; folded
            hands and ranges still block cards. Ranges are not automatically
            narrowed by actions. Payouts are calculated once no future betting
            remains.
          </p>
        </>
      )}
    </section>
  );
}
