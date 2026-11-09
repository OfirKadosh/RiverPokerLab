import { useEffect, useRef, useState } from "react";
import { apiClient } from "../lib/api";
import { Card } from "./Card";
import { LoadingIndicator } from "./LoadingIndicator";

type Mode = "cash" | "tournament";
type Action = "fold" | "call";
type Spot = {
  id: string;
  mode: Mode;
  board: string[];
  hand: string[];
  pot: number;
  toCall: number;
  range: { cards: string[]; percent: number }[];
  actions: Action[];
  fieldStacks?: number[];
  payouts?: number[];
};
type Result = {
  selected: Action;
  correct: boolean;
  accepted: Action[];
  tolerance: number;
  actions: { type: Action; chipEv: number; prizeEv?: number }[];
};

const labels = { fold: "Fold", call: "Call" };
const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const number = (value: number) => format.format(Math.abs(value) < 0.005 ? 0 : value);

export function PracticePanel() {
  const [mode, setMode] = useState<Mode>("cash");
  const [spot, setSpot] = useState<Spot>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);

  async function request(path: string, body: object, receive: (data: Record<string, unknown>) => void) {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setError("");
    try {
      const data = await apiClient.request(path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: controller.signal,
      });
      if (!controller.signal.aborted) receive(data);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : "Practice is temporarily unavailable.");
    } finally {
      pending.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function newSpot() {
    void request("/practice/spots", { mode }, (data) => {
      setSpot(data.spot as Spot);
      setResult(undefined);
    });
  }

  function answer(action: Action) {
    if (!spot || result) return;
    void request(`/practice/spots/${spot.id}/answer`, { action }, (data) => setResult(data.result as Result));
  }

  return (
    <>
      <section className="sidebar-section">
        <div className="section-heading"><h2>River practice</h2></div>
        <p className="field-help">Heads-up Hold'em. You checked the river and face an all-in.</p>
        <label className="field-label">
          Game mode
          <select value={mode} disabled={busy} onChange={(event) => {
            setMode(event.target.value as Mode);
            setSpot(undefined);
            setResult(undefined);
            setError("");
          }}>
            <option value="cash">Cash</option>
            <option value="tournament">Tournament · ICM</option>
          </select>
        </label>
        <button type="button" className="primary-button" disabled={busy} onClick={newSpot}>New spot</button>
        {busy && <LoadingIndicator label="Loading practice…" />}
        {error && <p role="alert" className="validation-note">{error}</p>}
      </section>
      {spot && <section className="sidebar-section">
        <h2>Fold or call?</h2>
        <p className="field-help">Pot after the shove: {spot.pot} chips · To call: {spot.toCall} chips</p>
        <h3>Board</h3>
        <div className="river-board">{spot.board.map((card) => <Card key={card} value={card} small />)}</div>
        <h3>Your hand</h3>
        <div className="river-board">{spot.hand.map((card) => <Card key={card} value={card} small />)}</div>
        <p className="field-help">Opponent's assumed shoving range</p>
        <ul>{spot.range.map(({ cards, percent }) => <li key={cards.join("")}>{cards.join(" ")} · {percent}%</li>)}</ul>
        {spot.mode === "tournament" && (
          <p className="field-help">
            Hand-start stacks (you, opponent, third player): {spot.fieldStacks?.join(" / ")} chips.
            Remaining prizes: {spot.payouts?.join(" / ")} prize units.
          </p>
        )}
        <div className="river-actions">
          {spot.actions.map((action) => (
            <button key={action} type="button" className="secondary-button"
              disabled={busy || !!result} onClick={() => answer(action)}>{labels[action]}</button>
          ))}
        </div>
        {result && <div className="inline-note" role="status">
          <strong>{result.correct ? "Accepted" : "Try another spot"} · You chose {labels[result.selected]}</strong>
          <p>Best within {number(result.tolerance)} {spot.mode === "cash" ? "chips" : "prize units"}: {result.accepted.map((action) => labels[action]).join(" or ")}.</p>
          <ul>{result.actions.map(({ type, chipEv, prizeEv }) => (
            <li key={type}>
              {labels[type]}: {number(chipEv)} chip EV{prizeEv !== undefined ? ` · ${number(prizeEv)} prize EV` : ""}
            </li>
          ))}</ul>
          <p className="field-help">
            {spot.mode === "cash"
              ? "Cash grades the chip EV from calling against the assumed range or folding."
              : "Tournament grades expected prizes across the remaining field using ICM. A call can gain chips and still reduce expected prizes."}
          </p>
        </div>}
      </section>}
    </>
  );
}
