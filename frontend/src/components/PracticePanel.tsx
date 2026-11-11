import { useEffect, useRef, useState } from "react";
import { signedValueClass } from "../lib/signedValue";
import { AchievementCelebration, PracticeAchievements } from "./PracticeAchievements";
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

type Progress = {
  answered: number;
  correct: number;
  correctStreak: number;
  bestCorrectStreak: number;
  dayStreak: number;
  bestDayStreak: number;
  zone: string | null;
  milestones: string[];
};

const labels = { fold: "Fold", call: "Call" };
const format = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
const displayedValue = (value: number) => Math.abs(value) < 0.005 ? 0 : value;
const number = (value: number) => format.format(displayedValue(value));
function DecisionValue({ value }: { value: number }) {
  const shown = displayedValue(value);
  return <strong className={signedValueClass(shown)}>{shown > 0 ? "+" : ""}{number(shown)}</strong>;
}

export function PracticePanel() {
  const [mode, setMode] = useState<Mode>("cash");
  const [spot, setSpot] = useState<Spot>();
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress>();
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [progressError, setProgressError] = useState(false);
  const pending = useRef<AbortController>();
  useEffect(() => {
    const controller = new AbortController();
    apiClient.request("/practice/progress", { signal: controller.signal }).then(
      (data) => { if (!controller.signal.aborted) setProgress((current) => current ?? data.progress as Progress); },
      () => { if (!controller.signal.aborted) setProgressError(true); },
    );
    return () => {
      controller.abort();
      pending.current?.abort();
    };
  }, []);

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
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void request(`/practice/spots/${spot.id}/answer`, { action, timeZone }, (data) => {
      setResult(data.result as Result);
      setProgress(data.progress as Progress);
      setUnlocked((data.unlockedMilestones as string[] | undefined) ?? []);
      setProgressError(false);
    });
  }

  const foldPrizeEv = result?.actions.find((action) => action.type === "fold")?.prizeEv;

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
              {labels[type]}: <DecisionValue value={chipEv} /> chip EV
              {prizeEv !== undefined && foldPrizeEv !== undefined && (
                <> · {number(prizeEv)} prize EV (<DecisionValue value={prizeEv - foldPrizeEv} /> vs folding)</>
              )}
            </li>
          ))}</ul>
          <p className="field-help">
            {spot.mode === "cash"
              ? "Cash grades the chip EV from calling against the assumed range or folding."
              : "Tournament grades expected prizes across the remaining field using ICM. A call can gain chips and still reduce expected prizes."}
          </p>
        </div>}
      </section>}
      <section className="sidebar-section" aria-label="Practice progress">
        <h2>Practice progress</h2>
        {progress ? <>
          <div className="icm-results" aria-live="polite">
            <div className="icm-result">
              <h3>Answers</h3>
              <dl>
                <div><dt>Correct / answered</dt><dd>{progress.correct} / {progress.answered}</dd></div>
                <div><dt>Correct in a row</dt><dd>{progress.correctStreak}</dd></div>
                <div><dt>Best correct streak</dt><dd>{progress.bestCorrectStreak}</dd></div>
              </dl>
            </div>
            <div className="icm-result">
              <h3>Practice days</h3>
              <dl>
                <div><dt>Current day streak</dt><dd>{progress.dayStreak}</dd></div>
                <div><dt>Best day streak</dt><dd>{progress.bestDayStreak}</dd></div>
                <div><dt>Time zone</dt><dd>{progress.zone || "Set with your first answer"}</dd></div>
              </dl>
            </div>
          </div>
          <h3>Achievements</h3>
          <PracticeAchievements earned={progress.milestones} />
        </> : progressError ? <p className="field-help">Practice progress is temporarily unavailable.</p>
          : <LoadingIndicator label="Loading progress…" />}
      </section>
      {unlocked.length > 0 && <AchievementCelebration milestones={unlocked} onDismiss={() => setUnlocked([])} />}
    </>
  );
}
