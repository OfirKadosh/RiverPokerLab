import { useCallback, useEffect, useRef, useState } from "react";
import { signedValueClass } from "../lib/signedValue";
import { suggestedTransfers } from "../lib/homeCashTransfers";
import { apiClient } from "../lib/api";
import { LoadingIndicator } from "./LoadingIndicator";

interface Result {
  id: string;
  name: string;
  chips: number;
  paid: number;
  payout: number;
  cashOutPaid?: number;
  profit: number;
}

export interface Settlement {
  collected: number;
  issuedChips: number;
  players: Result[];
}

interface ClosedGame {
  id: string;
  name: string;
  closedAt: string;
  settlement: Settlement;
}

interface HistoryPage {
  games: { id: string; name: string; closedAt: string; collected: number }[];
  next: string | null;
}

const currency = new Intl.NumberFormat("en-IL", { style: "currency", currency: "ILS" });
const closedDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
export const money = (agorot: number) => currency.format(agorot / 100);
const net = (value: number) => `${value > 0 ? "+" : ""}${money(value)}`;
const shareDate = new Intl.DateTimeFormat("he-IL", { dateStyle: "medium", timeStyle: "short" });
const shareMoney = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });
const shareNet = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS", signDisplay: "exceptZero" });
const hebrewMoney = (agorot: number) => shareMoney.format(agorot / 100);
const dateLabel = (date: string) => closedDate.format(new Date(date));

export function HomeCashResults({ name, closedAt, settlement, latest = false }: Omit<ClosedGame, "id"> & { latest?: boolean }) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "manual" | null>(null);
  const [showTransfers, setShowTransfers] = useState(false);
  const paidEarly = settlement.players.reduce((total, row) => total + (row.cashOutPaid ?? 0), 0);
  const hasCashOuts = settlement.players.some((row) => row.cashOutPaid !== undefined);
  const transfers = showTransfers && paidEarly === 0 ? suggestedTransfers(settlement.players) : null;
  const transferLines = transfers?.map(({ from, to, amount }) => `${from.name} pays ${to.name} ${money(amount)}`);
  const heading = latest ? `Latest results · ${name}` : name;
  const summary = [
    `סיכום משחק קאש ביתי – ${name}`,
    shareDate.format(new Date(closedAt)),
    `סך הכניסות: ${hebrewMoney(settlement.collected)}`,
    ...(hasCashOuts ? [`שולם במהלך הערב: ${hebrewMoney(paidEarly)} · נותר לשלם: ${hebrewMoney(settlement.collected - paidEarly)}`] : []),
    "",
    ...settlement.players.map((player) => {
      const result = `שחקן: ${player.name} · הכניס: ${hebrewMoney(player.paid)} · סך זכאות: ${hebrewMoney(player.payout)} · רווח או הפסד: ${shareNet.format(player.profit / 100)}`;
      return player.cashOutPaid === undefined ? result :
        `${result} · כבר שולם: ${hebrewMoney(player.cashOutPaid)} · נותר לשלם: ${hebrewMoney(player.payout - player.cashOutPaid)}`;
    }),
    ...(transfers?.length ? ["", "העברות מוצעות לסגירת המשחק",
      ...transfers.map(({ from, to, amount }) => `העברה מ־${from.name} אל ${to.name}: ${hebrewMoney(amount)}`)] : []),
  ].join("\n");

  async function copy() {
    try {
      await navigator.clipboard.writeText(summary);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("manual");
    }
  }

  return (
    <section className="home-cash-panel" aria-label={latest ? "Latest results" : "Game results"}>
      <h2>{heading}</h2>
      <p className="field-help">{dateLabel(closedAt)}</p>
      <p>{money(settlement.collected)} in buy-ins · {settlement.issuedChips.toLocaleString()} chips returned</p>
      {hasCashOuts && <p className="field-help">
        {money(paidEarly)} paid early · {money(settlement.collected - paidEarly)} left to pay
      </p>}
      {settlement.players.map((row) => (
        <div className="home-cash-player" key={row.id}>
          <div>
            <strong>{row.name}</strong><br />
            <span className="field-help">
              {row.chips.toLocaleString()} chips · Paid <b className={signedValueClass(-row.paid)}>{money(row.paid)}</b>
              {" · Gets "}<b className={signedValueClass(row.payout)}>{money(row.payout)}</b>
            </span>
            {row.cashOutPaid !== undefined && <>
              <br />
              <span className="field-help">
                Already paid <b className={signedValueClass(row.cashOutPaid)}>{money(row.cashOutPaid)}</b>
                {" · Still due "}<b className={signedValueClass(row.payout - row.cashOutPaid)}>{money(row.payout - row.cashOutPaid)}</b>
              </span>
            </>}
          </div>
          <strong className={signedValueClass(row.profit)}>
            {net(row.profit)}
          </strong>
        </div>
      ))}
      {paidEarly === 0 && <div className="home-cash-transfers">
        <label className="home-cash-transfer-toggle">
          <input type="checkbox" checked={showTransfers} onChange={(event) => {
            setShowTransfers(event.target.checked);
            setCopyStatus(null);
          }} />
          Show suggested transfers
        </label>
        {showTransfers && (
          <>
            <p className="field-help">Use these amounts when players settle directly with each other at the end of the game.</p>
            {transferLines?.length ? (
              <ul>
                {transferLines.map((line, index) => <li key={index}>{line}</li>)}
              </ul>
            ) : (
              <p>{transferLines ? "Everyone broke even. No transfers are needed." : "The game balances do not add up. Transfers are unavailable."}</p>
            )}
          </>
        )}
      </div>}
      <button className="secondary-button" onClick={() => void copy()}>Copy results</button>
      {copyStatus === "copied" && <p className="field-help" role="status">Copied. Paste the results into WhatsApp or another chat.</p>}
      {copyStatus === "manual" && (
        <label className="field-label">Select and copy the results below
          <textarea dir="rtl" lang="he" className="home-cash-share" readOnly value={summary} rows={6} onFocus={(event) => event.currentTarget.select()} />
        </label>
      )}
    </section>
  );
}

