# Accounts, verification and private spot history

This cumulative source package includes stage 9 and adds accounts before the trial deployment. **The source is uploaded to GitHub; no public service is deployed.** Hosting preparation is now authorized. See [DEPLOYMENT.md](DEPLOYMENT.md) for the separate hosted manual approval mode and live checks still required.

## What is included

- Registration with email, username, international phone and password.
- Sign-in with username or email plus password; identifiers are case-insensitive.
- A choice of email or SMS account verification, with real provider adapters and explicit local development delivery.
- A mandatory verified account for all application API operations, including calculations, range previews, ICM and saved history.
- Remember me on this device, server-side session expiry, cookie protection and session revocation on sign-out.
- An Account navigation page displaying the signed-in identity, individually verified contacts and current device/session details.
- Owner-scoped spot writes and history queries; new users begin with no saved spots.
- Complete removal of the previous user's in-memory workspace when signing out or changing account identity.

## Install and configure

Extract the full source copy into a fresh folder. Preserve your existing `backend/.env` and private edits. Run `npm ci` in `backend` and `frontend`. No new dependency is needed: password hashing and cryptographic randomness use Node's built-in crypto library.

Keep your existing `MONGO_URI`, then add the auth variables shown in `backend/.env.example`. Do not overwrite your real MongoDB URI with the placeholder.

Generate a new secret locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste that random value into `AUTH_SECRET` in your private `.env`. The server rejects secrets shorter than 32 characters. Do not send provider keys or this secret through chat, commit them or put them in frontend variables.

For local review without sending real messages:

```dotenv
NODE_ENV=development
AUTH_SECRET=YOUR_NEW_RANDOM_SECRET
APP_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
TRUST_PROXY_HOPS=0
AUTH_ALLOW_DEV_DELIVERY=true
EMAIL_PROVIDER=development
SMS_PROVIDER=development
```

The placeholder above must be replaced with your generated secret, not used as a shared credential. In this explicit mode, eight-digit codes appear in the **backend terminal only**. No email/SMS is sent, and the frontend shows a local-development notice. These codes are for local testing, not proof of real contact delivery. Development providers are refused in production even if the opt-in flag is set.

Start `node src/server.js` in `backend` and `npm run dev` in `frontend`. MongoDB must be available for accounts and sessions, including before using calculators through the app. The backend now waits for the connection and required model indexes before listening. After changing `.env`, restart the backend.

To test a phone on the same LAN, add the exact frontend LAN origin to `APP_ORIGINS`, for example `http://192.168.1.10:5173`, then restart the backend. This is a local development configuration, not public hosting.

## Real verification delivery

### Email: Resend

Set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM` using your provider account and verified sender/domain. The adapter calls Resend's HTTPS send-email endpoint with a plain-text code message. An accepted provider response is not a guarantee that the message reaches the inbox.

### SMS: Twilio

Set `SMS_PROVIDER=twilio`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM`. Phone numbers use international E.164 format, such as `+972501234567`. The adapter posts to Twilio's Messages API. Provider account permissions, sender capabilities and recipient restrictions still apply; Twilio trial accounts require approved test recipients.

Set `AUTH_ALLOW_DEV_DELIVERY=false` for real delivery and set any unused channel's provider to `disabled`. Only configured channels appear in the form. Registration and resending never fall back silently to another contact. Provider failures leave the account unverified and let the user request another code after the cooldown. Provider secrets and raw provider error bodies are never returned to the browser.

The code was tested with fake delivery and mocked provider HTTP calls. **No real message was sent, no provider account was created, and no production sender/recipient was verified during this development work.** Configure and validate real delivery separately when ready.

## User workflow

1. Register with email, username, phone and password; select an available verification channel.
2. Enter the requested code. A pending verification session survives page reload for up to 20 minutes.
3. After confirmation, sign in with username or email and password.
4. Choose Remember me only on a device where you want a persistent login.
5. Build/calculates spots normally. Save under Analysis and open your own records under History.
6. Open Account to inspect verification/session information or sign out of this device.

Email addresses are trimmed/lowercased; usernames use 3–30 ASCII letters, digits or underscores and are unique case-insensitively. International phone formatting spaces, parentheses and hyphens normalize away. Email, username and phone are unique. Passwords require 15–128 Unicode code points, up to 512 UTF-8 bytes, with no forced composition rules. Passwords are never trimmed or silently truncated.

