import { SYMBOLS, SUIT_NAMES } from "../lib/poker";
interface Props {
  value: string | null;
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  small?: boolean;
  onClick?: () => void;
}
export function Card({
  value,
  label,
  selected,
  disabled,
  small,
  onClick,
}: Props) {
  const rank = value?.[0];
  const suit = value?.[1];
  const description = value
    ? `${rank === "T" ? "10" : rank} of ${SUIT_NAMES[suit!]}`
    : label || "Empty card";
  const content = value ? (
    <>
      <span className="card-rank">{rank === "T" ? "10" : rank}</span>
      <span className="card-suit">{SYMBOLS[suit!]}</span>
    </>
  ) : (
    <span className="card-empty-mark">+</span>
  );
  const className = `playing-card ${value ? `suit-${suit}` : "empty-card"} ${selected ? "selected-card" : ""} ${small ? "small-card" : ""}`;
  return onClick ? (
    <button
      type="button"
      className={className}
      aria-label={label ? `${label}: ${description}` : description}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <span className={className} role="img" aria-label={description}>
      {content}
    </span>
  );
}
