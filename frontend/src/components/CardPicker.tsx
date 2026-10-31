import { useEffect, useRef } from "react";
import { Card } from "./Card";
import { RANKS, SUITS, SYMBOLS } from "../lib/poker";
interface Props {
  title: string;
  cards: (string | null)[];
  activeIndex: number;
  usedCards: Set<string>;
  onActiveIndex: (index: number) => void;
  onPick: (card: string | null) => void;
  onClose: () => void;
  children?: React.ReactNode;
  alternativeContent?: React.ReactNode;
  maxCards?: number;
}
export function CardPicker({
  title,
  cards,
  activeIndex,
  usedCards,
  onActiveIndex,
  onPick,
  onClose,
  children,
  alternativeContent,
  maxCards = cards.length,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const dialog = dialogRef.current!;
    const previous = document.activeElement as HTMLElement | null;
    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialogRef}
      className="picker-dialog"
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="picker-content">
        <div className="sheet-handle" />
        <header className="dialog-heading">
          <div>
            <span className="eyebrow">
              {alternativeContent ? "RANGE SELECTION" : "CARD SELECTION"}
            </span>
            <h2>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={onClose}
            aria-label="Close card picker"
          >
            ×
          </button>
        </header>
        {children}
        {alternativeContent || (
          <>
            <div className="selection-tray">
              {cards.slice(0, maxCards).map((card, index) => (
                <Card
                  key={index}
                  value={card}
                  label={`Card ${index + 1}`}
                  selected={index === activeIndex}
                  onClick={() => onActiveIndex(index)}
                />
              ))}
              <div className="selection-help">
                <strong>
                  {cards.slice(0, maxCards).filter(Boolean).length} / {maxCards}{" "}
                  cards
                </strong>
                <span>
                  Choose a card below.
                  <br />
                  Selection advances automatically.
                </span>
              </div>
            </div>
            <div className="deck-caption">
              <span>SELECT CARD {activeIndex + 1}</span>
              <button
                className="text-button"
                disabled={!cards[activeIndex]}
                onClick={() => onPick(null)}
              >
                Clear selected card
              </button>
            </div>
            <div className="deck-grid">
              {SUITS.map((suit) => (
                <div className={`suit-row suit-${suit}`} key={suit}>
                  <span className="suit-row-label" aria-hidden="true">
                    {SYMBOLS[suit]}
                  </span>
                  {RANKS.map((rank) => {
                    const card = rank + suit;
                    return (
                      <Card
                        key={card}
                        value={card}
                        disabled={
                          usedCards.has(card) && cards[activeIndex] !== card
                        }
                        selected={cards[activeIndex] === card}
                        onClick={() => onPick(card)}
                      />
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="muted deck-note">
              Dimmed cards are already assigned. Tap a selected slot to replace
              its card.
            </p>
            <button className="primary-button full-width" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </dialog>
  );
}
