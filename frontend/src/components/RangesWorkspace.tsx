import { RangeEditor } from "./RangeEditor";
import type {
  Seat,
  GameType,
  RangeConfig,
  RangeDraft,
  RangeAction,
} from "../lib/poker";
export function RangesWorkspace({
  seats,
  gameType,
  selectedId,
  onSelect,
  api,
  deadCards,
  drafts,
  onDraft,
  onCommit,
  onEnable,
  lastActions,
}: {
  lastActions: Record<number, string>;
  seats: Seat[];
  gameType: GameType;
  selectedId: number;
  onSelect: (id: number) => void;
  api: string;
  deadCards: string[];
  drafts: Record<number, RangeDraft>;
  onDraft: (id: number, draft: RangeDraft) => void;
  onCommit: (id: number, config: RangeConfig) => void;
  onEnable: (id: number) => void;
}) {
  const seat = seats.find((item) => item.id === selectedId) || seats[0];
  return (
    <section className="sidebar-section" aria-label="Player ranges workspace">
      <h2>Player ranges</h2>
      <p className="field-help">
        Edit weighted priors and frequency profiles here. Drafts are retained
        across pages; Apply commits to the current spot. Applying a range
        invalidates previous results.
      </p>
      {gameType !== "holdem" ? (
        <p className="inline-note">
          Range notation is currently available for Hold'em. Omaha continues to
          use four specific hole cards per player.
        </p>
      ) : (
        <>
          <label className="field-label">
            PLAYER
            <select
              aria-label="Range player"
              value={seat.id}
              onChange={(event) => onSelect(Number(event.target.value))}
            >
              {seats.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.name} ·{" "}
                  {player.mode === "range" ? "Range" : "Specific hand"}
                </option>
              ))}
            </select>
          </label>
          {seat.mode === "range" && lastActions[seat.id] && (
            <div className="inline-note">
              <p>
                Last recorded action: {lastActions[seat.id]}. This node's
                profiles must describe that observation.
              </p>
              <button
                className="secondary-button"
                disabled={
                  !seat.actionRanges?.[
                    lastActions[seat.id] as Exclude<RangeAction, "base">
                  ]
                }
                onClick={() => {
                  const config = {
                    range: seat.range,
                    actionRanges: seat.actionRanges,
                    rangeAction: lastActions[seat.id] as RangeAction,
                  };
                  onCommit(seat.id, config);
                  onDraft(seat.id, {
                    range: config.range,
                    actionRanges: config.actionRanges || {},
                    rangeAction: config.rangeAction,
                  });
                }}
              >
                Use last recorded action
              </button>
              <p className="field-help">
                Uses applied profiles only; apply draft edits first. Earlier
                decision points are not multiplied automatically.
              </p>
            </div>
          )}
          {seat.mode !== "range" ? (
            <>
              <p className="field-help">
                This player currently uses specific cards. Switching to a range
                clears those cards, including their blockers.
              </p>
              <button
                className="primary-button"
                onClick={() => onEnable(seat.id)}
              >
                Use range for {seat.name}
              </button>
            </>
          ) : (
            <RangeEditor
              key={seat.id}
              value={seat.range}
              actionRanges={seat.actionRanges}
              rangeAction={seat.rangeAction}
              api={api}
              deadCards={deadCards}
              draftState={drafts[seat.id]}
              onDraftChange={(draft) => onDraft(seat.id, draft)}
              onCommit={(config) => onCommit(seat.id, config)}
            />
          )}
        </>
      )}
    </section>
  );
}
