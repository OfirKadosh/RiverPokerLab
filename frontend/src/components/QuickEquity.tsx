import { useEffect, useRef, useState } from "react";
import { feedbackFetch } from "../lib/loading";
import { handSize, makeSeat, validateCommunityCards, validateSpot } from "../lib/poker";
import type { Calculation, GameType, Seat } from "../lib/poker";
import { Card } from "./Card";
import { CardPicker } from "./CardPicker";
import { LoadingIndicator } from "./LoadingIndicator";
import "./QuickEquity.css";

interface Props {
  active: boolean;
  api: string;
  onOpenAdvanced: (game: GameType, players: Seat[], board: (string | null)[]) => void;
}

const emptyBoard = () => Array<string | null>(5).fill(null);

function makeQuickPlayer(id: number, game: GameType): Seat {
  return { ...makeSeat(id, game), name: id === 0 ? "Your hand" : id === 1 ? "Opponent" : `Opponent ${id}` };
}

function makeQuickPlayers(game: GameType) {
  return [makeQuickPlayer(0, game), makeQuickPlayer(1, game)];
}

export function QuickEquity({ active, api, onOpenAdvanced }: Props) {
  const [editing, setEditing] = useState(false);
  const [game, setGame] = useState<GameType>("holdem");
  const [players, setPlayers] = useState(() => makeQuickPlayers("holdem"));
  const [board, setBoard] = useState(emptyBoard);
  const [target, setTarget] = useState<number | "board" | null>(null);
  const [slot, setSlot] = useState(0);
  const [result, setResult] = useState<Calculation | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const editor = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!active) {
      setTarget(null);
      setBusy(false);
    }
    return () => request.current?.abort();
  }, [active]);

  useEffect(() => {
    if (editing) editor.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (active && result) resultHeading.current?.focus();
  }, [active, result]);

  const issue = validateSpot(players, board, game, "100", "0");
  const boardIssue = validateCommunityCards(board);
  const pickerCards = target === "board" ? board : players.find((player) => player.id === target)?.cards;

  function clearResult() {
    request.current?.abort();
    setResult(null);
    setBusy(false);
    setError(null);
  }

  async function calculate(type: GameType, hands: Seat[], community: (string | null)[]) {
    if (validateSpot(hands, community, type, "100", "0")) return;
    clearResult();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    try {
      const response = await feedbackFetch(`${api}/calculate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          gameType: type,
          gameMode: "cash",
          playerInputs: hands.map((player) => ({ type: "hand", cards: player.cards })),
          board: community.filter(Boolean),
          potSize: 100,
          callAmount: 0,
          calculationMethod: "auto",
          iterations: 10000,
          saveSpot: false,
        }),
      });
      const data: Calculation = await response.json();
      if (controller.signal.aborted) return;
      if (!response.ok || !data.success) throw new Error(data.error || "Could not calculate equity.");
      setResult(data);
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not calculate equity.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  function loadExample() {
    const examplePlayers = makeQuickPlayers("holdem");
    examplePlayers[0].cards = ["As", "Ah"];
    examplePlayers[1].cards = ["Kd", "Kc"];
    const flop = ["2c", "7d", "9h", null, null];
    setGame("holdem");
    setPlayers(examplePlayers);
    setBoard(flop);
    setEditing(true);
    void calculate("holdem", examplePlayers, flop);
  }

  function openPicker(next: number | "board", index: number) {
    setTarget(next);
    setSlot(index);
  }

  function pick(card: string | null) {
    if (!pickerCards) return;
    clearResult();
    const cards = [...pickerCards];
    cards[slot] = card;
    if (target === "board") setBoard(cards);
    else setPlayers(players.map((player) => player.id === target ? { ...player, cards } : player));
    if (card) {
      const next = cards.findIndex((value, index) => !value && index > slot);
      const missing = next === -1 ? cards.indexOf(null) : next;
      if (missing !== -1) setSlot(missing);
    }
  }

  const equityFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

  return (
    <main id={active ? "main-content" : undefined} tabIndex={-1} className="quick-equity" hidden={!active}>
      <header className="quick-intro">
        <span className="eyebrow">RIVER POKER LAB</span>
        <h1>Quick Equity</h1>
        <p>See how much of the pot each hand is expected to win.</p>
        {!editing && (
          <div className="quick-actions">
            <button type="button" className="primary-button" onClick={loadExample}>Try an example</button>
            <button type="button" className="secondary-button" onClick={() => setEditing(true)}>Analyze my hand</button>
          </div>
        )}
      </header>
      {editing && (
        <div className="quick-panel">
          <h2 ref={editor} tabIndex={-1}>Build your hand</h2>
          <div className="segmented-control quick-games" role="group" aria-label="Game type">
            {(["holdem", "omaha"] as const).map((type) => (
              <button key={type} type="button" aria-pressed={game === type} className={game === type ? "active" : ""}
                onClick={() => {
                  if (game === type) return;
                  clearResult();
                  setGame(type);
                  setPlayers(players.map((player) => ({ ...player, cards: Array(handSize(type)).fill(null) })));
                }}>{type === "holdem" ? "Hold’em" : "Omaha"}</button>
            ))}
          </div>
          <p className="muted quick-help">Choose {handSize(game)} cards for each player. Changing the game clears the players’ cards.</p>
          {players.map((player, index) => (
            <div className="quick-row" key={player.id}>
              <div>
                <h3>{player.name}</h3>
                <span className="muted">{player.cards.filter(Boolean).length} of {handSize(game)} cards</span>
              </div>
              <div className="quick-cards">
                {player.cards.map((card, slotIndex) => (
                  <Card key={slotIndex} value={card} label={`${player.name} card ${slotIndex + 1}`} onClick={() => openPicker(player.id, slotIndex)} />
                ))}
                {index >= 2 && (
                  <button type="button" className="text-button quick-remove" aria-label={`Remove ${player.name}`} onClick={() => {
                    clearResult();
                    setPlayers(players.filter((seat) => seat.id !== player.id));
                  }}>Remove</button>
                )}
              </div>
            </div>
          ))}
          {players.length < 9 && (
            <button type="button" className="text-button quick-add" onClick={() => {
              clearResult();
              const id = players[players.length - 1].id + 1;
              setPlayers([...players, makeQuickPlayer(id, game)]);
            }}>+ Add player</button>
          )}
          <div className="quick-row quick-board">
            <div>
              <h3>Community cards <span className="muted">· Optional</span></h3>
              <span className="muted">Leave empty, or add 3, 4, or 5 cards in order.</span>
            </div>
            <div className="quick-cards">
              {board.map((card, index) => (
                <Card key={index} value={card} label={`Community card ${index + 1}`} onClick={() => openPicker("board", index)} />
              ))}
              {board.some(Boolean) && <button type="button" className="text-button quick-remove" onClick={() => {
                clearResult();
                setBoard(emptyBoard());
              }}>Clear board</button>}
            </div>
          </div>
          {boardIssue && <p className="validation-note">{boardIssue}</p>}
          <div className="quick-calculate">
            <button type="button" className="primary-button" disabled={!!issue || busy} onClick={() => void calculate(game, players, board)}>
              Calculate equity
            </button>
            {issue && !boardIssue && <p className="muted">{issue}</p>}
            {busy && <LoadingIndicator label="Calculating equity…" compact />}
            {error && <p className="validation-note" role="alert">{error}</p>}
          </div>
          <div className="quick-next">
            <button type="button" className="text-button quick-advanced" onClick={() => onOpenAdvanced(game, players, board)}>
              Open this hand in Advanced Workspace →
            </button>
            <button type="button" className="text-button quick-advanced" onClick={() => {
              clearResult();
              setGame("holdem");
              setPlayers(makeQuickPlayers("holdem"));
              setBoard(emptyBoard());
              setEditing(false);
              document.getElementById("main-content")?.focus();
            }}>Start over</button>
          </div>
        </div>
      )}
      {result && (
        <section className="quick-panel quick-result" aria-labelledby="quick-result-title">
          <h2 id="quick-result-title" ref={resultHeading} tabIndex={-1}>Expected share of the pot</h2>
          <p>These percentages show how much of the pot each hand would take on average with these cards. Ties count as a share of the pot.</p>
          <dl>
            {result.results.map(({ playerIndex, equity }) => (
              <div key={playerIndex}>
                <dt>{players[playerIndex].name}</dt>
                <dd>{equityFormat.format(equity)}%</dd>
              </div>
            ))}
          </dl>
          <details>
            <summary>Calculation details</summary>
            <p>{result.method === "exact"
              ? `Exact calculation · ${(result.samples ?? result.iterations).toLocaleString("en-US")} possible outcomes checked.`
              : `Simulation estimate · ${(result.samples ?? result.iterations).toLocaleString("en-US")} samples.`}</p>
          </details>
          <button type="button" className="secondary-button" onClick={() => editor.current?.focus()}>Edit this hand</button>
        </section>
      )}
      {active && pickerCards && (
        <CardPicker
          title={target === "board" ? "Community cards" : players.find((player) => player.id === target)!.name}
          cards={pickerCards}
          activeIndex={slot}
          usedCards={new Set([...players.flatMap((player) => player.cards), ...board].filter((card): card is string => card !== null))}
          onActiveIndex={setSlot}
          onPick={pick}
          onClose={() => setTarget(null)}
        />
      )}
    </main>
  );
}
