import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { apiFetch } from "../lib/api";
import { feedbackFetch } from "../lib/loading";
import { LoadingIndicator } from "./LoadingIndicator";
interface User {
  id: string;
  username: string;
  role?: "user" | "admin";
  email: string | null;
  phone: string | null;
  manuallyApproved?: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
}
interface Verification {
  manual?: boolean;
  username: string;
  channel: "email" | "sms";
  emailHint: string;
  phoneHint: string;
}
interface Session {
  expiresInMs?: number;
  expiresAt: string;
  remember: boolean;
}
interface Identity {
  preview?: boolean;
  user: User | null;
  verification?: Verification;
  session?: Session;
}
interface AuthContextValue extends Identity {
  api: string;
  refresh: () => Promise<void>;
  signedIn: (data: Identity) => void;
  logout: () => Promise<void>;
  loggingOut: boolean;
}
const Context = createContext<AuthContextValue | null>(null);
export function useAuth() {
  const value = useContext(Context);
  if (!value) throw Error("Authentication provider missing.");
  return value;
}
const API = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");
export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity>({ user: null }),
    [checking, setChecking] = useState(true),
    [error, setError] = useState<string | null>(null),
    [loggingOut, setLoggingOut] = useState(false);
  const revision = useRef(0),
    refreshRequest = useRef<AbortController | null>(null);
  const invalidate = () => {
    revision.current++;
    refreshRequest.current?.abort();
  };
  const refresh = useCallback(async () => {
    const version = ++revision.current;
    refreshRequest.current?.abort();
    const controller = new AbortController();
    refreshRequest.current = controller;
    try {
      const r = await apiFetch(`${API}/auth/me`, { signal: controller.signal });
      const data = await r.json();
      if (!r.ok || !data.success)
        throw Error(data.error || "Cannot check your session.");
      if (version !== revision.current || controller.signal.aborted) return;
      setIdentity(data);
      setError(null);
    } catch (error) {
      if (version === revision.current && !controller.signal.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Account service unavailable.",
        );
    } finally {
      if (version === revision.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const expired = () => {
      invalidate();
      setIdentity({ user: null });
      setError(null);
    };
    const focus = () => void refresh();
    window.addEventListener("river-auth-expired", expired);
    window.addEventListener("focus", focus);
    return () => {
      window.removeEventListener("river-auth-expired", expired);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    if (!identity.session) return;
    const delay = Math.max(
      1000,
      identity.session.expiresInMs ??
        new Date(identity.session.expiresAt).getTime() - Date.now(),
    );
    const timer = setTimeout(() => void refresh(), Math.min(delay, 2147483000));
    return () => clearTimeout(timer);
  }, [identity.session, refresh]);
  async function logout() {
    invalidate();
    setLoggingOut(true);
    try {
      const r = await apiFetch(`${API}/auth/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!r.ok) throw Error("Sign out failed. Try again.");
      invalidate();
      setIdentity({ user: null });
      window.location.hash = "/spot";
      setError(null);
    } finally {
      setLoggingOut(false);
    }
  }
  return (
    <Context.Provider
      value={{
        ...identity,
        api: API,
        refresh,
        signedIn: (data) => {
          invalidate();
          setIdentity(data);
          setError(null);
        },
        logout,
        loggingOut,
      }}
    >
      {identity.preview && (
        <div className="preview-banner" role="status">
          LOCAL UI PREVIEW · No sign-in or database · Calculations are real; saving and account actions are disabled.
        </div>
      )}
      {checking || (loggingOut && !identity.user) ? (
        <main className="auth-shell">
          <LoadingIndicator label="Checking your session…" />
        </main>
      ) : identity.user ? (
        <div key={identity.user.id}>{children}</div>
      ) : error ? (
        <main className="auth-shell">
          <h1>Account service unavailable</h1>
          <p role="alert">{error}</p>
          <button
            className="primary-button"
            onClick={() => {
              setChecking(true);
              void refresh();
            }}
          >
            Retry
          </button>
        </main>
      ) : (
        <AuthScreen initialVerification={identity.verification} />
      )}
    </Context.Provider>
  );
}
function AuthScreen({
  initialVerification,
}: {
  initialVerification?: Verification;
}) {
  const auth = useAuth();
  const [mode, setMode] = useState<"login" | "register" | "verify">(
      initialVerification ? "verify" : "login",
    ),
    [verification, setVerification] = useState(initialVerification);
  const [channels, setChannels] = useState<string[]>([]),
    [development, setDevelopment] = useState(false),
    [manualChannels, setManualChannels] = useState<string[]>([]),
    [channel, setChannel] = useState<string>(
      initialVerification?.channel || "email",
    );
  const [identifier, setIdentifier] = useState(""),
    [email, setEmail] = useState(""),
    [username, setUsername] = useState(""),
    [phone, setPhone] = useState(""),
    [password, setPassword] = useState(""),
    [remember, setRemember] = useState(false),
    [code, setCode] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void apiFetch(`${auth.api}/auth/config`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setChannels(data.channels || []);
        setDevelopment(!!data.development);
        setManualChannels(data.manualChannels || []);
        setChannel((current) =>
          data.channels?.includes(current)
            ? current
            : data.channels?.[0] || "email",
        );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [auth.api]);
  async function send(path: string, body: object) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const r = await feedbackFetch(`${auth.api}/auth/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.verification) {
        setVerification(data.verification);
        setMode("verify");
        setPassword("");
        setCode("");
      }
      if (!r.ok || !data.success)
        throw Error(data.error || "Account request failed.");
      if (path === "login") auth.signedIn(data);
      else if (path === "verification/confirm") {
        setVerification(undefined);
        setMode("login");
        setCode("");
        setNotice("Account verified. Sign in to continue.");
      } else if (data.verification)
        setNotice(
          data.verification.manual
            ? "Ask the administrator for your activation code. No email or SMS was sent."
            : "A verification code was requested. Check the selected contact channel.",
        );
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Cannot reach the backend.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-shell">
      <a className="brand" href="#/spot">
        <span className="brand-mark">♠</span>
        <span>
          RIVER<small>POKER LAB</small>
        </span>
      </a>
      <section className="auth-card">
        <h1>
          {mode === "login"
            ? "Welcome back"
            : mode === "register"
              ? "Create your account"
              : "Verify your account"}
        </h1>
        <p className="field-help">
          Your saved spots belong to your account. New accounts start with an
          empty history.
        </p>
        {mode !== "verify" && (
          <div className="auth-tabs">
            <button
              aria-pressed={mode === "login"}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              aria-pressed={mode === "register"}
              onClick={() => {
                setMode("register");
                setError(null);
              }}
            >
              Register
            </button>
          </div>
        )}
        {mode === "verify" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send("verification/confirm", { code });
            }}
          >
            <p>
              Account: <strong>{verification?.username}</strong>
            </p>
            <p className="field-help">
              {verification?.channel === "sms"
                ? verification.phoneHint
                : verification?.emailHint}{" "}
              · Code expires after 10 minutes. Five code attempts maximum.
            </p>
            {verification?.manual && (
              <p className="auth-notice" role="status">
                Ask the administrator for the activation code for this username.
                No email or SMS was sent. Request a new code if it expires.
              </p>
            )}
            <label className="field-label">
              VERIFICATION CODE
              <input
                aria-label="Verification code"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{8}"
                minLength={8}
                maxLength={8}
                required
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
            <button className="primary-button full-width" disabled={busy}>
              {busy ? <LoadingIndicator label="Verifying…" compact /> : "Verify account"}
            </button>
            <label className="field-label">
              SEND VIA
              <select
                aria-label="Verification channel"
                value={channel}
                onChange={(event) => setChannel(event.target.value)}
              >
                {channels.map((value) => (
                  <option key={value} value={value}>
                    {manualChannels.includes(value) ? "Administrator approval" : value === "sms" ? "SMS" : "Email"}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary-button full-width"
              disabled={busy || !channels.length}
              onClick={() => void send("verification/send", { channel })}
            >
              {busy ? "Please wait…" : "Resend verification code"}
            </button>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => {
                setMode("login");
                setCode("");
                setError(null);
              }}
            >
              Back to sign in
            </button>
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send(
                mode === "login" ? "login" : "register",
                mode === "login"
                  ? { identifier, password, remember }
                  : { email, username, phone, password, channel },
              );
            }}
          >
            {mode === "login" ? (
              <label className="field-label">
                USERNAME OR EMAIL
                <input
                  aria-label="Username or email"
                  autoComplete="username"
                  required
                  maxLength={254}
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                />
              </label>
            ) : (
              <>
                <label className="field-label">
                  EMAIL
                  <input
                    aria-label="Registration email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  USERNAME
                  <input
                    aria-label="Registration username"
                    autoComplete="username"
                    required
                    pattern="[A-Za-z0-9_]{3,30}"
                    minLength={3}
                    maxLength={30}
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  PHONE
                  <input
                    aria-label="Registration phone"
                    type="tel"
                    autoComplete="tel"
                    required
                    placeholder="+972501234567"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                </label>
                <label className="field-label">
                  VERIFY VIA
                  <select
                    aria-label="Registration verification channel"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value)}
                  >
                    {channels.map((value) => (
                      <option key={value} value={value}>
                        {manualChannels.includes(value) ? "Administrator approval" : value === "sms" ? "SMS" : "Email"}
                      </option>
                    ))}
                  </select>
                </label>
                {!channels.length && (
                  <p className="validation-note">
                    Verification delivery is not configured. Contact the
                    administrator.
                  </p>
                )}
              </>
            )}
            <label className="field-label">
              PASSWORD
              <input
                aria-label="Password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                maxLength={512}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {mode === "register" ? (
              <p className="field-help">
                Use 15–128 characters. Spaces and Unicode are allowed.
              </p>
            ) : (
              <label className="icm-confirm">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => setRemember(event.target.checked)}
                />
                Remember me on this device
              </label>
            )}
            <button
              className="primary-button full-width"
              disabled={busy || (mode === "register" && !channels.length)}
            >
              {busy
                ? <LoadingIndicator label="Please wait…" compact />
                : mode === "login"
                  ? "Sign in"
                  : "Create account"}
            </button>
          </form>
        )}
        {error && (
          <p role="alert" className="validation-note">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="auth-notice">
            {notice}
          </p>
        )}
        {manualChannels.includes(channel) && mode === "register" && (
          <p className="field-help">
            Beta accounts are activated manually. After registering, ask the
            administrator for your code. Contact details remain unverified.
          </p>
        )}
        {development && (
          <p className="field-help">
            Local development delivery is enabled. Codes appear only in the
            backend terminal; no real email or SMS is sent.
          </p>
        )}
      </section>
    </main>
  );
}
export function AccountPanel() {
  const auth = useAuth(),
    [error, setError] = useState<string | null>(null);
  return (
    <section className="sidebar-section" aria-label="Account details">
      <h2>{auth.user?.username}</h2>
      {auth.user?.role === "admin" && <p className="auth-notice">Administrator account</p>}
      {auth.user?.manuallyApproved && (
        <p className="auth-notice">
          Account activated by the administrator. Contact verification is listed separately below.
        </p>
      )}
      <dl className="account-details">
        <dt>Email</dt>
        <dd>
          {auth.user?.email || "Not provided"} ·{" "}
          {auth.user?.emailVerified ? "Verified" : "Not verified"}
        </dd>
        <dt>Phone</dt>
        <dd>
          {auth.user?.phone || "Not provided"} ·{" "}
          {auth.user?.phoneVerified ? "Verified" : "Not verified"}
        </dd>
        <dt>This device</dt>
        <dd>
          {auth.preview ? "No session · local UI preview" : auth.session?.remember
            ? "Remembered for up to 30 days"
            : "Temporary browser session, maximum 12 hours"}
        </dd>
        <dt>Session expires</dt>
        <dd>
          {auth.session
            ? new Date(auth.session.expiresAt).toLocaleString()
            : "—"}
        </dd>
      </dl>
      <p className="field-help">
        Only your saved spots appear in History. Signing out clears this
        device's workspace and revokes this session.
      </p>
      <button
        className="secondary-button"
        disabled={auth.loggingOut || auth.preview}
        onClick={() =>
          void auth.logout().catch((error) => setError(error.message))
        }
      >
        {auth.preview ? "Local preview · no session" : auth.loggingOut ? <LoadingIndicator label="Signing out…" compact /> : "Sign out of this device"}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
