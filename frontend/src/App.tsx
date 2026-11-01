import { LoadingIndicator, PageTransition } from "./components/LoadingIndicator";
import { feedbackFetch as fetch } from "./lib/loading";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { replayBetting } from "./lib/betting";
import type { BettingAction } from "./lib/betting";
import { buildHandSetup } from "./lib/handSetup";
import { CardPicker } from "./components/CardPicker";
import { PokerTable } from "./components/PokerTable";
import {
  formatChips,
  handSize,
  makeSeat,
  validateSetup,
  validateSpot,
} from "./lib/poker";
import type {
  Calculation,
  CalculationMethod,
  TournamentSettings,
  RangeConfig,
  RangeDraft,
  GameMode,
  GameType,
  SavedSpot,
  Seat,
} from "./lib/poker";
import { AccountPanel, useAuth } from "./components/AuthProvider";
import "./App.css";

import { PAGES, usePage } from "./lib/navigation";
import {
  createIcmWorkspace,
  createTournamentDraft,
} from "./lib/workspaceState";
const RangeEditor = lazy(() =>
  import("./components/RangeEditor").then((module) => ({
    default: module.RangeEditor,
  })),
);
const RangesWorkspace = lazy(() =>
  import("./components/RangesWorkspace").then((module) => ({
    default: module.RangesWorkspace,
  })),
);
const IcmPanel = lazy(() =>
  import("./components/IcmPanel").then((module) => ({
    default: module.IcmPanel,
  })),
);
const TournamentSettingsPanel = lazy(() =>
  import("./components/TournamentSettingsPanel").then((module) => ({
    default: module.TournamentSettingsPanel,
  })),
);
const OutcomePanel = lazy(() =>
  import("./components/OutcomePanel").then((module) => ({
    default: module.OutcomePanel,
  })),
);
const BettingPanel = lazy(() =>
  import("./components/BettingPanel").then((module) => ({
    default: module.BettingPanel,
  })),
);
const HandSetupPanel = lazy(() =>
  import("./components/HandSetupPanel").then((module) => ({
    default: module.HandSetupPanel,
  })),
);

const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
type PickerTarget = { kind: "seat"; id: number } | { kind: "board" };

