import { LoadingIndicator } from "./LoadingIndicator";
import { feedbackFetch as fetch } from "../lib/loading";
import { useEffect, useRef, useState } from "react";
import type { Seat } from "../lib/poker";
import { formatChips } from "../lib/poker";

import {
  createIcmExample as example,
  fieldSetter,
} from "../lib/workspaceState";
import type {
  IcmPlayer as Player,
  IcmWorkspaceState,
} from "../lib/workspaceState";
import type { Dispatch, SetStateAction } from "react";
const money = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(Math.abs(value) < 1e-8 ? 0 : value);
const percent = (value: number) => `${(value * 100).toFixed(2)}%`;

export function IcmPanel({
  api,
  seats,
  state,
  setState,
}: {
  api: string;
  seats: Seat[];
  state: IcmWorkspaceState;
  setState: Dispatch<SetStateAction<IcmWorkspaceState>>;
}) {
  const { players, payoutText, confirmed, response } = state;
  const setPlayers = fieldSetter(setState, "players"),
    setPayoutText = fieldSetter(setState, "payoutText"),
    setConfirmed = fieldSetter(setState, "confirmed"),
    setResponse = fieldSetter(setState, "response");
  const [failure, setFailure] = useState<{
    key: string;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const key = JSON.stringify({ players, payoutText, confirmed });
  const result = response?.key === key ? response.data : null;
  useEffect(() => {
    controller.current?.abort();
    setLoading(false);
    return () => controller.current?.abort();
  }, [key]);

  function edit(id: number, changes: Partial<Player>) {
    setPlayers((current) =>
      current.map((player) =>
        player.id === id ? { ...player, ...changes } : player,
      ),
    );
  }
  async function calculate() {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setLoading(true);
    setFailure(null);
    setResponse(null);
    try {
      const tokens = payoutText.split(/[,\n]/).map((token) => token.trim());
      if (tokens.some((token) => !token || !/^\d+(?:\.\d{1,2})?$/.test(token)))
        throw new Error(
          "Enter prizes as numbers with up to two decimals, separated by commas or new lines. Do not use thousands separators.",
        );
      if (players.some((player) => !player.stack.trim()))
        throw new Error("Enter every remaining player's stack.");
      const reply = await fetch(`${api}/icm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          players: players.map((player) => ({
            name: player.name,
            stack: Number(player.stack),
          })),
          payouts: tokens.map(Number),
        }),
      });
      const data = await reply.json();
      if (request.signal.aborted) return;
      if (!reply.ok || !data.success)
        throw new Error(data.error || "ICM calculation failed.");
      setResponse({ key, data });
    } catch (error) {
      if (!request.signal.aborted)
        setFailure({
          key,
          message:
            error instanceof Error
              ? error.message
              : "Cannot reach the backend.",
        });
    } finally {
      if (!request.signal.aborted) setLoading(false);
    }
  }
  return (
    <section
      className="sidebar-section icm-panel"
      aria-label="Tournament ICM calculator"
    >
      <div className="section-heading">
        <h2>Tournament ICM</h2>
        <span>07</span>
      </div>
      <p className="field-help">
        Value each stack using all remaining tournament players and prizes. This
        calculator is independent of the cards and hand builder. Supports 2–9
        remaining players, including players at other tables.
      </p>
      <div className="icm-tools">
        <button
          className="text-button"
          onClick={() => {
            setPlayers(example());

            setPayoutText("50, 30, 20");
            setConfirmed(true);
          }}
        >
          Load 3-player example
        </button>
        <button
          className="text-button"
          onClick={() => {
            setPlayers(
              seats.map((seat, id) => ({
                id,
                name: seat.name,
                stack: seat.startingStack,
              })),
            );

            setConfirmed(false);
          }}
        >
          Copy table starting stacks
        </button>
      </div>
      <p className="field-help">
        Copy uses stacks before blinds and actions, not chips behind or
        projected payouts. Review the entire remaining field before calculating.
      </p>
      <div className="icm-players">
        {players.map((player, index) => (
          <div className="icm-player" key={player.id}>
            <label className="field-label">
              PLAYER {index + 1}
              <input
                aria-label={`ICM player ${index + 1} name`}
                maxLength={40}
                value={player.name}
                onChange={(event) =>
                  edit(player.id, { name: event.target.value })
                }
              />
            </label>
            <label className="field-label">
              STACK
              <input
                aria-label={`ICM player ${index + 1} stack`}
                type="number"
                min="0.01"
                step="0.01"
                value={player.stack}
                onChange={(event) =>
                  edit(player.id, { stack: event.target.value })
                }
              />
            </label>
            <button
              className="text-button icm-remove"
              aria-label={`Remove ICM player ${index + 1}`}
              disabled={players.length <= 2}
              onClick={() => {
                setPlayers((current) =>
                  current.filter((item) => item.id !== player.id),
                );
                setConfirmed(false);
              }}
            >
              Remove
            </button>
          </div>
        ))}
      </div>
      <button
        className="secondary-button full-width"
        disabled={players.length >= 9}
        onClick={() => {
          const id = Math.max(...players.map((player) => player.id), -1) + 1;
          setPlayers((current) => [
            ...current,
            { id, name: `Player ${current.length + 1}`, stack: "" },
          ]);
          setConfirmed(false);
        }}
      >
        + Add remaining player
      </button>
      <label className="field-label icm-payout-label">
        REMAINING PRIZES · FIRST TO LAST
        <textarea
          aria-label="ICM remaining prizes"
          rows={3}
          value={payoutText}
          onChange={(event) => setPayoutText(event.target.value)}
        />
      </label>
      <p className="field-help">
        Use one currency or prize unit throughout. Example: 50, 30, 20. Omitted
        last places receive zero. Include guaranteed prizes still owed to
        remaining players; exclude prizes already awarded to eliminated players.
        Positive stacks only.
      </p>
      <label className="icm-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        These are all remaining players and remaining prizes.
      </label>
      <button
        className="primary-button full-width"
        aria-label={loading ? "Calculating ICM…" : "Calculate ICM"}
        disabled={!confirmed || loading}
        onClick={() => void calculate()}
      >
        {loading ? <LoadingIndicator label="Calculating ICM…" compact /> : "Calculate ICM"}
      </button>
      {failure?.key === key && (
        <p role="alert" className="validation-note">
          {failure.message}
        </p>
      )}
      <div aria-live="polite" role="status">
        {result && <p>ICM results are up to date · Exact model calculation</p>}
      </div>
      {result && (
        <div className="icm-results" aria-label="ICM results">
          <p>
            <strong>{formatChips(result.totalChips)}</strong> total chips ·{" "}
            <strong>{money(result.totalPrize)}</strong> remaining prize units
          </p>
          <p className="field-help">
            ICM prize equity is an expected value, not a guaranteed payment. The
            chip-proportional value is shown only for comparison.
          </p>
          {result.results.map((player) => (
            <article className="icm-result" key={player.playerIndex}>
              <h3>{player.name}</h3>
              <dl>
                <div>
                  <dt>Chips</dt>
                  <dd>
                    {formatChips(player.stack)} · {percent(player.chipShare)}
                  </dd>
                </div>
                <div>
                  <dt>ICM prize equity</dt>
                  <dd>
                    <strong>{money(player.prizeEquity)}</strong> ·{" "}
                    {percent(player.prizeShare)}
                  </dd>
                </div>
                <div>
                  <dt>Chip-proportional prize</dt>
                  <dd>{money(player.proportionalPrize)}</dd>
                </div>
                <div>
                  <dt>Difference</dt>
                  <dd>
                    {player.differenceFromProportional > 1e-8 ? "+" : ""}
                    {money(player.differenceFromProportional)}
                  </dd>
                </div>
              </dl>
              <details>
                <summary>Finish probabilities</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Place</th>
                      <th>Probability</th>
                      <th>Prize</th>
                    </tr>
                  </thead>
                  <tbody>
                    {player.finishProbabilities.map((probability, place) => (
                      <tr key={place}>
                        <td>{place + 1}</td>
                        <td>{percent(probability)}</td>
                        <td>{money(result.payouts[place])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </article>
          ))}
        </div>
      )}
      <p className="analysis-disclaimer">
        ICM uses stacks and payouts with equal skill assumed. It does not model
        positions, future blinds, bounties or deal negotiations. Use the
        Tournament page for saved, hand-connected ICM Fold/Call analysis. This
        worksheet is retained while navigating, but is not saved to spot
        history.
      </p>
    </section>
  );
}
