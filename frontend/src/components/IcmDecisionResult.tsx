import type { IcmDecision } from "../lib/poker";
import { formatChips } from "../lib/poker";
const prize = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Math.abs(value) < 1e-8 ? 0 : value);
export function IcmDecisionResult({ analysis }: { analysis: IcmDecision }) {
  if (!analysis.available)
    return (
      <div aria-label="ICM decision result">
        <h4>ICM prize EV</h4>
        <p>{analysis.reason}</p>
      </div>
    );
  const names = analysis.players?.map((player) => player.name) || [];
  return (
    <div className="icm-decision" aria-label="ICM decision result">
      <h4>ICM prize EV · {analysis.decision}</h4>
      <div className="decision-values">
        <span>
          Fold <b>{prize(analysis.expectedFoldPrize ?? 0)}</b>
        </span>
        <span>
          Call <b>{prize(analysis.expectedCallPrize ?? 0)}</b>
        </span>
      </div>
      <p>
        Call minus Fold: <strong>{prize(analysis.deltaCallVsFold ?? 0)}</strong>{" "}
        prize units
      </p>
      <p className="field-help">
        Values include guaranteed cash and elimination awards, averaged after
        valuing each complete outcome. Fold prize EV is not zero. All values use
        the units of your prizes.
      </p>
      {analysis.confidence95 && (
        <p className="field-help">
          Approximate 95% interval for Call minus Fold:{" "}
          {prize(analysis.confidence95[0])} to {prize(analysis.confidence95[1])}
          . Paired standard error: {prize(analysis.standardError ?? 0)} prize
          units.
        </p>
      )}
      <details>
        <summary>All players' expected prize values</summary>
        {analysis.players?.map((player) => (
          <p key={player.playerIndex}>
            {player.name}: Call {prize(player.expectedCallPrize)} · Fold{" "}
            {prize(player.expectedFoldPrize)}
          </p>
        ))}
      </details>
      <details>
        <summary>Outcome breakdown ({analysis.outcomeCount})</summary>
        <p className="field-help">
          {analysis.outcomesTruncated
            ? "Showing the 12 most frequent paired outcomes. Totals include every outcome."
            : "All paired outcome groups shown."}{" "}
          Frequencies are exact under exhaustive enumeration and estimates under
          Monte Carlo.
        </p>
        {analysis.outcomes?.map((outcome, index) => (
          <div className="pot-outcome" key={index}>
            <strong>
              {(outcome.probability * 100).toFixed(2)}% · Call{" "}
              {prize(outcome.heroCallValue)} / Fold{" "}
              {prize(outcome.heroFoldValue)}
            </strong>
            <p className="field-help">
              Call stacks:{" "}
              {outcome.callStacks
                .map((stack, i) => `${names[i]} ${formatChips(stack)}`)
                .join(" · ")}
            </p>
            <p className="field-help">
              Fold stacks:{" "}
              {outcome.foldStacks
                .map((stack, i) => `${names[i]} ${formatChips(stack)}`)
                .join(" · ")}
            </p>
            {(
              [
                ["Call", outcome.callEliminations],
                ["Fold", outcome.foldEliminations],
              ] as const
            ).map(
              ([branch, awards]) =>
                awards.length > 0 && (
                  <p className="field-help" key={branch}>
                    {branch} eliminations:{" "}
                    {awards
                      .map(
                        (award) =>
                          `${names[award.playerIndex]} · place ${award.firstPlace}${award.lastPlace !== award.firstPlace ? `–${award.lastPlace} shared` : ""} · prize ${prize(award.prize)}`,
                      )
                      .join("; ")}
                  </p>
                ),
            )}
          </div>
        ))}
      </details>
      <details>
        <summary>ICM assumptions</summary>
        {analysis.assumptions?.map((text) => (
          <p className="field-help" key={text}>
            {text}
          </p>
        ))}
      </details>
    </div>
  );
}
