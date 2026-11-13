import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { PushFoldAnalysis, PushFoldRequest } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";

const examplePlayers = [
  { name: "Button", stack: "1200", pushRange: "66+, A9s+, ATo+, KQs", callRange: "88+, AQs+, AKo" },
  { name: "Small blind", stack: "850", pushRange: "44+, A7s+, ATo+, KQs", callRange: "77+, AJs+, AQo+" },
  { name: "Big blind", stack: "1950", pushRange: "", callRange: "66+, ATs+, AJo+, KQs" },
];
const { format } = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });
const list = (text: string) => text.trim() ? text.split(",").map((part) => part.trim() ? Number(part) : NaN) : [];

export function PushFoldPanel() {
  const [players, setPlayers] = useState(examplePlayers);
  const [hero, setHero] = useState(0);
  const [dealer, setDealer] = useState(0);
  const [shover, setShover] = useState("");
  const [smallBlind, setSmallBlind] = useState("50");
  const [bigBlind, setBigBlind] = useState("100");
  const [ante, setAnte] = useState("0");
  const [payouts, setPayouts] = useState("65, 35");
  const [outside, setOutside] = useState("");
  const [hand, setHand] = useState("");
  const [samples, setSamples] = useState("120");
  const [analysis, setAnalysis] = useState<PushFoldAnalysis>();
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController>();
  const row = analysis?.rows.find((item) => item.hand === selected);
  useEffect(() => () => pending.current?.abort(), []);

  function resize(count: number) {
    setPlayers((previous) => Array.from({ length: count }, (_, index) => previous[index] ?? {
      name: `Seat ${index + 1}`, stack: "1000", pushRange: "", callRange: "",
    }));
    if (hero >= count) setHero(0);
    if (dealer >= count) setDealer(0);
    if (shover !== "" && Number(shover) >= count) setShover("");
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const cards = hand.trim().split(/[\s,]+/).filter(Boolean);
    if (cards.length && cards.length !== 2) {
      setError("Enter two cards, such as As Kh, or leave this field blank.");
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setAnalysis(undefined);
    setError("");
    const input: PushFoldRequest = {
      players: players.map((player) => ({ ...player, stack: Number(player.stack) })),
      hero, dealer, ...(shover !== "" ? { shover: Number(shover) } : {}),
      smallBlind: Number(smallBlind), bigBlind: Number(bigBlind), ante: Number(ante),
      payouts: list(payouts), samples: Number(samples),
      outsidePlayers: list(outside).map((stack, index) => ({ name: `Other table ${index + 1}`, stack })),
      ...(cards.length ? { hand: [cards[0], cards[1]] } : {}),
    };
    try {
      const { analysis: result } = await apiClient.analyzePushFold(input, { signal: controller.signal });
      if (!controller.signal.aborted) {
        setAnalysis(result);
        setSelected(result.rows[0].hand);
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      pending.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  const ranks = [..."AKQJT98765432"];
  const matrix = ranks.flatMap((high, i) => ranks.map((low, j) =>
    i === j ? high + low : i < j ? high + low + "s" : low + high + "o"));
  const byHand = new Map(analysis?.rows.map((item) => [item.hand, item]));
  const action = analysis?.action === "call" ? "Call" : "Push";

  return (
    <section className="sidebar-section push-fold-panel">
      <form onSubmit={(event) => void calculate(event)} onChange={() => setAnalysis(undefined)}>
        <fieldset disabled={busy}>
          <div className="river-settings">
            <label className="field-label">Table players<select value={players.length} onChange={(e) => resize(Number(e.target.value))}>
              {Array.from({ length: 8 }, (_, index) => <option key={index}>{index + 2}</option>)}
            </select></label>
            <label className="field-label">Dealer<select value={dealer} onChange={(e) => setDealer(Number(e.target.value))}>
              {players.map(({ name }, index) => <option key={index} value={index}>{name}</option>)}
            </select></label>
            <label className="field-label">Hero<select value={hero} onChange={(e) => {
              setHero(Number(e.target.value));
              if (shover === e.target.value) setShover("");
            }}>
              {players.map(({ name }, index) => <option key={index} value={index}>{name}</option>)}
            </select></label>
            <label className="field-label">Decision<select value={shover} onChange={(e) => setShover(e.target.value)}>
              <option value="">Unopened pot · Push/Fold</option>
              {players.map(({ name }, index) => index !== hero && <option key={index} value={index}>Facing {name}'s shove</option>)}
            </select></label>
            <label className="field-label">Small blind<input required type="number" min="1" value={smallBlind} onChange={(e) => setSmallBlind(e.target.value)} /></label>
            <label className="field-label">Big blind<input required type="number" min="1" value={bigBlind} onChange={(e) => setBigBlind(e.target.value)} /></label>
            <label className="field-label">Ante per player<input required type="number" min="0" value={ante} onChange={(e) => setAnte(e.target.value)} /></label>
            <label className="field-label">Remaining prizes<input required placeholder="65, 35" value={payouts} onChange={(e) => setPayouts(e.target.value)} /></label>
            <label className="field-label">Stacks at other tables<input placeholder="Optional, comma-separated" value={outside} onChange={(e) => setOutside(e.target.value)} /></label>
            <label className="field-label">Hero's cards<input placeholder="As Kh or blank for matrix" value={hand} onChange={(e) => setHand(e.target.value)} /></label>
            <label className="field-label">Samples per hand<input required type="number" min="30" max="240" value={samples} onChange={(e) => setSamples(e.target.value)} /></label>
          </div>
          <h2>Stacks and ranges</h2>
          <p className="field-help">Enter seats in clockwise order and stacks before blinds and antes. Players must have chips left after posting. Blank ranges fold. Use AA, AKs, or AA@50% for mixed actions.</p>
          {players.map((player, index) => (
            <div className="river-settings push-fold-seat" key={index}>
              {([
                ["name", "Name"], ["stack", "Starting stack"], ["pushRange", "Push range"], ["callRange", "Call range"],
              ] as const).map(([field, label]) => (
                <label className="field-label" key={field}>{label}
                  <input aria-label={`Seat ${index + 1} ${label.toLowerCase()}`} value={player[field]}
                    required={field === "stack" || field === "name"} type={field === "stack" ? "number" : "text"}
                    min={field === "stack" ? 1 : undefined} maxLength={field === "name" ? 40 : 2048}
                    onChange={(e) => setPlayers((previous) => previous.map((seat, at) =>
                      at === index ? { ...seat, [field]: e.target.value } : seat))} />
                </label>
              ))}
            </div>
          ))}
          <button className="primary-button">Analyze decision</button>
        </fieldset>
      </form>
      <p className="field-help">Hold’em · Fixed opponent ranges · Push, call or fold only. In the facing-shove model, intervening players have folded. Earlier folds do not condition card ranges. No bounties.</p>
      {busy && <LoadingIndicator label="Sampling hands and valuing payouts…" />}
      {error && <p className="validation-note" role="alert">{error}</p>}
      {analysis && (
        <section aria-label="Push/Fold results">
          <h2>Decision by hand</h2>
          <p className="field-help">{analysis.samplesPerHand} Monte Carlo samples per hand · approximate 95% interval. The decision uses prize EV. Close means the interval includes zero.</p>
          {analysis.rows.length + analysis.blockedHands.length === 169 && (
            <div className="push-fold-matrix-scroll">
              <div className="push-fold-matrix" role="group" aria-label="Starting hand matrix">
                {matrix.map((label) => {
                  const item = byHand.get(label);
                  return <button type="button" key={label} disabled={!item} aria-pressed={selected === label}
                    aria-label={`${label}: ${item?.recommendation ?? "blocked"}`}
                    className={item?.recommendation === "fold" ? "value-negative" : item?.recommendation === analysis.action ? "value-positive" : undefined}
                    onClick={() => setSelected(label)}>{label}</button>;
                })}
              </div>
            </div>
          )}
          {row && <div className="inline-note" aria-live="polite">
            <strong>{row.hand} · {row.recommendation === "close" ? "Close / uncertain" : row.recommendation === "fold" ? "Fold" : action}</strong>
            <p>{action} {format(row.aggressive.chips)} chips / {format(row.aggressive.prize)} prize units</p>
            <p>Fold {format(row.fold.chips)} chips / {format(row.fold.prize)} prize units</p>
            <p className="field-help">Chip EV is net from the starting stack. Prize EV includes expected tournament payouts.</p>
            <p>Difference {format(row.chipDelta)} chips / {format(row.prizeDelta)} prize units</p>
            <p>Prize difference interval {row.confidence95.map(format).join(" to ")}</p>
          </div>}
        </section>
      )}
    </section>
  );
}
