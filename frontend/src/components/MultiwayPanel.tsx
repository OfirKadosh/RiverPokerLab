import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { MultiwayAnalysis, MultiwayRequest } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";

const example = [
  { name: "Hero", hand: "Ah Ad", kind: "hand", behind: "100", invested: "20", call: "50" },
  { name: "Seat 2", hand: "KK, QQ@50%", kind: "range", behind: "80", invested: "20", call: "60" },
  { name: "Seat 3", hand: "Jh Jd", kind: "hand", behind: "55", invested: "20", call: "40" },
];
const cards = (text: string) => text.trim().split(/[\s,]+/).filter(Boolean);
const numbers = (text: string) => text.trim() ? text.split(",").map(part => part.trim() ? Number(part) : NaN) : [];
const { format } = new Intl.NumberFormat("en", { maximumFractionDigits: 3 });

export function MultiwayPanel() {
  const [mode, setMode] = useState<MultiwayRequest["mode"]>("cash");
  const [players, setPlayers] = useState(example);
  const [board, setBoard] = useState("2s 7d Tc");
  const [dealer, setDealer] = useState(0);
  const [decision, setDecision] = useState("open");
  const [sizes, setSizes] = useState("20, 55");
  const [wager, setWager] = useState("20");
  const [unit, setUnit] = useState("1");
  const [samples, setSamples] = useState("2000");
  const [payouts, setPayouts] = useState("65, 35");
  const [outside, setOutside] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MultiwayAnalysis>();
  const [error, setError] = useState("");
  const pending = useRef<AbortController>();
  useEffect(() => () => pending.current?.abort(), []);

  function resize(count: number) {
    setPlayers(previous => Array.from({ length: count }, (_, index) => previous[index] ?? {
      name: `Seat ${index + 1}`, hand: "random", kind: "range", behind: "80", invested: "20", call: "50",
    }));
    if (dealer >= count) setDealer(0);
    setConfirmed(false);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setResult(undefined);
    setError("");
    const input: MultiwayRequest = {
      mode, dealer, board: cards(board), samples: Number(samples), chipUnit: Number(unit),
      players: players.map(player => ({
        name: player.name, behind: Number(player.behind), invested: Number(player.invested),
        callFrequency: Number(player.call) / 100,
        input: player.kind === "hand" ? cards(player.hand) : { type: "range", range: player.hand },
      })),
      ...(decision === "facing" ? { facingBet: Number(wager) } : { sizes: numbers(sizes) }),
      ...(mode === "tournament" && confirmed ? { tournament: {
        confirmed: true, payouts: numbers(payouts),
        outsidePlayers: numbers(outside).map((stack, i) => ({ name: `Outside ${i + 1}`, stack })),
      } } : {}),
    };
    try {
      const { analysis } = await apiClient.analyzeMultiway(input, { signal: controller.signal });
      if (!controller.signal.aborted) setResult(analysis);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Analysis failed.");
    } finally {
      pending.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  return <section className="sidebar-section push-fold-panel" aria-label="Multiway analysis">
    <p className="field-help">Hold’em with 3–6 players. Opponents use the same entered call frequency for each bet size and private hand. A check goes straight to showdown, and called bets run out the board without further betting.</p>
    <form onSubmit={calculate} onChange={() => { setResult(undefined); setError(""); }}>
      <fieldset disabled={busy}>
        <div className="river-settings">
          <label className="field-label">Game mode<select value={mode} onChange={e => {
            setMode(e.target.value === "tournament" ? "tournament" : "cash");
            setConfirmed(false);
          }}><option value="cash">Cash · Chip EV</option><option value="tournament">Tournament · ICM</option></select></label>
          <label className="field-label">Players<select value={players.length} onChange={e => resize(Number(e.target.value))}>
            {[3, 4, 5, 6].map(n => <option key={n}>{n}</option>)}
          </select></label>
          <label className="field-label">Dealer<select value={dealer} onChange={e => setDealer(Number(e.target.value))}>
            {players.map((p, i) => <option key={i} value={i}>{p.name}</option>)}
          </select></label>
          <label className="field-label">Board<input required value={board} onChange={e => setBoard(e.target.value)} /></label>
          <label className="field-label">Decision<select value={decision} onChange={e => setDecision(e.target.value)}>
            <option value="open">Check / Bet</option><option value="facing">Facing Seat 2's bet · Fold / Call</option>
          </select></label>
          {decision === "facing" ?
            <label className="field-label">Outstanding bet<input type="number" min="0.01" step="any" required value={wager} onChange={e => setWager(e.target.value)} /></label> :
            <label className="field-label">Bet sizes in chips<input placeholder="20, 55" value={sizes} onChange={e => setSizes(e.target.value)} /></label>}
          <label className="field-label">Smallest chip<input type="number" min="0.01" step="0.01" required value={unit} onChange={e => setUnit(e.target.value)} /></label>
          <label className="field-label">Samples<input type="number" min="200" max="6000" required value={samples} onChange={e => setSamples(e.target.value)} /></label>
        </div>
        <h2>Seats and contributions</h2>
        <p className="field-help">Enter clockwise seats with Hero first. Committed chips include all prior bets and Seat 2's outstanding bet, if any. Shorter commitments require an existing all-in. Every pot contributor must still be in the hand at the decision. In Fold / Call mode, eligible seats after Seat 2 respond after Hero.</p>
        {players.map((p, i) => {
          function update<K extends keyof typeof p>(key: K, value: (typeof p)[K]) {
            setPlayers(current => current.map((seat, index) => index === i ? { ...seat, [key]: value } : seat));
            setConfirmed(false);
          }
          return <div className="river-settings push-fold-seat" key={i}>
            <label className="field-label">{i === 0 ? "Hero name" : `Seat ${i + 1} name`}<input required maxLength={40} value={p.name} onChange={e => update("name", e.target.value)} /></label>
            <label className="field-label">Private input<select value={p.kind} onChange={e => update("kind", e.target.value)}><option value="hand">Specific hand</option><option value="range">Weighted range</option></select></label>
            <label className="field-label">{p.kind === "hand" ? "Two cards" : "Range"}<input required value={p.hand} onChange={e => update("hand", e.target.value)} /></label>
            <label className="field-label">Stack behind<input required type="number" min="0" step="any" value={p.behind} onChange={e => update("behind", e.target.value)} /></label>
            <label className="field-label">Committed chips<input required type="number" min="0" step="any" value={p.invested} onChange={e => update("invested", e.target.value)} /></label>
            {i > 0 && !(decision === "facing" && i === 1) && <label className="field-label">Call frequency %<input required type="number" min="0" max="100" step="any" value={p.call} onChange={e => update("call", e.target.value)} /></label>}
          </div>;
        })}
        {mode === "tournament" && <>
          <h2>Tournament field</h2>
          <div className="river-settings">
            <label className="field-label">Remaining prizes<input required value={payouts} onChange={e => { setPayouts(e.target.value); setConfirmed(false); }} /></label>
            <label className="field-label">Other players' stacks<input placeholder="Optional, comma-separated" value={outside} onChange={e => { setOutside(e.target.value); setConfirmed(false); }} /></label>
          </div>
          <label className="icm-confirm"><input type="checkbox" required checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />
            I included all remaining players and prizes. Each seat's committed chips plus stack behind is their hand-start stack.</label>
        </>}
        <button type="submit" className="primary-button">Analyze multiway spot</button>
      </fieldset>
    </form>
    {busy && <LoadingIndicator label="Sampling hands and comparing actions…" />}
    {error && <p role="alert" className="validation-note">{error}</p>}
    {result && <section aria-label="Multiway results">
      <h2>{result.hero}'s action values</h2>
      <p className="field-help">{format(result.samples)} paired samples · starting pot {format(result.pot)} chips.
        Chip EV is measured from the stack behind at this decision. Changes and intervals are in {result.mode === "cash" ? "chips" : "prize units"} versus {result.actions[0].type}.</p>
      <div className="river-outcome-wrap"><table className="river-outcome">
        <thead><tr><th>Action</th><th>Chip EV</th>{result.mode === "tournament" && <th>Prize EV</th>}<th>Change</th><th>Approx. 95% interval</th></tr></thead>
        <tbody>{result.actions.map(row => <tr key={`${row.type}-${row.amount}`}>
          <th>{row.type[0].toUpperCase() + row.type.slice(1)}{row.amount > 0 ? ` ${format(row.amount)}` : ""}</th>
          <td>{format(row.chipEv)}</td>{row.prizeEv !== null && <td>{format(row.prizeEv)}</td>}
          <td className={row.delta > 0 ? "value-positive" : row.delta < 0 ? "value-negative" : undefined}>{format(row.delta)}</td><td>{row.interval95.map(format).join(" to ")}</td>
        </tr>)}</tbody>
      </table></div>
    </section>}
  </section>;
}