For genuine email/SMS delivery, account activation requires **one** selected contact to be proved. Hosted manual approval instead sets `accountApprovedAt` and leaves contact proof unchanged; it is documented in DEPLOYMENT.md. Email proof sets `emailVerifiedAt`; SMS proof sets `phoneVerifiedAt`. The Account page accurately marks the other contact unverified. A verified account can use either its stored username or email identifier with its password. This is account/contact verification during activation, **not** multi-factor authentication on every login or identity/KYC verification.

Password reset, changing email/phone/password, verifying an additional contact from Account, account deletion and a device-management dashboard are not included in this milestone. Any future recovery flow must use a verified contact, not treat an unverified address as proof of ownership.

## Sessions and Remember me

The browser receives a random opaque 256-bit session token in an HttpOnly cookie. MongoDB stores only its SHA-256 hash, the user ID, purpose and absolute expiry. No session token or password is written to localStorage/sessionStorage or exposed in the API response. Existing browser sessions are rotated on successful sign-in; the old token is revoked. A pending verification cookie never authorizes private API access.

- Ordinary sign-in: a browser-session cookie, with a maximum server lifetime of 12 hours.
- Remember me: a persistent cookie and a maximum absolute lifetime of 30 days.
- Pending verification: a browser-session cookie with a 20-minute server lifetime.
- Sign-out: delete the current server session and clear its cookie. Other devices' separate sessions remain valid.

Browser session-restore/privacy settings can affect cookie persistence; closing a browser is not a substitute for explicit sign-out. Server expiry is enforced on every request regardless of MongoDB TTL cleanup delays. The client uses a server-supplied remaining lifetime when scheduling a session check, avoiding a refresh loop on devices with clock skew. Remember me does not renew itself indefinitely. Session expiry or sign-out unmounts private app data; a newly authenticated user gets fresh client state. Navigating among pages while authenticated still retains that user's working drafts/results.

In development the cookie is `river_session`. Production uses `__Host-river_session` with `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/` and no Domain attribute. Production requires HTTPS and explicit HTTPS origins. For a future trusted reverse proxy, configure `TRUST_PROXY_HOPS` (0, 1 or 2) to match the deployment; an untrusted client must not be able to impersonate the configured proxy path. Same-origin API routing is the recommended topology. Arbitrary cross-site cookie hosting is intentionally not enabled.

`AUTH_SECRET` protects verification-code HMACs. Sessions are independently random and looked up by token hash; changing this secret invalidates pending code hashes but does not by itself revoke existing sessions or change password hashes.

## Verification and request controls

Codes contain eight cryptographically random digits, expire after 10 minutes, and allow at most five valid-format attempts per challenge. Only the newest challenge can be confirmed. Confirmation consumes it atomically, including concurrent submissions. Resending replaces the hash, resets that challenge's attempts and requires at least 60 seconds between sends. MongoDB stores an HMAC tied to the user and a random nonce. For manual delivery it also stores an encrypted copy for the administrator. The Admin API returns this copy only while the challenge is active.

Rate limits are persisted in MongoDB fixed-window buckets: registration 5/IP/hour; login 30/IP/15 minutes and 10/normalized identifier/15 minutes; code sends 5/user/hour and 10/IP/hour; code confirmation 30/IP/15 minutes plus the five-attempt challenge limit. A failed/cooldown send can still consume the attempt quota. Limits continue across server restarts and shared app instances using the same database.

Password hashes use salted scrypt, N=131072, r=8, p=1, with constant-time derived-key comparison. This configuration requires roughly 128 MiB per hash. Derivations are serialized per Node process with at most eight waiting requests; excess work receives a retryable 503. Memory for the engine and the rest of the server must also fit the hosting instance. Unknown-user password checks perform a comparable derivation, and login errors do not identify which credential was wrong.

Unsafe API requests require JSON plus `X-Requested-With: RiverPokerLab`. The client wrapper supplies it and includes cookies. Origins are checked against an exact allowlist, credentialed CORS does not use a wildcard, and cross-site browser requests are rejected. API/account responses are `Cache-Control: no-store`. These checks complement SameSite/HttpOnly cookies; they do not rely on hiding controls in the frontend.

