import { apiFetch } from "./api";
export const FEEDBACK_MS = 500;
export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Start work immediately; only hold successful fast responses to prevent a loading flash.
// Background session checks keep using apiFetch directly. Errors are shown immediately.
export async function feedbackFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const started = performance.now();
  const response = await apiFetch(input, init);
  const remaining = reducedMotion() ? 0 : FEEDBACK_MS - (performance.now() - started);
  if (response.ok && remaining > 0) {
    await new Promise<void>((resolve, reject) => {
      const signal = init.signal;
      if (signal?.aborted) { reject(new DOMException("Cancelled", "AbortError")); return; }
      const cancel = () => { clearTimeout(timer); reject(new DOMException("Cancelled", "AbortError")); };
      const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, remaining);
      signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  return response;
}
