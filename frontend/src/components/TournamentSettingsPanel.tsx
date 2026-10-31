import { apiFetch as fetch } from "../lib/api";
import { useEffect, useRef, useState } from "react";
import type { Seat, TournamentSettings } from "../lib/poker";
import { fieldSetter } from "../lib/workspaceState";
import type { TournamentDraft } from "../lib/workspaceState";
import type { Dispatch, SetStateAction } from "react";
import { formatChips } from "../lib/poker";
interface Props {
  api: string;
  draft: TournamentDraft;
  setDraft: Dispatch<SetStateAction<TournamentDraft>>;
  seats: Seat[];
  settings: TournamentSettings | null;
  onApply: (settings: TournamentSettings | null) => void;
  onDirty: (dirty: boolean) => void;
  issue: string | null;
}
export function TournamentSettingsPanel({
  api,
  draft,
  setDraft,
  seats,
  settings,
  onApply,
  onDirty,
  issue,
}: Props) {
  const { payoutText, others, confirmed } = draft;
  const setPayoutText = fieldSetter(setDraft, "payoutText"),
    setOthers = fieldSetter(setDraft, "others"),
    setConfirmed = fieldSetter(setDraft, "confirmed");
  const [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const request = useRef<AbortController | null>(null);
  const signature = JSON.stringify({
    payoutText,
    others,
    confirmed,
    table: seats.map((seat) => [seat.id, seat.startingStack, seat.name]),
  });
  useEffect(() => {
    request.current?.abort();
    setBusy(false);
    return () => request.current?.abort();
  }, [signature]);
  function dirty() {
    onDirty(true);
    setError(null);
  }
  async function apply() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError(null);
    try {
      const tokens = payoutText.split(/[,\n]/).map((s) => s.trim());
      if (tokens.some((s) => !/^\d+(?:\.\d{1,2})?$/.test(s)))
        throw Error(
          "Enter prizes separated by commas or new lines, with up to two decimals and no thousands separators.",
        );
      if (others.some((p) => !p.stack.trim()))
        throw Error("Enter every other player's stack.");
      const otherPlayers = others.map((p) => ({
          name: p.name,
          stack: Number(p.stack),
        })),
        payouts = tokens.map(Number);
      const response = await fetch(`${api}/icm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          players: [
            ...seats.map((seat) => ({
              name: seat.name,
              stack: Number(seat.startingStack),
            })),
            ...otherPlayers,
          ],
          payouts,
        }),
      });
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !data.success)
        throw Error(data.error || "Invalid tournament settings.");
      onApply({
        fieldConfirmed: true,
        eliminationRule: "starting-stack-split",
        tableSeats: seats.map((seat) => ({
          seatId: seat.id,
          startingStack: Number(seat.startingStack),
        })),
        otherPlayers: data.results
          .slice(seats.length)
          .map((p: { name: string; stack: number }) => ({
            name: p.name,
            stack: p.stack,
          })),
        payouts: data.payouts,
      });
      onDirty(false);
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Cannot reach the backend.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section
      className="sidebar-section icm-panel"
      aria-label="Tournament decision settings"
    >
      <div className="section-heading">
        <h2>Tournament decision settings</h2>
        <span>08</span>
      </div>
      <p className="field-help">
        Apply prizes and the entire remaining field to enable ICM Fold/Call
        analysis. All current table players are included using their hand-start
        stacks.
      </p>
      <details>
        <summary>Included table players ({seats.length})</summary>
        {seats.map((seat) => (
          <p className="field-help" key={seat.id}>
            {seat.name}: {formatChips(Number(seat.startingStack))} starting
            chips
          </p>
        ))}
      </details>
      <label className="field-label icm-payout-label">
        REMAINING PRIZES · FIRST TO LAST
        <textarea
          aria-label="Decision tournament prizes"
          value={payoutText}
          rows={3}
          placeholder="50, 30, 20"
          onChange={(event) => {
            setPayoutText(event.target.value);
            dirty();
          }}
        />
      </label>
      <p className="field-help">
        One currency or prize unit. Include guaranteed cash still owed; exclude
        prizes already awarded. Omitted last places receive zero.
      </p>
      <h3>Players at other tables</h3>
      {others.map((player, index) => (
        <div className="icm-player" key={index}>
          <label className="field-label">
            NAME
            <input
              aria-label={`Other player ${index + 1} name`}
              maxLength={40}
              value={player.name}
              onChange={(event) => {
                setOthers((current) =>
                  current.map((p, i) =>
                    i === index ? { ...p, name: event.target.value } : p,
                  ),
                );
                dirty();
              }}
            />
          </label>
          <label className="field-label">
            STACK
            <input
              aria-label={`Other player ${index + 1} stack`}
              type="number"
              min="0.01"
              step="0.01"
              value={player.stack}
              onChange={(event) => {
                setOthers((current) =>
                  current.map((p, i) =>
                    i === index ? { ...p, stack: event.target.value } : p,
                  ),
                );
                dirty();
              }}
            />
          </label>
          <button
            className="text-button icm-remove"
            onClick={() => {
              setOthers((current) => current.filter((_, i) => i !== index));
              setConfirmed(false);
              dirty();
            }}
          >
            Remove other player {index + 1}
          </button>
        </div>
      ))}
      <button
        className="secondary-button full-width"
        disabled={seats.length + others.length >= 9}
        onClick={() => {
          setOthers((current) => [
            ...current,
            { name: `Other player ${current.length + 1}`, stack: "" },
          ]);
          setConfirmed(false);
          dirty();
        }}
      >
        + Add player at another table
      </button>
      <label className="icm-confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => {
            setConfirmed(event.target.checked);
            dirty();
          }}
        />
        These are all 2–9 remaining players and remaining prizes.
      </label>
      <p className="field-help">
        Simultaneous eliminations: larger hand-start stacks finish higher; equal
        stacks split the combined prizes. Other tables' stacks stay fixed during
        this hand.
      </p>
      <button
        className="primary-button full-width"
        disabled={!confirmed || busy}
        onClick={() => void apply()}
      >
        {busy ? "Applying…" : "Apply tournament settings"}
      </button>
      <button
        className="text-button"
        onClick={() => {
          onApply(null);
          onDirty(false);
          setPayoutText("");
          setOthers([]);
          setConfirmed(false);
          setError(null);
        }}
      >
        Use Chip EV only
      </button>
      <p role="status" className="field-help">
        {issue ||
          (settings
            ? "Tournament settings applied. Saved with this spot."
            : "No tournament settings applied. Decision analysis uses chips.")}
      </p>
      {error && (
        <p role="alert" className="validation-note">
          {error}
        </p>
      )}
    </section>
  );
}
