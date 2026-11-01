import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { FEEDBACK_MS, reducedMotion } from "../lib/loading";
export function LoadingIndicator({ label = "Loading…", compact = false }: { label?: string; compact?: boolean }) {
  return (
    <span className={`loading-indicator ${compact ? "loading-compact" : ""}`} role="status" aria-live="polite">
      <span className="loading-emblem" aria-hidden="true"><span>♠</span></span>
      <span>{label}</span>
    </span>
  );
}
export function PageTransition({ view, label, children }: { view: string; label: string; children: ReactNode }) {
  const [settled, setSettled] = useState<string | null>(null);
  const busy = settled !== view;
  useEffect(() => {
    const timer = setTimeout(() => setSettled(view), reducedMotion() ? 0 : FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [view]);
  return (
    <div className="page-transition" aria-busy={busy}>
      {busy && <LoadingIndicator label={`Opening ${label}…`} />}
      <div hidden={busy} className="view-content" key={view}>{children}</div>
    </div>
  );
}