export function HomeCashHistory() {
  const [page, setPage] = useState<HistoryPage>();
  const [selected, setSelected] = useState<ClosedGame>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  const detail = useRef<HTMLDivElement>(null);

  const fetchHistory = useCallback(async (before?: string, gameId?: string) => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      if (gameId) {
        const data = await apiClient.request(`/home-cash/history/${encodeURIComponent(gameId)}`,
          { signal: controller.signal }) as { game: ClosedGame };
        if (!controller.signal.aborted) setSelected(data.game);
      } else {
        const query = before ? `?before=${encodeURIComponent(before)}` : "";
        const data = await apiClient.request(`/home-cash/history${query}`, { signal: controller.signal }) as HistoryPage;
        if (!controller.signal.aborted) {
          setPage((previous) => ({
            games: before ? [...(previous?.games ?? []), ...data.games] : data.games,
            next: data.next,
          }));
        }
      }
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchHistory();
    return () => request.current?.abort();
  }, [fetchHistory]);

  useEffect(() => {
    if (selected) detail.current?.focus();
  }, [selected]);

  if (selected) {
    return (
      <div className="home-cash" ref={detail} tabIndex={-1}>
        <button className="text-button" onClick={() => setSelected(undefined)}>Back to closed games</button>
        <HomeCashResults key={selected.id} {...selected} />
      </div>
    );
  }

  const next = page?.next;
  return (
    <section className="home-cash-panel" aria-label="Closed games">
      <h2>Closed games</h2>
      {loading && <LoadingIndicator label="Loading game history…" compact />}
      {error && <p className="validation-note" role="alert">Could not load the game history. Try again.</p>}
      {!page && error && <button className="secondary-button" onClick={() => void fetchHistory()}>Retry</button>}
      {page?.games.length === 0 && <p className="field-help">Results appear here after you close a game.</p>}
      {page?.games.map((game) => (
        <div className="home-cash-player" key={game.id}>
          <div>
            <strong>{game.name}</strong><br />
            <span className="field-help">{dateLabel(game.closedAt)} · {money(game.collected)} in buy-ins</span>
          </div>
          <button className="secondary-button" aria-label={`View results for ${game.name}`} disabled={loading}
            onClick={() => void fetchHistory(undefined, game.id)}>
            View results
          </button>
        </div>
      ))}
      {next && <button className="text-button" disabled={loading}
        onClick={() => void fetchHistory(next)}>Load older games</button>}
    </section>
  );
}
