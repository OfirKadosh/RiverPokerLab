import { useRef, useState } from "react";
import type { AccountIdentity } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";
import { useAuth } from "./AuthProvider";

export function AccountSwitch() {
  const { accountSwitch, signedIn, refresh } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!accountSwitch) return null;

  async function changeAccount(adminPassword?: string) {
    setBusy(true);
    setError("");
    try {
      const data = await apiClient.request<AccountIdentity>("/auth/switch-account", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(adminPassword ? { adminPassword } : {}),
      });
      dialog.current?.close();
      window.location.hash = data.user?.role === "admin" ? "/admin" : "/spot";
      signedIn(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Cannot switch accounts.");
      void refresh();
    } finally {
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <>
      <button className="secondary-button account-switch" disabled={busy} onClick={() => {
        if (accountSwitch.mode === "link") {
          setError("");
          dialog.current?.showModal();
        } else void changeAccount();
      }}>{busy ? "Switching…" : accountSwitch.mode === "return" ? "Back to Ofir" : "Switch to admin"}</button>
      {accountSwitch.mode === "link" ? (
        <dialog ref={dialog} className="auth-card account-switch-dialog" aria-labelledby="switch-title"
          onClose={() => setPassword("")} onCancel={event => { if (busy) event.preventDefault(); }}>
          <h2 id="switch-title">Link administrator session</h2>
          <p className="field-help">Enter the admin password once to switch between Ofir and admin on this device for up to 12 hours.</p>
          <form onSubmit={event => { event.preventDefault(); void changeAccount(password); }}>
            <label className="field-label">
              Administrator password
              <input type="password" autoComplete="current-password" required maxLength={512}
                value={password} onChange={event => setPassword(event.target.value)} />
            </label>
            {error && <p role="alert" className="validation-note">{error}</p>}
            <div className="admin-actions">
              <button className="primary-button" disabled={busy}>Link and switch</button>
              <button type="button" className="secondary-button" disabled={busy}
                onClick={() => dialog.current?.close()}>Cancel</button>
            </div>
          </form>
        </dialog>
      ) : error && <p role="alert" className="validation-note">{error}</p>}
    </>
  );
}