## Private history and existing records

Every new saved spot receives `ownerId` from the authenticated server session. Incoming `ownerId`, `userId` or query-string identities are not trusted. History always queries `{ ownerId: authenticatedUserId }`, sorted newest first, limited to that user's latest 20 spots. It does not return another account's records or a global history.

History remains the history of **explicitly saved spots**. Automatic equity refreshes are not archived as additional database records.

Legacy records without an owner are preserved in MongoDB but hidden from every user. They are never deleted, assigned to the first registrant or automatically adopted based on email. Any later administrator-assisted migration would require a separate explicit ownership decision. No such migration was run here.

New collections/models are `User`, `AuthSession` and `AuthRateLimit`; Spot adds optional indexed `ownerId` for legacy compatibility and an owner/time compound index. The startup creates the necessary unique and TTL indexes. No old spot is rewritten by the application update.

## API

Public account endpoints:

- `GET /api/auth/config`: available verification channels and local-development flag.
- `POST /api/auth/register`: `{ email, username, phone, password, channel }`.
- `POST /api/auth/login`: `{ identifier, password, remember }` where remember is boolean.
- `GET /api/auth/me`: current user/session or pending verification information; never secrets.
- `POST /api/auth/verification/send`: `{ channel }`, requiring a pending cookie issued after registration/password proof.
- `POST /api/auth/verification/confirm`: `{ code }`, requiring the pending cookie.
- `POST /api/auth/logout`: `{}`, deleting the current session when present.

All POSTs use JSON and the application header. Every other `/api` endpoint now requires an authenticated, verified session; absent/expired/pending sessions receive HTTP 401. Invalid input receives 400, duplicate registration details 409, unsupported origin/client request 403, throttling 429 and unavailable account/delivery services 503. A correct login for an unverified user returns 403 with `VERIFICATION_REQUIRED` and a pending cookie. The client renders that verification flow and never exposes the application first.

Existing external API scripts must maintain a cookie jar and add the application header, rather than relying on the old anonymous API. Mathematical modules can still be imported and tested directly without a database.

## Complete files

Added: `backend/src/auth/{index,security,store,delivery}.js`, `backend/src/models/{User,AuthSession,AuthRateLimit}.js`, `backend/src/engine/tests/auth.test.js`, test-only `support/{app,authStore}.js`, `frontend/src/components/AuthProvider.tsx`, `frontend/src/lib/api.ts`, and this guide.

Updated complete files: backend `src/server.js`, `src/models/Spot.js`, `package.json`, `.env.example`, and the existing API/math test imports; frontend `src/main.tsx`, `App.tsx`, `App.css`, `lib/navigation.ts`, `components/IcmPanel.tsx`, `TournamentSettingsPanel.tsx`, `RangeEditor.tsx`; root `README.MD` and `ROADMAP.md`. No source file needs removing.

## Verification and sources

Run `npm test` in backend and `npm run build` in frontend. The complete 320-test suite passes: all previous 302 math/API regressions, 13 account/security scenarios and five hosting/manual activation scenarios. Existing engine tests use an explicitly injected test identity fixture; this is not an environment flag or production auth bypass. Dedicated account tests exercise the real auth router/middleware with an in-memory repository.

Checks cover registration validation, scrypt, verification/replay/concurrency, pending/expired access denial, both verification channels, resend/expiry/attempt limits, rate limits, session rotation and 12-hour/30-day expiry, logout revocation, production cookie flags/HTTPS, CSRF/origins, ownership spoofing, two-user/legacy history isolation, provider failure and mocked provider request construction.

Real-browser checks cover registration, pending reload, wrong code/resend/confirmation, both channels, username/email login, persistent versus session-cookie attributes, re-login, private saved history, clearing the previous user's workspace, eight-page account layouts at 320/390/820/1440 and authenticated weighted-range/ICM/save/load workflows. No Atlas account data or real delivery provider was contacted during tests. Browser checks do not replace a physical-device or production delivery test.

Primary references used for the implementation:

- [OWASP Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html).
- [OWASP Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email).
- [Twilio Messages API](https://www.twilio.com/docs/messaging/api/message-resource).
