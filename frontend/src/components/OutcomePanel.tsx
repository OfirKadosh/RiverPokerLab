import { IcmDecisionResult } from "./IcmDecisionResult";
import type { Calculation, Seat } from "../lib/poker";
import { formatChips } from "../lib/poker";
export function OutcomePanel({
  results,
  seats,
}: {
  results: Calculation | null;
  seats: Seat[];
}) {
  const payout = results?.payoutSummary,
    analysis = results?.decisionAnalysis;
  const name = (index: number) => seats[index]?.name || `Player ${index + 1}`;
  return (
    <div className="outcome-panel">
      {payout && (
        <section aria-label="Pot payouts">
          <h3>
            {payout.kind === "final"
              ? "Final pot settlement"
              : payout.kind === "uncontested"
                ? "Uncontested award"
                : "Expected pot payouts"}
          </h3>
          {payout.kind === "unavailable" ? (
            <p>{payout.reason}</p>
          ) : (
            <>
              {payout.kind === "expectation" && (
                <p className="field-help">
                  Expected values across possible hands and runouts; these are
                  not final awards.
                </p>
              )}
              {payout.kind === "uncontested" && (
                <p>
                  {seats.find((seat) => seat.id === payout.winnerSeatId)?.name}{" "}
                  wins {formatChips(payout.award ?? 0)} chips.
                </p>
              )}
              {payout.pots?.map((pot) => (
                <div className="pot-outcome" key={pot.potIndex}>
                  <strong>
                    {pot.potIndex === 0
                      ? "Main pot"
                      : `Side pot ${pot.potIndex}`}{" "}
                    · {formatChips(pot.amount)}
                  </strong>
                  <p className="field-help">
                    Eligible: {pot.eligibleIndices.map(name).join(", ")}
                  </p>
                  {pot.shares
                    ? pot.shares.map((share) => (
                        <p key={share.playerIndex}>
                          {name(share.playerIndex)}: {formatChips(share.amount)}
                          {share.oddChip ? " · Includes odd chip" : ""}
                        </p>
                      ))
                    : pot.expectedPayouts?.map(
                        (amount, index) =>
                          amount > 0 && (
                            <p key={index}>
                              {name(index)}: {formatChips(amount)} expected
                            </p>
                          ),
                      )}
                </div>
              ))}
              <h4>
                {payout.kind === "expectation"
                  ? "Expected ending stacks"
                  : "Ending stacks"}
              </h4>
              {payout.endingStacks?.map((item) => (
                <p key={item.seatId}>
                  {seats.find((seat) => seat.id === item.seatId)?.name}:{" "}
                  <strong>{formatChips(item.stack)}</strong>
                </p>
              ))}
            </>
          )}
        </section>
      )}
      {analysis && (
        <section aria-label="Hero decision analysis">
          <h3>Hero · Fold vs Call</h3>
          {!analysis.available ? (
            <p>{analysis.reason}</p>
          ) : (
            <>
              {analysis.icm && <IcmDecisionResult analysis={analysis.icm} />}
              <p>
                <strong>{analysis.decision}</strong> · Chip EV at this decision
              </p>
              <div className="decision-values">
                <span>
                  Fold <b>0</b>
                </span>
                <span>
                  Call <b>{formatChips(analysis.callEV ?? 0)}</b>
                </span>
              </div>
              <p>Call cost: {formatChips(analysis.callCost ?? 0)} chips</p>
              <p>
                Stack after folding: {formatChips(analysis.stackAfterFold ?? 0)}{" "}
                · Expected stack after calling:{" "}
                {formatChips(analysis.expectedStackAfterCall ?? 0)}
              </p>
              <p className="field-help">
                {analysis.method === "exact" ? "Exact" : "Monte Carlo"} ·{" "}
                {formatChips(analysis.samples ?? 0)}{" "}
                {analysis.method === "exact" ? "legal states" : "samples"}
              </p>
              {analysis.confidence95 && (
                <p className="field-help">
                  Approximate 95% interval for Call EV:{" "}
                  {formatChips(analysis.confidence95[0])} to{" "}
                  {formatChips(analysis.confidence95[1])}. Standard error:{" "}
                  {formatChips(analysis.standardError ?? 0)} chips.
                </p>
              )}
              <details>
                <summary>Calculation assumptions</summary>
                {analysis.assumptions?.map((text) => (
                  <p className="field-help" key={text}>
                    {text}
                  </p>
                ))}
              </details>
            </>
          )}
        </section>
      )}
    </div>
  );
}
