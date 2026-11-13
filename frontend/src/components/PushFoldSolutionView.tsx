import { useState } from "react";
import type { PushFoldSolution } from "@river-poker-lab/core";

const ranks = [..."AKQJT98765432"];
export const startingHandMatrix = ranks.flatMap((high, i) => ranks.map((low, j) =>
  i === j ? high + low : i < j ? high + low + "s" : low + high + "o"));

const { format } = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
const { format: percent } = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 });

export function PushFoldSolutionView({ solution }: { solution: PushFoldSolution }) {
  const ordered = [...solution.contexts].sort((a, b) =>
    Number(a.action === "call") - Number(b.action === "call") ||
    solution.seats.findIndex(({ seat }) => seat === a.seat) -
      solution.seats.findIndex(({ seat }) => seat === b.seat) ||
    (a.shover ?? 0) - (b.shover ?? 0) || a.priorCallers - b.priorCallers);
  const [contextId, setContextId] = useState(ordered[0].id);
  const [selectedHand, setSelectedHand] = useState("AA");
  const context = ordered.find(({ id }) => id === contextId) ?? ordered[0];
  const indexByHand = new Map(solution.hands.map((hand, index) => [hand, index]));
  const selected = indexByHand.get(selectedHand)!;
  const frequency = context.frequencies[selected];
  const seats = new Map(solution.seats.map(({ seat, name, position }) => [seat, `${name} (${position})`]));
  const action = context.action === "push" ? "Push" : "Call";

  return (
    <section aria-label="Solved Push/Fold ranges">
      <h2>Solved ranges</h2>
      <p className="field-help">{format(solution.trainingDeals)} training deals · {format(solution.evaluationDeals)} evaluation deals. Frequencies are sampled estimates. A dash marks insufficient visits.</p>
      <label className="field-label">Decision to inspect
        <select value={context.id} onChange={(event) => setContextId(Number(event.target.value))}>
          {ordered.map(({ id, seat, action, shover, priorCallers }) => (
            <option key={id} value={id}>{action === "push"
              ? `${seats.get(seat)} · Open push`
              : `${seats.get(seat)} · Call vs ${seats.get(shover!)} · ${priorCallers} earlier calls`}</option>
          ))}
        </select>
      </label>
      <div className="push-fold-matrix-scroll">
        <div className="push-fold-matrix push-fold-solved-matrix" role="group" aria-label="Solved hand matrix">
          {startingHandMatrix.map((hand) => {
            const frequency = context.frequencies[indexByHand.get(hand)!];
            return (
              <button type="button" key={hand} aria-pressed={selectedHand === hand}
                aria-label={`${hand}: ${frequency === null ? "insufficient visits" : `${percent(frequency)} ${action.toLowerCase()}`}`}
                className={frequency === null ? "unsampled" : frequency >= 0.5 ? "value-positive" : undefined}
                onClick={() => setSelectedHand(hand)}>
                <span>{hand}</span>
                <span>{frequency === null ? "–" : Math.round(frequency * 100)}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="inline-note" aria-live="polite">
        <strong>{selectedHand} · {frequency === null ? "Insufficient visits" : `${action} ${percent(frequency)} / Fold ${percent(1 - frequency)}`}</strong>
        <p>{format(context.visits[selected])} training visits</p>
      </div>
      <h3>Sampled deviation check</h3>
      <p className="field-help">Expected prize change per dealt hand for one tested strategy change per seat. An interval above zero indicates room to improve. Other possible changes may do better.</p>
      <ul>
        {solution.deviations.map(({ seat, gain, confidence95 }) => (
          <li key={seat}>{seats.get(seat)} · {format(gain)} prize units ({confidence95.map(format).join(" to ")}; approx. 95%)</li>
        ))}
      </ul>
    </section>
  );
}
