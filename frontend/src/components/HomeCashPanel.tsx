import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";
import { HomeCashHistory, HomeCashResults, money } from "./HomeCashHistory";
import type { Settlement } from "./HomeCashHistory";
import "./HomeCashPanel.css";

interface Player { id: string; name: string }
interface Entry {
  id: string;
  playerId: string;
  kind: "buy-in" | "rebuy";
  amount: number;
  chips: number;
  at: string;
  voided: boolean;
}
interface Game {
  id: string;
  name: string;
  buyIn: number;
  chipsPerBuyIn: number;
  status: "active" | "closed" | "cancelled";
  version: number;
  players: Player[];
  entries: Entry[];
  updatedAt: string;
  settlement: Settlement | null;
}
interface Games { active: Game | null; recent: Game | null }
type Command =
  | { type: "configure"; name: string; buyIn: number; chipsPerBuyIn: number }
  | { type: "cancel-empty" }
  | { type: "add-player"; name: string }
  | { type: "remove-player"; playerId: string }
  | { type: "entry"; playerId: string; amount?: number }
  | { type: "void-entry"; entryId: string }
  | { type: "close"; stacks: Record<string, number> };
type Pending =
  | { gameId?: never; body: { id: string; name: string; buyIn: number; chipsPerBuyIn: number } }
  | { gameId: string; body: Command & { id: string; version: number } };

const syncTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const failure = (error: unknown) => error instanceof Error ? error.message : "The game is temporarily unavailable.";

function buyInAmount(value: string) {
  if (!/^\d{1,5}(?:[.,]\d{1,2})?$/.test(value.trim())) return 0;
  const [whole, fraction = ""] = value.trim().split(/[.,]/);
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function savedOperation(prefix: string): Pending | null {
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const raw = localStorage.getItem(key);
      if (raw) return JSON.parse(raw) as Pending;
    }
  } catch {
    // Storage may be blocked. New requests verify storage before sending.
  }
  return null;
}

