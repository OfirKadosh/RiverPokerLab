import { apiFetch as fetch } from "../lib/api";
import { useEffect, useState } from "react";
import { RANKS } from "../lib/poker";
import type { RangeConfig, RangeAction, RangeDraft } from "../lib/poker";
const ACTIONS = ["fold", "check", "call", "bet", "raise", "allin"] as const;
interface Preview {
  canonicalRange: string;
  actionRanges?: RangeConfig["actionRanges"];
  rangeAction?: RangeAction;
  classes: string[];
  classWeights: Record<string, number | null>;
  counts: Record<string, number>;
  totalCombos: number;
  availableCombos: number;
  blockedCombos: number;
  effectiveAvailableCombos: number;
  availableMass: number;
  knownCardActionFrequency: number | null;
  combos: { cards: string[]; weight: number; blocked: boolean }[];
}
interface Props extends RangeConfig {
  value: string;
  deadCards: string[];
  api: string;
  onCommit: (config: RangeConfig) => void;
  draftState?: RangeDraft;
  onDraftChange?: (draft: RangeDraft) => void;
}
const MATRIX = RANKS.map((a, row) =>
  RANKS.map((b, col) =>
    row === col ? a + b : row < col ? a + b + "s" : b + a + "o",
  ),
);
const PRESETS = [
  { label: "Premium", value: "QQ+, AKs, AKo" },
  { label: "Pairs", value: "22+" },
  { label: "Suited aces", value: "A2s+" },
  { label: "All hands", value: "random" },
];
export function RangeEditor({
  value,
  actionRanges,
  rangeAction,
  deadCards,
  api,
  onCommit,
  draftState,
  onDraftChange,
}: Omit<Props, "range">) {
  const [local, setLocal] = useState<RangeDraft>({
    range: value,
    actionRanges: actionRanges || {},
    rangeAction: rangeAction || "base",
  });
  const draft = draftState ?? local;
  function update(changes: Partial<RangeDraft>) {
    const next = { ...draft, ...changes };
    setLocal(next);
    onDraftChange?.(next);
  }
  const [target, setTarget] = useState<RangeAction>("base"),
    [brush, setBrush] = useState("100");
  const [storedPreview, setPreview] = useState<Preview | null>(null),
    [storedEditor, setEditor] = useState<Preview | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [importText, setImportText] = useState("");
  const text =
    target === "base" ? draft.range : draft.actionRanges[target] || "";
  const [verifiedKey, setVerifiedKey] = useState<string | null>(null);
  const requestKey = JSON.stringify({ draft, deadCards, target });
  const preview = verifiedKey === requestKey ? storedPreview : null;
  const editor = verifiedKey === requestKey ? storedEditor : null;
  useEffect(() => {
    setPreview(null);
    setEditor(null);
    setError(null);
    if (!draft.range.trim()) {
      setPending(false);
      return;
    }
    const controller = new AbortController();
    let active = true;
    setPending(true);
    const timer = setTimeout(async () => {
      try {
        const profiles = Object.fromEntries(
          Object.entries(draft.actionRanges).filter(([, range]) =>
            range?.trim(),
          ),
        );
        const payload = {
          range: draft.range,
          actionRanges: profiles,
          rangeAction: draft.rangeAction,
          deadCards,
        };
        const post = async (body: object) => {
          const response = await fetch(`${api}/ranges/preview`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            signal: controller.signal,
            body: JSON.stringify(body),
          });
          const data = await response.json();
          if (!response.ok || !data.success)
            throw Error(data.error || "Range preview failed.");
          return data as Preview;
        };
        const [main, editing] = await Promise.all([
          post(payload),
          target === "base"
            ? Promise.resolve(null)
            : text.trim()
              ? post({ range: text, deadCards })
              : Promise.resolve(null),
        ]);
        if (active) {
          setVerifiedKey(requestKey);
          setPreview(main);
          setEditor(target === "base" ? main : editing);
        }
      } catch (error) {
        if (active && !controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Range preview unavailable.",
          );
      } finally {
        if (active) setPending(false);
      }
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
    // The serialized key includes every request input; navigation retains the external draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, api]);
  function setText(value: string) {
    if (target === "base") update({ range: value });
    else
      update({
        actionRanges: { ...draft.actionRanges, [target]: value },
        ...(!value.trim() && draft.rangeAction === target
          ? { rangeAction: "base" as const }
          : {}),
      });
  }
  function paint(hand: string) {
    const weight = Number(brush);
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return;
    const current = editor?.classWeights[hand];
    const next =
      current !== undefined &&
      current !== null &&
      Math.abs(current * 100 - weight) < 1e-8
        ? 0
        : weight;
    const previous = editor?.canonicalRange ?? text;
    setText(`${previous}${previous.trim() ? ", " : ""}${hand}@${next}%`);
  }
  function importConfig() {
    try {
      const config = JSON.parse(importText);
      if (
        typeof config.range !== "string" ||
        (config.actionRanges !== undefined &&
          (!config.actionRanges ||
            typeof config.actionRanges !== "object" ||
            Array.isArray(config.actionRanges))) ||
        Object.values(config.actionRanges || {}).some(
          (value) => typeof value !== "string",
        ) ||
        (config.rangeAction !== undefined &&
          !["base", ...ACTIONS].includes(config.rangeAction))
      )
        throw Error("Invalid range configuration JSON.");
      update({
        range: config.range,
        actionRanges: config.actionRanges || {},
        rangeAction: config.rangeAction || "base",
      });
      setTarget("base");
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Invalid JSON.");
    }
  }
  const selected = editor?.classes || [];
  return (
    <section className="range-editor" aria-label="Holdem range editor">
      <p className="field-help">
        Weights apply to physical two-card combos. Use AA@50% or AhKd@25%. Later
        tokens override earlier overlaps; zero removes a combo. These are
        supplied assumptions, not solved strategy.
      </p>
      <div className="field-pair">
        <label className="field-label">
          EDIT RANGE
          <select
            aria-label="Range editing target"
            value={target}
            onChange={(event) => setTarget(event.target.value as RangeAction)}
          >
            <option value="base">Base prior</option>
            {ACTIONS.map((action) => (
              <option key={action} value={action}>
                {action} frequency profile
              </option>
            ))}
          </select>
        </label>
        <label className="field-label">
          OBSERVED ACTION
          <select
            aria-label="Observed range action"
            value={draft.rangeAction}
            onChange={(event) =>
              update({ rangeAction: event.target.value as RangeAction })
            }
          >
            <option value="base">None · Base prior</option>
            {ACTIONS.map((action) => (
              <option
                key={action}
                value={action}
                disabled={!draft.actionRanges[action]?.trim()}
              >
                {action}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="field-label">
        RANGE NOTATION
        <textarea
          aria-label="RANGE NOTATION"
          maxLength={32768}
          rows={3}
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="TT+@50%, AJs+, AhKd@25%"
          spellCheck={false}
        />
      </label>
      <div className="range-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            className="secondary-button"
            onClick={() => setText(preset.value)}
          >
            {preset.label}
          </button>
        ))}
        <button className="text-button" onClick={() => setText("")}>
          Clear {target === "base" ? "base" : "profile"}
        </button>
      </div>
      <label className="field-label">
        MATRIX BRUSH · PERCENT
        <input
          aria-label="Range matrix weight"
          type="number"
          min="0"
          max="100"
          step="0.01"
          value={brush}
          onChange={(event) => setBrush(event.target.value)}
        />
      </label>
      <div className="range-summary" role="status">
        {pending ? (
          "Checking range…"
        ) : error ? (
          <span className="validation-note">{error}</span>
        ) : preview ? (
          <>
            <strong>
              {preview.availableCombos} / {preview.totalCombos} base combos
              available
            </strong>
            <span>
              Effective: {preview.effectiveAvailableCombos} combos · weighted
              mass {preview.availableMass.toFixed(4)}
            </span>
            {draft.rangeAction !== "base" && (
              <span>
                Observed {draft.rangeAction}:{" "}
                {((preview.knownCardActionFrequency ?? 0) * 100).toFixed(2)}%
                likelihood after known-card blockers only
              </span>
            )}
          </>
        ) : (
          "Enter a positive base range to preview."
        )}
      </div>
      <div
        className="range-matrix"
        role="group"
        aria-label="169 starting hands"
      >
        {MATRIX.flatMap((row, rowIndex) =>
          row.map((hand, colIndex) => (
            <button
              key={hand}
              type="button"
              className={`range-cell ${rowIndex === colIndex ? "range-pair" : rowIndex < colIndex ? "range-suited" : "range-offsuit"} ${selected.includes(hand) ? "range-selected" : ""} ${editor?.counts[hand] === 0 ? "range-blocked" : ""}`}
              aria-label={hand}
              aria-pressed={selected.includes(hand)}
              disabled={
                pending ||
                brush.trim() === "" ||
                !Number.isFinite(Number(brush)) ||
                Number(brush) < 0 ||
                Number(brush) > 100
              }
              onClick={() => paint(hand)}
            >
              {hand}
              {selected.includes(hand) && (
                <small className="range-cell-weight">
                  {editor?.classWeights[hand] === null
                    ? "Mix"
                    : `${Math.round((editor?.classWeights[hand] ?? 0) * 10000) / 100}%`}
                </small>
              )}
            </button>
          )),
        )}
      </div>
      <p className="field-help">
        Click paints the class with the brush frequency; clicking the same
        frequency again clears it. Mix indicates suit-specific overrides. Combo
        overrides can be edited in the notation above.
      </p>
      <details>
        <summary>Action profile rules</summary>
        <p className="field-help">
          All six profiles describe alternatives at ONE decision point. Each
          combo's frequencies must sum to at most 100%. Missing probability is
          unspecified, never assumed to be Fold. Select an already observed
          action explicitly; effective weight = base weight × that action's
          frequency. The action ledger does not silently select profiles.
          Hypothetical Hero Fold/Call does not change these conditioned priors.
        </p>
        <p className="field-help">
          Example: base QQ+, AK; call QQ+@50%, AK@25%; raise QQ+@50%, AK@75%.
          Apply after selecting the intended observed action. Actual legality
          and strategy of those actions are not inferred.
        </p>
      </details>
      {preview && (
        <details>
          <summary>Physical combos ({preview.totalCombos})</summary>
          <div className="combo-preview">
            {preview.combos.map((combo) => (
              <span
                key={combo.cards.join("")}
                className={combo.blocked ? "combo-blocked" : ""}
              >
                {combo.cards.join(" ")} · {(combo.weight * 100).toFixed(2)}%
                {combo.blocked ? " · blocked" : ""}
              </span>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>Import / export range configuration</summary>
        <label className="field-label">
          COPY JSON
          <textarea
            aria-label="Export range JSON"
            readOnly
            rows={4}
            value={JSON.stringify(
              {
                range: draft.range,
                actionRanges: draft.actionRanges,
                rangeAction: draft.rangeAction,
              },
              null,
              2,
            )}
          />
        </label>
        <label className="field-label">
          PASTE JSON
          <textarea
            aria-label="Import range JSON"
            rows={3}
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
          />
        </label>
        <button className="secondary-button" onClick={importConfig}>
          Import configuration
        </button>
      </details>
      <p className="field-help">
        Available mass is the sum of surviving combo weights, not a normalized
        hand probability. Other ranges are jointly conditioned on no collisions
        in the engine. Holds for folded players as blockers too. Hold'em ranges
        only; Omaha uses four specific cards.
      </p>
      <button
        className="primary-button full-width"
        disabled={
          pending ||
          !!error ||
          !preview ||
          preview.effectiveAvailableCombos === 0
        }
        onClick={() => {
          if (preview) {
            const config = {
              range: preview.canonicalRange,
              actionRanges: preview.actionRanges || {},
              rangeAction: preview.rangeAction || ("base" as RangeAction),
            };
            update(config);
            onCommit(config);
          }
        }}
      >
        Apply range
      </button>
    </section>
  );
}
