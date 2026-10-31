import type { HandSetup } from "../lib/handSetup";
import type { Seat } from "../lib/poker";
import { formatChips } from "../lib/poker";
interface Props {
  seats: Seat[];
  setup: HandSetup | null;
  error: string | null;
  onUsePot: () => void;
}
export function HandSetupPanel({ seats, setup, error, onUsePot }: Props) {
  const name = (id: number) =>
    seats.find((seat) => seat.id === id)?.name || `Seat ${id + 1}`;
  return (
    <section
      className="sidebar-section hand-setup-panel"
      aria-label="Hand setup preview"
    >
      <div className="section-heading">
        <h2>Hand setup preview</h2>
        <span>4.1</span>
      </div>
      {error || !setup ? (
        <p className="validation-note" role="status">
          {error || "Complete hand setup."}
        </p>
      ) : (
        <>
          <div className="blind-preview">
            {setup.positions
              .filter((seat) => seat.posted > 0)
              .map((seat) => (
                <div key={seat.seatId}>
                  <span>
                    <b>{seat.position}</b> {name(seat.seatId)}
                  </span>
                  <strong>{formatChips(seat.posted)} posted</strong>
                  <small>
                    {formatChips(seat.remaining)} behind
                    {seat.forcedAllIn ? " · Forced all-in" : ""}
                  </small>
                </div>
              ))}
          </div>
          <div className="initial-pot">
            <span>Initial pot · posted blinds</span>
            <strong>{formatChips(setup.initialPot)}</strong>
          </div>
          <button className="secondary-button full-width" onClick={onUsePot}>
            Use blind pot
          </button>
          <div className="action-order">
            <h3>Preflop order</h3>
            <ol aria-label="Preflop action order">
              {setup.preflopOrder.map((id) => (
                <li key={id}>
                  <b>
                    {
                      setup.positions.find((seat) => seat.seatId === id)
                        ?.position
                    }
                  </b>
                  <span>{name(id)}</span>
                </li>
              ))}
            </ol>
            {!setup.preflopOrder.length && <p>No player has chips behind.</p>}
            <h3>Postflop order</h3>
            <ol aria-label="Postflop action order">
              {setup.postflopOrder.map((id) => (
                <li key={id}>
                  <b>
                    {
                      setup.positions.find((seat) => seat.seatId === id)
                        ?.position
                    }
                  </b>
                  <span>{name(id)}</span>
                </li>
              ))}
            </ol>
            {!setup.postflopOrder.length && <p>No player has chips behind.</p>}
          </div>
          <p className="field-help">
            Clockwise order skips empty seats and players forced all-in by
            blinds. This is an order preview, not a live turn tracker. Folds,
            calls, raises and action legality arrive in 4.2.
          </p>
        </>
      )}
      <p className="field-help">
        Blind posting is a preview. Starting stacks, current stacks and the
        manual pot are independent. Use blind pot changes the manual pot and
        sets the call amount to zero.
      </p>
    </section>
  );
}