export function HomeCashPanel({ ownerId, preview }: { ownerId: string; preview: boolean }) {
  const prefix = `river-home-cash:${preview ? "preview:" : ""}${ownerId}:`;
  const [games, setGames] = useState<Games>();
  const [pending, setPending] = useState(() => savedOperation(prefix));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [resumedId, setResumedId] = useState<string>();
  const [refreshing, setRefreshing] = useState(false);
  const [lastSynced, setLastSynced] = useState<Date>();
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [buyIn, setBuyIn] = useState("50");
  const [chips, setChips] = useState("100");
  const [playerName, setPlayerName] = useState("");
  const [customPlayerId, setCustomPlayerId] = useState<string>();
  const [customAmount, setCustomAmount] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const readVersion = useRef(0);
  const alive = useRef(false);

  const load = useCallback(async (signal?: AbortSignal) => {
    const version = ++readVersion.current;
    const isCurrent = () => alive.current && version === readVersion.current && !signal?.aborted;
    setRefreshing(true);
    try {
      const data = await apiClient.request("/home-cash", { signal }) as Games;
      if (!isCurrent()) return;
      setGames(data);
      setLastSynced(new Date());
      setRefreshError(null);
    } catch (caught) {
      if (isCurrent()) setRefreshError(failure(caught));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    function refresh() {
      if (document.visibilityState !== "hidden" && !inFlight.current) {
        setPending(savedOperation(prefix));
        void load(controller.signal);
      }
    }
    function syncPending(event: StorageEvent) {
      if (!inFlight.current && (event.key === null || event.key.startsWith(prefix))) {
        setPending(savedOperation(prefix));
      }
    }
    void load(controller.signal);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("storage", syncPending);
    return () => {
      alive.current = false;
      controller.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("storage", syncPending);
    };
  }, [load, prefix]);

  async function save(operation: Pending) {
    if (inFlight.current) return;
    const key = prefix + operation.body.id;
    try {
      localStorage.setItem(key, JSON.stringify(operation));
    } catch {
      setError("Allow browser storage to save and safely retry this action.");
      return;
    }
    const retry = pending?.body.id === operation.body.id;
    inFlight.current = true;
    readVersion.current += 1;
    setRefreshing(false);
    setPending(operation);
    setSaving(true);
    setNotice(null);
    setError(null);

    function forget() {
      localStorage.removeItem(key);
      if (alive.current) setPending(savedOperation(prefix));
    }

    try {
      const path = operation.gameId ? `/home-cash/${operation.gameId}/actions` : "/home-cash";
      const data = await apiClient.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(operation.body),
      }) as { game: Game };
      forget();
      if (!alive.current) return;
      setResumedId(data.game.id);
      if (operation.gameId && "type" in operation.body) {
        if (operation.body.type === "add-player") setPlayerName("");
        if (operation.body.type === "entry") setCustomPlayerId(undefined);
      }
      if (data.game.status !== "active") {
        setClosing(false);
        setDraft({});
        setTitle("");
      }
      setGames((previous) => data.game.status === "active"
        ? { active: data.game, recent: previous?.recent ?? null }
        : { active: null, recent: data.game.status === "closed" ? data.game : previous?.recent ?? null });
      setNotice("Saved.");
      setLastSynced(new Date());
      setRefreshError(null);
      if (retry) await load();
    } catch (caught) {
      if (caught instanceof ApiError && [400, 404, 409].includes(caught.status) &&
          !["INVALID_RESPONSE", "ACCOUNT_CHANGED"].includes(caught.code ?? "")) {
        forget();
        if (alive.current) {
          setError(failure(caught));
          await load();
        }
      } else if (alive.current) {
        setError("Save not confirmed. Retry the same action when your connection returns.");
      }
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  }

  const game = games?.active;
  const gameId = game?.id;
  useEffect(() => {
    setClosing(false);
    setDraft({});
    setPlayerName("");
    setCustomPlayerId(undefined);
  }, [gameId]);
  const resumed = gameId !== undefined && resumedId === gameId;
  function act(command: Command) {
    if (!game || pending) return;
    void save({ gameId: game.id, body: { ...command, id: crypto.randomUUID(), version: game.version } });
  }

  const entries = game?.entries.filter((entry) => !entry.voided) ?? [];
  const playerTotals = new Map<string, { count: number; paid: number }>();
  let collected = 0;
  let issued = 0;
  for (const entry of entries) {
    const totals = playerTotals.get(entry.playerId) ?? { count: 0, paid: 0 };
    totals.count += 1;
    totals.paid += entry.amount;
    playerTotals.set(entry.playerId, totals);
    collected += entry.amount;
    issued += entry.chips;
  }
  const funded = game?.players.filter((player) => playerTotals.has(player.id)) ?? [];
  const amount = buyInAmount(customAmount);
  const customChips = game ? (amount * game.chipsPerBuyIn) / game.buyIn : 0;
  const validCustomEntry = amount <= 1_000_000 && Number.isSafeInteger(customChips) && customChips > 0;
  const complete = funded.every(({ id }) => /^\d+$/.test(draft[id] ?? "") && Number(draft[id]) <= issued);
  const entered = funded.reduce((total, { id }) => total + (Number(draft[id]) || 0), 0);
  const busy = !!pending || saving;

  return (
    <div className="home-cash">
      {preview && <p className="field-help">Preview games use temporary storage and reset when the local preview server restarts.</p>}
      {saving && <LoadingIndicator label="Saving game…" compact />}
      {notice && <p role="status" className="field-help">{notice}</p>}
      {error && <p role="alert" className="validation-note">{error}</p>}
      {refreshError && (
        <p role="status" className="validation-note">
          {games ? "Could not refresh the game. Showing the last confirmed data." : refreshError}
        </p>
      )}
      {games && (
        <div className="home-cash-sync">
          <span className="field-help" role="status">
            {refreshing ? "Checking for updates…" : lastSynced ? `Last synced at ${syncTime.format(lastSynced)}` : ""}
          </span>
          <button className="text-button" disabled={saving || refreshing} onClick={() => void load()}>Refresh game</button>
        </div>
      )}
      {pending && !saving && (
        <div className="home-cash-panel">
          <p>A previous action is waiting for confirmation. Retrying it will not record it twice.</p>
          <button className="primary-button" onClick={() => void save(pending)}>Retry save</button>
        </div>
      )}
      {!games && refreshing && <LoadingIndicator label="Loading your game…" />}
      {!games && refreshError && !pending && !refreshing && (
        <button className="secondary-button" onClick={() => void load()}>Reload game</button>
      )}
      {game && !resumed && (
        <section className="home-cash-panel">
          <h2>{game.name}</h2>
          <p>{game.players.length} players · {money(collected)} collected</p>
          <button className="primary-button" disabled={busy} onClick={() => setResumedId(game.id)}>Resume game</button>
        </section>
      )}
      {games && !game && (
        <form className="home-cash-panel" onSubmit={(event) => {
          event.preventDefault();
          if (busy) return;
          const amount = buyInAmount(buyIn);
          if (!amount || amount > 1_000_000) {
            setError("Enter a buy-in of ₪0.01–₪10,000 with up to two decimal places.");
            return;
          }
          void save({ body: { id: crypto.randomUUID(), name: title, buyIn: amount, chipsPerBuyIn: Number(chips) } });
        }}>
          <h2>Start a game</h2>
          <label className="field-label">Game name
            <input required maxLength={60} value={title} placeholder="Friday poker" onChange={(event) => setTitle(event.target.value)} />
          </label>
          <div className="home-cash-fields">
            <label className="field-label">Buy-in (₪)
              <input required inputMode="decimal" maxLength={8} value={buyIn} onChange={(event) => setBuyIn(event.target.value)} />
            </label>
            <label className="field-label">Chips per buy-in
              <input required type="number" min={1} max={1000000} step={1} value={chips} onChange={(event) => setChips(event.target.value)} />
            </label>
          </div>
          <p className="field-help">Every buy-in and rebuy uses the same rate for this game.</p>
          <button className="primary-button" disabled={busy}>Start game</button>
        </form>
      )}
      {game && resumed && (
        <>
          <section className="home-cash-panel">
            <h2>{game.name}</h2>
            <p>{money(game.buyIn)} = {game.chipsPerBuyIn.toLocaleString()} chips per buy-in</p>
            <p><strong>{money(collected)} collected</strong> · {issued.toLocaleString()} chips issued</p>
            {game.entries.length === 0 && (
              <details>
                <summary>Edit game settings</summary>
                <form key={game.version} onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const amount = buyInAmount(String(form.get("buyIn")));
                  if (!amount || amount > 1_000_000) {
                    setError("Enter a buy-in of ₪0.01–₪10,000 with up to two decimal places.");
                    return;
                  }
                  act({ type: "configure", name: String(form.get("name")), buyIn: amount, chipsPerBuyIn: Number(form.get("chips")) });
                }}>
                  <label className="field-label">Game name
                    <input name="name" required maxLength={60} defaultValue={game.name} />
                  </label>
                  <div className="home-cash-fields">
                    <label className="field-label">Buy-in (₪)
                      <input name="buyIn" required inputMode="decimal" maxLength={8} defaultValue={(game.buyIn / 100).toFixed(2)} />
                    </label>
                    <label className="field-label">Chips per buy-in
                      <input name="chips" required type="number" min={1} max={1000000} step={1} defaultValue={game.chipsPerBuyIn} />
                    </label>
                  </div>
                  <button className="secondary-button" disabled={busy}>Save settings</button>
                </form>
              </details>
            )}
          </section>
          <section className="home-cash-panel">
            <h2>Players</h2>
            <form className="home-cash-player-form" onSubmit={(event) => {
              event.preventDefault();
              act({ type: "add-player", name: playerName });
            }}>
              <label className="field-label">Player name
                <input required maxLength={40} value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
              </label>
              <button className="secondary-button" disabled={busy || closing}>Add player</button>
            </form>
            {game.players.map((player) => {
              const { count, paid } = playerTotals.get(player.id) ?? { count: 0, paid: 0 };
              const action = count ? "Rebuy" : "Buy in";
              return (
                <div className="home-cash-player" key={player.id}>
                  <div><strong>{player.name}</strong><br /><span className="field-help">{count} {count === 1 ? "entry" : "entries"} · {money(paid)}</span></div>
                  <div className="home-cash-actions">
                    {!count && <button className="text-button" disabled={busy || closing} aria-label={`Remove ${player.name}`} onClick={() => act({ type: "remove-player", playerId: player.id })}>Remove</button>}
                    <button className="secondary-button" disabled={busy || closing} aria-label={`${action} for ${player.name}`} onClick={() => act({ type: "entry", playerId: player.id })}>{action} · {money(game.buyIn)}</button>
                    <button className="text-button" disabled={busy || closing} aria-label={`Custom amount for ${player.name}`}
                      aria-expanded={customPlayerId === player.id && !closing} onClick={() => {
                        setCustomPlayerId(customPlayerId === player.id ? undefined : player.id);
                        setCustomAmount("");
                      }}>Custom amount</button>
                  </div>
                  {customPlayerId === player.id && !closing && (
                    <form className="home-cash-custom-entry" onSubmit={(event) => {
                      event.preventDefault();
                      if (validCustomEntry) act({ type: "entry", playerId: player.id, amount });
                    }}>
                      <label className="field-label">Amount for {player.name} (₪)
                        <input required inputMode="decimal" maxLength={8} value={customAmount}
                          onChange={(event) => setCustomAmount(event.target.value)} />
                      </label>
                      <p className="field-help" aria-live="polite">
                        {validCustomEntry ? `${customChips.toLocaleString()} chips` :
                          customAmount ? "Enter ₪0.01–₪10,000 in an amount that converts to whole chips." :
                            "This entry uses the game's chip rate."}
                      </p>
                      <button className="primary-button" disabled={busy || !validCustomEntry}>Record {action.toLowerCase()}</button>
                    </form>
                  )}
                </div>
              );
            })}
            {game.entries.length > 0 && (
              <details>
                <summary>Entry log and corrections</summary>
                <ol className="home-cash-log">
                  {[...game.entries].reverse().map((entry) => (
                    <li key={entry.id} className="home-cash-player">
                      <span>{game.players.find((player) => player.id === entry.playerId)?.name ?? "Removed player"} · {entry.kind === "rebuy" ? "Rebuy" : "Buy-in"} · {money(entry.amount)} · {entry.chips.toLocaleString()} chips · {new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}{entry.voided ? " · Corrected" : ""}</span>
                      {!entry.voided && <button className="text-button" disabled={busy || closing} onClick={() => {
                        if (window.confirm("Undo this entry? The chip and cash totals will be updated.")) act({ type: "void-entry", entryId: entry.id });
                      }}>Undo entry</button>}
                    </li>
                  ))}
                </ol>
              </details>
            )}
          </section>
          <section className="home-cash-panel">
            <h2>Close game</h2>
            {!closing && <>
              <p className="field-help">Record buy-ins for at least two players, then count their final chips.</p>
              <div className="home-cash-actions">
                <button className="secondary-button" disabled={busy || funded.length < 2} onClick={() => setClosing(true)}>Enter final chips</button>
                {!entries.length && <button className="text-button" disabled={busy} onClick={() => {
                  if (window.confirm("Cancel this empty game?")) act({ type: "cancel-empty" });
                }}>Cancel empty game</button>}
              </div>
            </>}
            {closing && (
              <form onSubmit={(event) => {
                event.preventDefault();
                if (busy || !complete || entered !== issued || funded.length < 2) return;
                if (window.confirm("Close this game and save the final results?")) {
                  act({ type: "close", stacks: Object.fromEntries(funded.map(({ id }) => [id, Number(draft[id])])) });
                }
              }}>
                {funded.map((player) => (
                  <label className="field-label home-cash-stack" key={player.id}>Final chips for {player.name}
                    <input required inputMode="numeric" type="number" min={0} max={issued} step={1}
                      value={draft[player.id] ?? ""} onChange={(event) => setDraft({ ...draft, [player.id]: event.target.value })} />
                  </label>
                ))}
                <p aria-live="polite" className={entered === issued ? "field-help" : "validation-note"}>
                  {entered.toLocaleString()} of {issued.toLocaleString()} chips entered.
                  {complete && entered !== issued && ` Difference: ${(entered - issued).toLocaleString()} chips.`}
                </p>
                <div className="home-cash-actions">
                  <button className="primary-button" disabled={busy || !complete || entered !== issued || funded.length < 2}>Save results and close</button>
                  <button type="button" className="text-button" disabled={busy} onClick={() => setClosing(false)}>Back to game</button>
                </div>
              </form>
            )}
          </section>
        </>
      )}
      {games?.recent?.settlement && !game && (
        <HomeCashResults key={games.recent.id} name={games.recent.name} closedAt={games.recent.updatedAt}
          settlement={games.recent.settlement} latest />
      )}
      {games && (
        <>
          <button className="secondary-button" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>
            {showHistory ? "Hide game history" : "Game history"}
          </button>
          {showHistory && <HomeCashHistory key={games.recent?.id ?? "empty"} />}
        </>
      )}
    </div>
  );
}
