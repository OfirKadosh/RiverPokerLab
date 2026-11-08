import { useCallback, useEffect, useState } from "react";
import type { AccountAccess, AccountUser } from "@river-poker-lab/core";
import { apiClient } from "../lib/api";

interface ManagedAccount extends Pick<AccountUser, "id" | "username" | "email" | "restricted"> {
  approved: boolean;
  protected: boolean;
  canApprove: boolean;
  canGrantAccess: boolean;
  access?: AccountAccess;
  verification: { code: string | null; expiresAt: string | null } | null;
}
type Action = "approve" | "grant-access" | "restrict" | "unrestrict" | "delete";

export function AdminPanel() {
  const [accounts, setAccounts] = useState<ManagedAccount[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState<ManagedAccount | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [clock, setClock] = useState(Date.now);
  const [offset, setOffset] = useState(0);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await apiClient.request<{ accounts: ManagedAccount[]; next: string | null; serverTime: string }>(
        "/auth/admin/accounts", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ after: cursor }), signal,
        },
      );
      if (signal?.aborted) return;
      setAccounts(data.accounts);
      setNext(data.next);
      setOffset(Date.parse(data.serverTime) - Date.now());
      setError("");
    } catch (error) {
      if (!signal?.aborted) {
        setAccounts([]);
        setError(error instanceof Error ? error.message : "Cannot load accounts.");
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [cursor]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  async function act(account: ManagedAccount, action: Action) {
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await apiClient.request("/auth/admin/account-action", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: account.id, action, confirmUsername: confirmation }),
      });
      setDeleting(null);
      setConfirmation("");
      const messages = {
        approve: "Account approved. The user can now sign in.",
        "grant-access": "30 days of access granted from today.",
        restrict: "Solver access restricted.",
        unrestrict: "Solver access restored.",
        delete: "Account deleted.",
      };
      setNotice(messages[action]);
      await load();
    } catch (error) {
      setError(error instanceof Error ? error.message : "The account action failed.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <section className="sidebar-section admin-panel" aria-label="Account management">
      <div className="admin-toolbar">
        <div>
          <h2>Account management</h2>
          <p className="field-help">Share each active code privately with its intended user. Manual approval opens after 10 minutes.</p>
        </div>
        <button className="secondary-button" disabled={working || loading}
          onClick={() => { setLoading(true); void load(); }}>Refresh requests</button>
      </div>
      {error && <p role="alert" className="validation-note">{error}</p>}
      {notice && <p role="status" className="auth-notice">{notice}</p>}
      {loading && <p role="status">Loading accounts…</p>}
      {!loading && !error && !accounts.length && <p>No accounts on this page.</p>}
      <div className="admin-accounts">
        {accounts.map(account => {
          const expires = account.verification?.expiresAt;
          const seconds = expires ? Math.max(0, Math.ceil((Date.parse(expires) - clock - offset) / 1000)) : 0;
          const code = seconds > 0 ? account.verification?.code : null;
          const canApprove = account.canApprove || (!account.approved && !!expires && seconds === 0);
          return <article className="admin-account" key={account.id}>
            <h3>{account.username}</h3>
            <p>{account.email || "No email"}</p>
            <p className="field-help">
              {account.protected && "Protected account · "}
              {account.access?.expired ? "Access expired" : account.access?.source === "trial" ? "Free trial" : account.approved ? "Approved" : "Pending activation"}
              {account.restricted && " · Restricted"}
            </p>
            {account.access && <p className="field-help">
              Access ends {new Date(account.access.expiresAt).toLocaleString()}
            </p>}
            {code ? (
              <div className="admin-code">
                <strong aria-label="Activation code">{code}</strong>
                <span>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")} remaining</span>
                <button className="secondary-button" onClick={() => {
                  void navigator.clipboard.writeText(code).then(
                    () => setNotice("Activation code copied."),
                    () => setError("Copy failed. Select the code to copy it manually."),
                  );
                }}>Copy code</button>
              </div>
            ) : !account.approved && (
              <p className="field-help">
                {canApprove ? "Verification window ended. Manual approval is available." :
                  "No active code is available to copy. The user can request a new code."}
              </p>
            )}
            {account.canGrantAccess && <button className="primary-button" disabled={working}
              onClick={() => void act(account, "grant-access")}>Grant 30 days</button>}
            {!account.protected && <div className="admin-actions">
              {!account.approved && <button className="primary-button" disabled={working || !canApprove}
                onClick={() => void act(account, "approve")}>Approve user</button>}
              <button className="secondary-button" disabled={working}
                onClick={() => void act(account, account.restricted ? "unrestrict" : "restrict")}>
                {account.restricted ? "Restore access" : "Restrict access"}
              </button>
              <button className="text-button admin-delete" disabled={working}
                onClick={() => { setDeleting(account); setConfirmation(""); }}>Delete account</button>
            </div>}
            {deleting?.id === account.id && (
              <form className="admin-delete-form" onSubmit={event => {
                event.preventDefault();
                if (confirmation === account.username) void act(account, "delete");
              }}>
                <label className="field-label">
                  Type {account.username} to permanently delete this account.
                  <input value={confirmation} onChange={event => setConfirmation(event.target.value)}
                    autoComplete="off" autoCapitalize="none" required />
                </label>
                <div className="admin-actions">
                  <button className="secondary-button admin-delete" disabled={working || confirmation !== account.username}>
                    Confirm deletion
                  </button>
                  <button type="button" className="text-button" disabled={working}
                    onClick={() => setDeleting(null)}>Cancel</button>
                </div>
              </form>
            )}
          </article>;
        })}
      </div>
      <div className="admin-actions">
        {cursor && <button className="secondary-button" disabled={working || loading}
          onClick={() => { setLoading(true); setCursor(undefined); }}>First page</button>}
        {next && <button className="secondary-button" disabled={working || loading}
          onClick={() => { setLoading(true); setCursor(next); }}>Next page</button>}
      </div>
    </section>
  );
}