function App() {
  const auth = useAuth();
  const { page, navigate } = usePage();
  const pageInfo = PAGES.find((item) => item.id === page)!;
  const hasTable = ["spot", "hand", "analysis"].includes(page);
  const [icmWorkspace, setIcmWorkspace] = useState(createIcmWorkspace);
  const [tournamentDraft, setTournamentDraft] = useState(createTournamentDraft);
  const [rangeDrafts, setRangeDrafts] = useState<Record<number, RangeDraft>>(
    {},
  );
  const [rangeSeatId, setRangeSeatId] = useState(0);
  const [betAmount, setBetAmount] = useState("");
  const [calculationMethod, setCalculationMethod] =
    useState<CalculationMethod>("auto");
  const [chipUnit, setChipUnit] = useState("0.01");
  const [tournament, setTournament] = useState<TournamentSettings | null>(null);
  const [tournamentDraftDirty, setTournamentDraftDirty] = useState(false);
  const [gameType, setGameType] = useState<GameType>("holdem");
  const [gameMode, setGameMode] = useState<GameMode>("cash");
  const [seats, setSeats] = useState<Seat[]>([
    makeSeat(0, "holdem"),
    makeSeat(4, "holdem"),
  ]);
  const [handActions, setHandActions] = useState<BettingAction[] | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [board, setBoard] = useState<(string | null)[]>(Array(5).fill(null));
  const [heroSeatId, setHeroSeatId] = useState(0);
  const [dealerSeatId, setDealerSeatId] = useState(0);
  const [smallBlind, setSmallBlind] = useState("1");
  const [bigBlind, setBigBlind] = useState("2");
  const [potSize, setPotSize] = useState("100");
  const [callAmount, setCallAmount] = useState("0");
  const [picker, setPicker] = useState<PickerTarget | null>(null);
  const [activeCard, setActiveCard] = useState(0);
  const [storedResults, setResults] = useState<Calculation | null>(null);
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "queued" | "loading" | "ready" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [savedSpots, setSavedSpots] = useState<SavedSpot[]>([]);
  const [historyError, setHistoryError] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  const autoTimer = useRef<ReturnType<typeof setTimeout>>();

  const derivedSetup = useMemo(() => {
    try {
      return {
        setup: buildHandSetup(
          seats.map((seat) => ({
            id: seat.id,
            startingStack: Number(seat.startingStack),
          })),
          dealerSeatId,
          Number(smallBlind),
          Number(bigBlind),
        ),
        error: null,
      };
    } catch (error) {
      return {
        setup: null,
        error: error instanceof Error ? error.message : "Invalid hand setup.",
      };
    }
  }, [seats, dealerSeatId, smallBlind, bigBlind]);
  const setupIssue = validateSetup(seats, bigBlind) || derivedSetup.error;
  const ledgerConfig = useMemo(
    () => ({
      seats: seats.map((seat) => ({
        id: seat.id,
        startingStack: Number(seat.startingStack),
      })),
      dealerSeatId,
      smallBlind: Number(smallBlind),
      bigBlind: Number(bigBlind),
      gameType,
    }),
    [seats, dealerSeatId, smallBlind, bigBlind, gameType],
  );
  const ledger = useMemo(() => {
    if (handActions === null) return { state: null, error: null };
    try {
      return {
        state: replayBetting(
          ledgerConfig,
          handActions,
          Math.max(
            [0, 3, 4, 5][
              handActions.filter((action) => action.type === "advance").length
            ] || 0,
            [0, 3, 4, 5].includes(board.filter(Boolean).length)
              ? board.filter(Boolean).length
              : 0,
          ),
        ),
        error: null,
      };
    } catch (error) {
      return {
        state: null,
        error:
          error instanceof Error ? error.message : "Invalid betting history.",
      };
    }
  }, [ledgerConfig, handActions, board]);
  const actualPot = ledger.state?.pot ?? Number(potSize);
  const actualCall =
    ledger.state?.legal?.toCall ??
    (handActions !== null ? 0 : Number(callAmount));
  const tournamentIssue =
    gameMode !== "tournament"
      ? null
      : tournamentDraftDirty
        ? "Apply tournament settings or select Use Chip EV only before continuing."
        : tournament &&
            JSON.stringify(tournament.tableSeats) !==
              JSON.stringify(
                seats.map((seat) => ({
                  seatId: seat.id,
                  startingStack: Number(seat.startingStack),
                })),
              )
          ? "Table seats or starting stacks changed. Reapply tournament settings."
          : null;
  const issue =
    tournamentIssue ||
    validateSpot(
      seats,
      board,
      gameType,
      handActions !== null ? String(actualPot) : potSize,
      handActions !== null ? String(actualCall) : callAmount,
    ) ||
    (handActions !== null
      ? setupIssue ||
        ledger.error ||
        (ledger.state?.requiredBoardCount !== board.filter(Boolean).length
          ? "Advance the betting street after choosing its board cards."
          : null)
      : null);
  // Stacks and names do not affect showdown equity and must not restart simulations.
  const payloadKey = JSON.stringify({
    playerInputs: seats.map((seat) =>
      seat.mode === "range"
        ? {
            type: "range",
            range: seat.range,
            ...(seat.actionRanges !== undefined
              ? { actionRanges: seat.actionRanges }
              : {}),
            ...(seat.rangeAction !== undefined
              ? { rangeAction: seat.rangeAction }
              : {}),
          }
        : { type: "hand", cards: seat.cards },
    ),
    board: board.filter(Boolean),
    gameType,
    gameMode,
    calculationMethod,
    ...(gameMode === "tournament" && tournament ? { tournament } : {}),
    chipUnit: Number(chipUnit),
    ...(handActions !== null
      ? { analysisContext: { ledgerConfig, heroSeatId } }
      : {}),
    potSize: actualPot,
    callAmount: actualCall,
    ...(handActions !== null ? { bettingRevision: handActions } : {}),
  });
  const results = resultKey === payloadKey && !issue ? storedResults : null;
  const usedCards = useMemo(
    () =>
      new Set(
        [
          ...seats
            .filter((seat) => seat.mode === "hand")
            .flatMap((seat) => seat.cards),
          ...board,
        ].filter((card): card is string => !!card),
      ),
    [seats, board],
  );
  const currentSeat =
    picker?.kind === "seat"
      ? seats.find((seat) => seat.id === picker.id)
      : undefined;
  const pickerCards =
    picker?.kind === "board" ? board : currentSeat?.cards || [];
  const busy = status === "loading" || status === "queued";

  const historyRequest = useRef<AbortController | null>(null);
  useEffect(() => () => historyRequest.current?.abort(), []);
  async function fetchSavedSpots() {
    historyRequest.current?.abort();
    const request = new AbortController();
    historyRequest.current = request;
    setHistoryLoading(true);
    try {
      const response = await fetch(`${API}/spots`, { signal: request.signal });
      const data = await response.json();
      if (!response.ok || !data.success || !Array.isArray(data.spots))
        throw new Error("History unavailable");
      if (request.signal.aborted) return;
      setSavedSpots(data.spots);
      setHistoryError(false);
    } catch {
      if (!request.signal.aborted) setHistoryError(true);
    } finally {
      if (!request.signal.aborted) setHistoryLoading(false);
    }
  }
  const historyRequested = useRef(false);
  useEffect(() => {
    if (page === "history" && !historyRequested.current) {
      historyRequested.current = true;
      void fetchSavedSpots();
    }
  }, [page]);
  useEffect(() => {
    setPicker(null);
    document.title = `${pageInfo.label} · River Poker Lab`;
    window.scrollTo(0, 0);
    document
      .querySelector<HTMLElement>("#main-content")
      ?.focus({ preventScroll: true });
  }, [page, pageInfo.label]);

  async function calculate(
    iterations: number,
    saveSpot = false,
    includeDecisionAnalysis = false,
  ) {
    if (issue || (saveSpot && setupIssue)) return;
    clearTimeout(autoTimer.current);
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const run = ++sequence.current;
    setStatus("loading");
    setError(null);
    setSaving(saveSpot);
    setResults(null);
    const tableState = {
      seats: seats.map((seat) => ({
        ...seat,
        name: seat.name.trim(),
        stack: Number(seat.stack),
        startingStack: Number(seat.startingStack),
        cards: seat.mode === "range" ? [] : seat.cards,
      })),
      heroSeatId,
      bigBlind: Number(bigBlind),
      handSetup: { dealerSeatId, smallBlind: Number(smallBlind) },
      ...(handActions !== null ? { betting: { actions: handActions } } : {}),
    };
    try {
      const { bettingRevision, analysisContext, ...calculationInput } =
        JSON.parse(payloadKey);
      const response = await fetch(`${API}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          ...calculationInput,
          iterations,
          saveSpot,
          includeDecisionAnalysis,
          ...(saveSpot ||
          handActions !== null ||
          (gameMode === "tournament" && tournament)
            ? { tableState }
            : {}),
        }),
      });
      const data: Calculation = await response.json();
      if (run !== sequence.current || controller.signal.aborted) return;
      if (!response.ok || !data.success)
        throw new Error(data.error || "Calculation failed.");
      setResultKey(payloadKey);
      setResults(data);
      setStatus("ready");
      if (saveSpot) {
        setNotice("Spot saved with player stacks and table setup.");
        void fetchSavedSpots();
      }
    } catch (caught) {
      if (run !== sequence.current || controller.signal.aborted) return;
      setError(
        caught instanceof Error
          ? caught.message
          : "Cannot reach the backend. Check that the server is running.",
      );
      setStatus("error");
    } finally {
      if (run === sequence.current) setSaving(false);
    }
  }

  useEffect(() => {
    requestRef.current?.abort();
    ++sequence.current;
    setResults(null);
    setError(null);
    setSaving(false);
    if (issue) {
      setStatus("idle");
      return;
    }
    setStatus("queued");
    autoTimer.current = setTimeout(() => {
      void calculate(1000);
    }, 600);
    return () => {
      clearTimeout(autoTimer.current);
      requestRef.current?.abort();
      ++sequence.current;
    };
    // Requests are keyed to calculation inputs; metadata edits stay local until saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payloadKey, issue]);

  function editSeat(id: number) {
    const seat = seats.find((item) => item.id === id);
    if (!seat) {
      if (handActions !== null) {
        setNotice("Exit the hand builder before adding seats.");
        return;
      }
      if (seats.length >= 9) return;
      setSeats((previous) =>
        [...previous, makeSeat(id, gameType)].sort((a, b) => a.id - b.id),
      );
    }
    const next = seat?.cards.findIndex((card) => !card) ?? 0;
    setActiveCard(next < 0 ? 0 : next);
    setPicker({ kind: "seat", id });
  }
  function updateSeat(id: number, changes: Partial<Seat>) {
    setSeats((previous) =>
      previous.map((seat) => (seat.id === id ? { ...seat, ...changes } : seat)),
    );
    setNotice(null);
  }
  function changeSeatMode(id: number, mode: "hand" | "range") {
    if (mode === "range" && gameType !== "holdem") return;
    updateSeat(id, { mode, cards: Array(handSize(gameType)).fill(null) });
    setActiveCard(0);
  }
  function removeSeat(id: number) {
    if (handActions !== null) {
      setNotice("Exit the hand builder before removing seats.");
      return;
    }
    if (seats.length <= 2) return;
    const remaining = seats.filter((seat) => seat.id !== id);
    setSeats(remaining);
    if (heroSeatId === id) setHeroSeatId(remaining[0].id);
    if (dealerSeatId === id)
      setDealerSeatId(
        [...remaining].sort((a, b) => a.id - b.id).find((seat) => seat.id > id)
          ?.id ?? Math.min(...remaining.map((seat) => seat.id)),
      );
    setPicker(null);
    setNotice(null);
  }
  function pickCard(card: string | null) {
    if (
      !picker ||
      (card && usedCards.has(card) && pickerCards[activeCard] !== card)
    )
      return;
    setNotice(null);
    if (picker.kind === "board" && handActions !== null && ledger.state) {
      const maximum =
        ledger.state.roundClosed && ledger.state.status === "playing"
          ? (ledger.state.nextBoardCount ?? ledger.state.requiredBoardCount)
          : ledger.state.requiredBoardCount;
      if (activeCard >= maximum) {
        setNotice(
          "Finish the current street before choosing more board cards.",
        );
        return;
      }
    }
    const cards = [...pickerCards];
    cards[activeCard] = card;
    if (picker.kind === "board") setBoard(cards);
    else updateSeat(picker.id, { cards });
    if (card) {
      const limit =
        picker.kind === "board" && handActions !== null && ledger.state
          ? ledger.state.status === "playing" && ledger.state.roundClosed
            ? (ledger.state.nextBoardCount ?? ledger.state.requiredBoardCount)
            : ledger.state.requiredBoardCount
          : cards.length;
      const later = cards.findIndex(
        (value, index) => index > activeCard && index < limit && !value,
      );
      const earlier = cards.findIndex(
        (value, index) => index < limit && !value,
      );
      if (later !== -1 || earlier !== -1)
        setActiveCard(later !== -1 ? later : earlier);
    }
  }
  function changeGame(type: GameType) {
    if (type === gameType) return;
    if (handActions !== null) {
      setNotice("Exit the hand builder before changing game type.");
      return;
    }
    setNotice(null);
    setRangeDrafts({});
    setGameType(type);
    setSeats((previous) =>
      previous.map((seat) => ({
        ...seat,
        cards: Array(handSize(type)).fill(null),
        mode: "hand",
        range: "",
        actionRanges: undefined,
        rangeAction: undefined,
      })),
    );
    setPicker(null);
  }
  function loadSpot(spot: SavedSpot) {
    setRangeDrafts({});
    setBetAmount("");
    setHandActions(null);
    setActionError(null);
    if (
      !["holdem", "omaha"].includes(spot.gameType) ||
      !Array.isArray(spot.players) ||
      spot.players.length < 2 ||
      spot.players.length > 9
    ) {
      setNotice("This saved spot has an unsupported format.");
      return;
    }
    const metadata = spot.tableState;
    setHandActions(metadata?.betting?.actions ?? null);
    const inputs =
      spot.playerInputs ||
      spot.players.map((cards) => ({ type: "hand" as const, cards }));
    const restored: Seat[] = inputs.map((input, index) => {
      const saved = metadata?.seats?.[index];
      return {
        ...makeSeat(saved?.id ?? index, spot.gameType),
        name: saved?.name || `Player ${index + 1}`,
        stack: String(saved?.stack ?? 200),
        startingStack: String(
          saved?.startingStack ??
            (saved?.stack && saved.stack > 0 ? saved.stack : 200),
        ),
        mode: input.type === "range" ? "range" : "hand",
        range: input.type === "range" ? input.range : "",
        ...(input.type === "range"
          ? { actionRanges: input.actionRanges, rangeAction: input.rangeAction }
          : {}),
        cards:
          input.type === "hand"
            ? [...input.cards]
            : Array(handSize(spot.gameType)).fill(null),
      };
    });
    setCalculationMethod(spot.calculationMethod ?? "monteCarlo");
    setChipUnit(String(spot.chipUnit ?? 0.01));
    applyTournament(spot.tournament ?? null);
    setTournamentDraftDirty(false);
    setGameType(spot.gameType);
    setGameMode(spot.gameMode === "tournament" ? "tournament" : "cash");
    setSeats(restored);
    setHeroSeatId(metadata?.heroSeatId ?? restored[0].id);
    setBigBlind(String(metadata?.bigBlind ?? 2));
    setSmallBlind(
      String(metadata?.handSetup?.smallBlind ?? (metadata?.bigBlind ?? 2) / 2),
    );
    setDealerSeatId(metadata?.handSetup?.dealerSeatId ?? restored[0].id);
    setBoard(
      Array.from({ length: 5 }, (_, index) => spot.board[index] || null),
    );
    setPotSize(String(spot.potSize));
    setCallAmount(String(spot.callAmount));
    setPicker(null);
    navigate("spot");
    setNotice(
      metadata?.handSetup
        ? "Saved table and hand setup restored."
        : metadata
          ? "Legacy table loaded. Dealer, small blind and starting stacks were inferred; review hand setup."
          : "Legacy spot loaded. Stacks default to 200 and big blind to 2. Dealer defaults to the first occupied seat; review hand setup.",
    );
  }
  function applyTournament(settings: TournamentSettings | null) {
    setTournament(settings);
    setTournamentDraft({
      payoutText: settings?.payouts.join(", ") ?? "",
      others:
        settings?.otherPlayers.map((player) => ({
          ...player,
          stack: String(player.stack),
        })) ?? [],
      confirmed: !!settings,
    });
    setTournamentDraftDirty(false);
  }
  function resetSpot() {
    setRangeDrafts({});
    setBetAmount("");
    applyTournament(null);
    setTournamentDraftDirty(false);
    setHandActions(null);
    setActionError(null);
    setSeats([makeSeat(0, gameType), makeSeat(4, gameType)]);
    setBoard(Array(5).fill(null));
    setHeroSeatId(0);
    setBigBlind("2");
    setSmallBlind("1");
    setDealerSeatId(0);
    setPotSize("100");
    setCallAmount("0");
    setPicker(null);
    setNotice(null);
  }

  function recordAction(action: BettingAction) {
    if (handActions === null) return;
    try {
      const next = [...handActions, action];
      replayBetting(ledgerConfig, next, board.filter(Boolean).length);
      setHandActions(next);
      setActionError(null);
      setNotice(null);
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "Invalid action.",
      );
    }
  }
  function undoAction() {
    if (!handActions?.length) return;
    const next = handActions.slice(0, -1);
    try {
      const previous = replayBetting(
        ledgerConfig,
        next,
        board.filter(Boolean).length,
      );
      setBoard((old) =>
        old.map((card, index) =>
          index < previous.requiredBoardCount ? card : null,
        ),
      );
      setHandActions(next);
      setActionError(null);
    } catch (error) {
      setActionError(String(error));
    }
  }
  function openBoard(index: number) {
    const state = ledger.state;
    if (handActions !== null && state) {
      const maximum =
        state.status === "playing" && state.roundClosed
          ? (state.nextBoardCount ?? state.requiredBoardCount)
          : state.requiredBoardCount;
      if (index >= maximum) {
        setNotice("Finish the betting round before selecting the next street.");
        return;
      }
    }
    setPicker({ kind: "board" });
    setActiveCard(index);
  }
  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#/spot" aria-label="River Poker Lab home">
          <span className="brand-mark">♠</span>
          <span>
            RIVER<small>POKER LAB</small>
          </span>
        </a>
        <div className="topbar-right">
          <a className="account-link" href="#/account">
            {auth.user?.username}
          </a>
          <span className="workspace-tag">EQUITY WORKSPACE</span>
          <span className="build-badge">BETA</span>
        </div>
      </header>
      <nav className="main-navigation" aria-label="Main navigation">
        {PAGES.map((item) => (
          <a
            key={item.id}
            href={`#/${item.id}`}
            aria-current={page === item.id ? "page" : undefined}
          >
            {item.label}
          </a>
        ))}
      </nav>
      <main
        id="main-content"
        tabIndex={-1}
        className={`workspace ${hasTable ? "" : "standalone-workspace"}`}
      >
        {!hasTable && (
          <div className="workspace-heading page-heading">
            <div>
              <span className="eyebrow">RIVER POKER LAB</span>
              <h1>{pageInfo.label}</h1>
              <p>{pageInfo.description}</p>
            </div>
          </div>
        )}
        {hasTable && (
          <section
            className="table-workspace"
            aria-label="Poker table workspace"
          >
            <div className="workspace-heading">
              <div>
                <span className="eyebrow">BUILD. EXPLORE. UNDERSTAND.</span>
                <h1>{pageInfo.label}</h1>
                <p>{pageInfo.description}</p>
              </div>
              <button
                className="secondary-button reset-button"
                onClick={resetSpot}
              >
                ↺ <span>New spot</span>
              </button>
            </div>
            <div className="table-toolbar">
              <div className="segmented-control" aria-label="Game type">
                <button
                  aria-pressed={gameType === "holdem"}
                  className={gameType === "holdem" ? "active" : ""}
                  onClick={() => changeGame("holdem")}
                >
                  Hold’em
                </button>
                <button
                  aria-pressed={gameType === "omaha"}
                  className={gameType === "omaha" ? "active" : ""}
                  onClick={() => changeGame("omaha")}
                >
                  Omaha
                </button>
              </div>
              <div className="toolbar-meta">
                <span>{seats.length}/9 players</span>
                <span className="metadata-divider" />
                <span>
                  {gameMode === "cash" ? "Cash game" : "Tournament · Chip EV"}
                </span>
              </div>
            </div>
            <p className="game-switch-note">
              Changing the game clears hands and ranges. Tap any seat to edit or
              add a player.
            </p>
            <PokerTable
              seats={seats.map((seat) => ({
                ...seat,
                stack:
                  handActions !== null
                    ? String(
                        (["final", "uncontested"].includes(
                          results?.payoutSummary?.kind ?? "",
                        )
                          ? results?.payoutSummary?.endingStacks?.find(
                              (item) => item.seatId === seat.id,
                            )?.stack
                          : undefined) ??
                          ledger.state?.players.find(
                            (player) => player.seatId === seat.id,
                          )?.remaining ??
                          seat.startingStack,
                      )
                    : seat.startingStack,
              }))}
              handSetup={derivedSetup.setup}
              bettingState={ledger.state}
              board={board}
              gameType={gameType}
              heroSeatId={heroSeatId}
              bigBlind={Number(bigBlind)}
              potSize={actualPot}
              results={results?.results || null}
              loading={busy}
              onSeat={editSeat}
              onBoard={openBoard}
            />
            <div className="table-bottom-bar">
              <span>
                <b className="hero-key">H</b> Hero{" "}
                <span className="legend-dot" /> Tap cards to edit
              </span>
              <button
                className="text-button"
                disabled={handActions !== null || !board.some(Boolean)}
                onClick={() => setBoard(Array(5).fill(null))}
              >
                Clear board
              </button>
            </div>
            <div
              className={`calculation-status ${status === "error" ? "status-error" : ""}`}
              role="status"
              aria-live="polite"
            >
              <span
                className={`status-indicator ${busy ? "is-working" : ""}`}
              />
              <div>
                <strong>
                  {status === "error"
                    ? "Calculation unavailable"
                    : busy
                      ? "Calculating equity…"
                      : results
                        ? "Equity is up to date"
                        : "Build your spot"}
                </strong>
                <span>
                  {error ||
                    (results
                      ? `${results.method === "exact" ? "Exact enumeration" : "Monte Carlo estimate"} · ${formatChips(results.samples ?? results.iterations)} ${results.method === "exact" ? "legal states" : "samples"} · Split pots included`
                      : issue || "Preparing simulation…")}
                </span>
              </div>
              {results && <span className="auto-label">AUTO</span>}
            </div>
          </section>
        )}
        <aside className="sidebar" aria-label={`${pageInfo.label} controls`}>
          <PageTransition view={page} label={pageInfo.label}>
          <Suspense
            fallback={
              <LoadingIndicator label="Loading view…" />
            }
          >
            {page === "spot" && (
              <>
                <section className="sidebar-section">
                  <div className="section-heading">
                    <h2>Table settings</h2>
                    <span>01</span>
                  </div>
                  <label className="field-label" htmlFor="game-mode">
                    GAME MODE
                  </label>
                  <select
                    id="game-mode"
                    disabled={handActions !== null}
                    value={gameMode}
                    onChange={(event) =>
                      setGameMode(event.target.value as GameMode)
                    }
                  >
                    <option value="cash">Cash game</option>
                    <option value="tournament">
                      Tournament · ICM calculator
                    </option>
                  </select>
                  <div className="field-pair">
                    <label className="field-label">
                      DEALER / BUTTON
                      <select
                        aria-label="Dealer / Button"
                        disabled={handActions !== null}
                        value={dealerSeatId}
                        onChange={(event) => {
                          setDealerSeatId(Number(event.target.value));
                          setNotice(null);
                        }}
                      >
                        {seats.map((seat) => (
                          <option key={seat.id} value={seat.id}>
                            {seat.name || `Seat ${seat.id + 1}`}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field-label">
                      SMALL BLIND
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={handActions !== null}
                        value={smallBlind}
                        onChange={(event) => {
                          setSmallBlind(event.target.value);
                          setNotice(null);
                        }}
                      />
                    </label>
                  </div>
                  <button
                    className="text-button"
                    disabled={handActions !== null}
                    onClick={() => {
                      const next =
                        [...seats]
                          .sort((a, b) => a.id - b.id)
                          .find((seat) => seat.id > dealerSeatId)?.id ??
                        seats[0].id;
                      setDealerSeatId(next);
                      setNotice(null);
                    }}
                  >
                    Move button clockwise →
                  </button>
                  <div className="field-pair">
                    <label className="field-label">
                      BIG BLIND
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        disabled={handActions !== null}
                        value={bigBlind}
                        onChange={(event) => {
                          setBigBlind(event.target.value);
                          setNotice(null);
                        }}
                      />
                    </label>
                    <label className="field-label">
                      CURRENT POT
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={handActions !== null}
                        value={
                          handActions !== null ? String(actualPot) : potSize
                        }
                        onChange={(event) => setPotSize(event.target.value)}
                      />
                    </label>
                  </div>
                  <p className="field-help">
                    {handActions !== null
                      ? "Table stacks show chips behind after recorded actions. Pot and call amounts follow the action history."
                      : "Table stacks show starting chips before posting blinds. Depth is shown in BB. The current pot remains manually entered."}
                  </p>
                  {gameMode === "tournament" && (
                    <div className="inline-note">
                      Hand equity percentages are chip-based. Apply tournament
                      settings for ICM decisions; both Fold and Call branches
                      must close all remaining betting.
                    </div>
                  )}
                </section>
                <section className="sidebar-section">
                  <div className="section-heading">
                    <h2>Players</h2>
                    <span>{String(seats.length).padStart(2, "0")}</span>
                  </div>
                  <div className="player-list">
                    {seats.map((seat, index) => {
                      const result = results?.results.find(
                        (item) => item.playerIndex === index,
                      );
                      return (
                        <button
                          key={seat.id}
                          className="player-row"
                          onClick={() => editSeat(seat.id)}
                        >
                          <span
                            className={`player-avatar ${heroSeatId === seat.id ? "hero-avatar" : ""}`}
                          >
                            {heroSeatId === seat.id ? "H" : seat.id + 1}
                          </span>
                          <span className="player-row-name">
                            <strong>
                              {seat.name || `Seat ${seat.id + 1}`}
                            </strong>
                            <small>
                              {seat.mode === "range"
                                ? seat.range || "Choose range"
                                : seat.cards.filter(Boolean).join(" · ") ||
                                  "Choose cards"}
                            </small>
                          </span>
                          <span className="player-row-equity">
                            {result ? `${result.equity.toFixed(1)}%` : "—"}
                            <small>
                              {seat.startingStack.trim() &&
                              Number.isFinite(Number(seat.startingStack))
                                ? formatChips(Number(seat.startingStack))
                                : "—"}{" "}
                              starting chips
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <button
                    className="add-player-button"
                    disabled={handActions !== null || seats.length >= 9}
                    onClick={() => {
                      const empty = Array.from(
                        { length: 9 },
                        (_, index) => index,
                      ).find((id) => !seats.some((seat) => seat.id === id));
                      if (empty !== undefined) editSeat(empty);
                    }}
                  >
                    + Add player
                  </button>
                </section>
                <div className="sidebar-section route-shortcuts">
                  <a className="primary-button" href="#/hand">
                    Record hand actions →
                  </a>
                  <a className="secondary-button" href="#/analysis">
                    Open analysis →
                  </a>
                </div>
              </>
            )}
            {page === "hand" && (
              <>
                <BettingPanel
                  amount={betAmount}
                  setAmount={setBetAmount}
                  seats={seats}
                  active={handActions !== null}
                  state={ledger.state}
                  error={actionError || ledger.error}
                  setupError={setupIssue}
                  actionCount={handActions?.length || 0}
                  boardCount={board.filter(Boolean).length}
                  gameType={gameType}
                  onStart={() => {
                    try {
                      replayBetting(ledgerConfig, [], 0);
                      setBetAmount("");
                      setHandActions([]);
                      setBoard(Array(5).fill(null));
                      setActionError(null);
                    } catch (error) {
                      setActionError(String(error));
                      setNotice(
                        error instanceof Error
                          ? error.message
                          : "Invalid setup.",
                      );
                    }
                  }}
                  onExit={() => {
                    if (ledger.state) {
                      setPotSize(String(ledger.state.pot));
                      setCallAmount(String(ledger.state.legal?.toCall || 0));
                    }
                    setHandActions(null);
                    setActionError(null);
                    setNotice(
                      "Exited builder. All seats participate in free equity mode again.",
                    );
                  }}
                  onAction={recordAction}
                  onUndo={undoAction}
                  onChooseBoard={() =>
                    openBoard(ledger.state?.requiredBoardCount || 0)
                  }
                />
                {handActions === null && (
                  <>
                    <HandSetupPanel
                      seats={seats}
                      setup={derivedSetup.setup}
                      error={derivedSetup.error}
                      onUsePot={() => {
                        if (derivedSetup.setup) {
                          setPotSize(String(derivedSetup.setup.initialPot));
                          setCallAmount("0");
                          setNotice(
                            "Manual pot replaced with posted blinds. No betting actions have been recorded.",
                          );
                        }
                      }}
                    />
                  </>
                )}
                <div className="sidebar-section route-shortcuts">
                  <a className="secondary-button" href="#/spot">
                    Edit spot setup
                  </a>
                  <a className="primary-button" href="#/analysis">
                    Analyze this hand →
                  </a>
                </div>
              </>
            )}
            {page === "analysis" && (
              <>
                <section className="sidebar-section analysis-section">
                  <div className="section-heading">
                    <h2>Equity analysis</h2>
                    <span>↗</span>
                  </div>
                  <p>
                    Equity updates automatically when every player has a
                    complete hand or a valid Hold’em range and the board is
                    valid.
                  </p>
                  <div className="analysis-settings">
                    <label className="field-label">
                      CALCULATION METHOD
                      <select
                        aria-label="CALCULATION METHOD"
                        value={calculationMethod}
                        onChange={(event) =>
                          setCalculationMethod(
                            event.target.value as CalculationMethod,
                          )
                        }
                      >
                        <option value="auto">
                          Auto · Exact when manageable
                        </option>
                        <option value="exact">
                          Exact · Exhaustive enumeration
                        </option>
                        <option value="monteCarlo">Monte Carlo</option>
                      </select>
                    </label>
                    <label className="field-label">
                      SMALLEST CHIP
                      <select
                        aria-label="SMALLEST CHIP"
                        value={chipUnit}
                        onChange={(event) => setChipUnit(event.target.value)}
                      >
                        <option value="0.01">0.01</option>
                        <option value="0.1">0.10</option>
                        <option value="0.5">0.50</option>
                        <option value="1">1</option>
                      </select>
                    </label>
                  </div>
                  {results?.enumeration && !results.enumeration.available && (
                    <p className="field-help">
                      Auto used Monte Carlo: {results.enumeration.reason}
                    </p>
                  )}
                  {!!results?.rangeStats?.length && (
                    <div className="range-diagnostics">
                      {results.rangeStats.map((stat) => (
                        <p key={stat.playerIndex}>
                          <strong>{seats[stat.playerIndex]?.name}</strong>:{" "}
                          {stat.availableCombos}/{stat.totalCombos} combos after
                          known-card blockers
                        </p>
                      ))}
                    </div>
                  )}
                  <button
                    className="primary-button full-width"
                    disabled={!!issue || busy}
                    onClick={() => {
                      void calculate(5000);
                    }}
                  >
                    {busy
                      ? "Calculating…"
                      : calculationMethod === "exact"
                        ? "Recalculate exact"
                        : "Recalculate · up to 5,000 samples"}
                    <span>→</span>
                  </button>
                  <button
                    className="secondary-button full-width save-button"
                    disabled={!!issue || !!setupIssue || busy}
                    onClick={() => {
                      void calculate(5000, true, !!results?.decisionAnalysis);
                    }}
                  >
                    {saving ? "Saving spot…" : "Save spot to history"}
                  </button>
                  {setupIssue && (
                    <p className="field-help validation-note">
                      {setupIssue} Saving is disabled until corrected.
                    </p>
                  )}
                  <OutcomePanel results={results} seats={seats} />
                  <button
                    className="secondary-button full-width"
                    disabled={!!issue || busy || handActions === null}
                    onClick={() => void calculate(5000, false, true)}
                  >
                    Analyze Hero · Fold vs Call
                  </button>
                  <p className="analysis-disclaimer">
                    Chip EV requires Hero's call to close all remaining betting.
                    Tournament ICM additionally requires a closed Fold branch
                    and applied full-field prizes. No rake, bounties, bet/raise
                    strategy is solved automatically. Observed action profiles
                    condition ranges only when explicitly selected.
                  </p>
                  <details className="legacy-controls">
                    <summary>Existing call amount</summary>
                    <label className="field-label">
                      CALL AMOUNT
                      <input
                        type="number"
                        min="0"
                        step="any"
                        disabled={handActions !== null}
                        value={
                          handActions !== null ? String(actualCall) : callAmount
                        }
                        onChange={(event) => setCallAmount(event.target.value)}
                      />
                    </label>
                    <p className="field-help">
                      Preserved for free equity mode and legacy saved spots. Use
                      the hand builder for contribution-aware payouts and
                      closing-call decision EV.
                    </p>
                  </details>
                </section>
                <div className="sidebar-section route-shortcuts">
                  <a className="secondary-button" href="#/hand">
                    Back to hand actions
                  </a>
                  <a className="secondary-button" href="#/tournament">
                    Tournament settings →
                  </a>
                </div>
              </>
            )}
            {page === "tournament" &&
              (gameMode === "tournament" ? (
                <TournamentSettingsPanel
                  api={API}
                  seats={seats}
                  settings={tournament}
                  draft={tournamentDraft}
                  setDraft={setTournamentDraft}
                  onApply={applyTournament}
                  onDirty={setTournamentDraftDirty}
                  issue={tournamentIssue}
                />
              ) : (
                <section className="sidebar-section">
                  <h2>Enable Tournament mode</h2>
                  <p className="field-help">
                    Select Tournament in Spot setup to connect prizes to this
                    hand. Exit an active cash hand first.
                  </p>
                  <a className="primary-button" href="#/spot">
                    Open spot setup →
                  </a>
                  <p className="field-help">
                    The independent ICM calculator is available in any game
                    mode.
                  </p>
                  <a className="text-button" href="#/icm">
                    Open ICM calculator →
                  </a>
                </section>
              ))}
            {page === "ranges" && (
              <RangesWorkspace
                seats={seats}
                gameType={gameType}
                selectedId={rangeSeatId}
                onSelect={setRangeSeatId}
                api={API}
                deadCards={[...usedCards]}
                drafts={rangeDrafts}
                onDraft={(id, draft) =>
                  setRangeDrafts((current) => ({ ...current, [id]: draft }))
                }
                onCommit={(id, config: RangeConfig) => {
                  updateSeat(id, config);
                  setNotice(
                    "Range applied. Calculations use the selected observed-action context.",
                  );
                }}
                onEnable={(id) => changeSeatMode(id, "range")}
                lastActions={Object.fromEntries(
                  (handActions || [])
                    .filter((action) => action.type !== "advance")
                    .map((action) => [action.seatId, action.type]),
                )}
              />
            )}
            {page === "icm" && (
              <IcmPanel
                api={API}
                seats={seats}
                state={icmWorkspace}
                setState={setIcmWorkspace}
              />
            )}
            {page === "account" && <AccountPanel />}
            {page === "history" && (
              <section className="sidebar-section history-section">
                <div className="section-heading">
                  <h2>Saved spots</h2>
                  <button
                    className="text-button"
                    disabled={historyLoading}
                    onClick={() => {
                      void fetchSavedSpots();
                    }}
                  >
                    {historyLoading ? "Loading…" : "Refresh"}
                  </button>
                </div>
                {historyLoading ? (
                  <LoadingIndicator label="Loading saved spots…" />
                ) : historyError ? (
                  <div className="inline-note">
                    Cannot load history. Check that the backend and MongoDB are
                    available, then refresh.
                  </div>
                ) : !savedSpots.length ? (
                  <div className="empty-history">
                    <span>♧</span>
                    <h3>No saved spots yet</h3>
                    <p>
                      Complete a spot and save it here to revisit the table
                      later.
                    </p>
                  </div>
                ) : (
                  savedSpots.map((spot) => (
                    <button
                      className="history-card"
                      key={spot._id}
                      onClick={() => loadSpot(spot)}
                    >
                      <div>
                        <strong>
                          {spot.gameType === "omaha" ? "Omaha" : "Hold’em"}
                        </strong>
                        <span>{spot.players.length} players</span>
                      </div>
                      <p>
                        {spot.board.join(" · ") || "Preflop"} <span>→</span>
                      </p>
                      <small>
                        Pot {formatChips(spot.potSize)} ·{" "}
                        {new Date(spot.createdAt).toLocaleString("en-GB")}
                      </small>
                    </button>
                  ))
                )}
              </section>
            )}
          </Suspense>
          </PageTransition>
          {notice && (
            <div className="notice" role="status">
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice(null)}
              >
                ×
              </button>
            </div>
          )}
          <footer className="sidebar-footer">
            <span className="live-dot" /> TEXAS HOLD’EM & OMAHA HIGH
          </footer>
        </aside>
      </main>
      <footer className="app-footer">
        <span>RIVER / POKER LAB</span>
        <span>A clearer view of every hand.</span>
      </footer>
      {picker && (
        <CardPicker
          title={
            picker.kind === "board"
              ? "Community cards"
              : `${currentSeat?.name || "Player"} · Seat ${(currentSeat?.id ?? 0) + 1}`
          }
          cards={pickerCards}
          activeIndex={activeCard}
          maxCards={
            picker.kind === "board" && handActions !== null && ledger.state
              ? ledger.state.status === "playing" && ledger.state.roundClosed
                ? (ledger.state.nextBoardCount ??
                  ledger.state.requiredBoardCount)
                : ledger.state.requiredBoardCount
              : undefined
          }
          usedCards={usedCards}
          onActiveIndex={setActiveCard}
          onPick={pickCard}
          onClose={() => setPicker(null)}
          alternativeContent={
            currentSeat?.mode === "range" ? (
              <Suspense fallback={<LoadingIndicator label="Loading range editor…" />}>
                <RangeEditor
                  key={currentSeat.id}
                  value={currentSeat.range}
                  actionRanges={currentSeat.actionRanges}
                  rangeAction={currentSeat.rangeAction}
                  draftState={rangeDrafts[currentSeat.id]}
                  onDraftChange={(draft) =>
                    setRangeDrafts((current) => ({
                      ...current,
                      [currentSeat.id]: draft,
                    }))
                  }
                  deadCards={[...usedCards]}
                  api={API}
                  onCommit={(config) => {
                    updateSeat(currentSeat.id, config);
                    setPicker(null);
                  }}
                />
              </Suspense>
            ) : undefined
          }
        >
          {currentSeat && (
            <div className="seat-editor">
              {gameType === "holdem" && (
                <div
                  className="segmented-control seat-mode-control"
                  aria-label="Player input type"
                >
                  <button
                    aria-pressed={currentSeat.mode === "hand"}
                    className={currentSeat.mode === "hand" ? "active" : ""}
                    onClick={() =>
                      currentSeat.mode !== "hand" &&
                      changeSeatMode(currentSeat.id, "hand")
                    }
                  >
                    Specific hand
                  </button>
                  <button
                    aria-pressed={currentSeat.mode === "range"}
                    className={currentSeat.mode === "range" ? "active" : ""}
                    onClick={() =>
                      currentSeat.mode !== "range" &&
                      changeSeatMode(currentSeat.id, "range")
                    }
                  >
                    Range
                  </button>
                </div>
              )}
              <div className="field-pair">
                <label className="field-label">
                  PLAYER NAME
                  <input
                    value={currentSeat.name}
                    maxLength={40}
                    onChange={(event) =>
                      updateSeat(currentSeat.id, { name: event.target.value })
                    }
                  />
                </label>
                <label className="field-label">
                  CURRENT STACK · CHIPS
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={handActions !== null}
                    value={
                      handActions !== null
                        ? String(
                            ledger.state?.players.find(
                              (player) => player.seatId === currentSeat.id,
                            )?.remaining ?? currentSeat.stack,
                          )
                        : currentSeat.stack
                    }
                    onChange={(event) =>
                      updateSeat(currentSeat.id, { stack: event.target.value })
                    }
                  />
                </label>
              </div>
              <div className="field-pair">
                <label className="field-label">
                  STARTING STACK · CHIPS
                  <input
                    type="number"
                    min="0"
                    step="any"
                    disabled={handActions !== null}
                    value={currentSeat.startingStack}
                    onChange={(event) =>
                      updateSeat(currentSeat.id, {
                        startingStack: event.target.value,
                      })
                    }
                  />
                </label>
                <div className="dealer-control">
                  <button
                    className="secondary-button full-width"
                    disabled={handActions !== null}
                    aria-pressed={dealerSeatId === currentSeat.id}
                    onClick={() => {
                      setDealerSeatId(currentSeat.id);
                      setNotice(null);
                    }}
                  >
                    {dealerSeatId === currentSeat.id
                      ? "Dealer · Button"
                      : "Set as dealer"}
                  </button>
                  <span>
                    {derivedSetup.setup?.positions.find(
                      (seat) => seat.seatId === currentSeat.id,
                    )?.position || "Review setup"}
                  </span>
                </div>
              </div>
              <p className="field-help">
                Starting stack is before posting blinds. Current stack is the
                chips-behind value from your spot and stays unchanged by this
                preview.
              </p>
              {(currentSeat.startingStack.trim() === "" ||
                !Number.isFinite(Number(currentSeat.startingStack)) ||
                Number(currentSeat.startingStack) <= 0) && (
                <p className="validation-note">
                  Starting stack must be greater than zero.
                </p>
              )}
              <div className="seat-editor-actions">
                <label className="hero-checkbox">
                  <input
                    type="radio"
                    name="hero-player"
                    checked={heroSeatId === currentSeat.id}
                    onChange={() => {
                      setHeroSeatId(currentSeat.id);
                      setNotice(null);
                    }}
                  />
                  Hero player
                </label>
                <button
                  className="text-button danger-text"
                  disabled={handActions !== null || seats.length <= 2}
                  onClick={() => removeSeat(currentSeat.id)}
                >
                  Remove player
                </button>
              </div>
              {(currentSeat.stack.trim() === "" ||
                Number(currentSeat.stack) < 0 ||
                !Number.isFinite(Number(currentSeat.stack))) && (
                <p className="validation-note">
                  Enter a valid, non-negative stack.
                </p>
              )}
            </div>
          )}
          {picker.kind === "board" && (
            <p className="field-help">
              Complete three flop cards before calculating. Add the turn and
              river in order.
            </p>
          )}
        </CardPicker>
      )}
    </div>
  );
}
export default App;
