# Production admin and local UI preview

This cumulative source update adds a contact-free administrator account provisioning command and a local UI-only preview mode. It is on `beta-stabilization-transitions`, together with the pending stabilization update. No merge, live deployment, real administrator creation or production database operation was performed by this development session. The owner must enter private credentials/password in their own terminal for the one-time production account creation.

## One-time production admin

From a local checkout of this branch, install backend dependencies if needed, then run:

```bash
npm --prefix backend ci
npm run admin:create -- --production
```

Use an ordinary interactive terminal such as VS Code Terminal, PowerShell or Terminal. This does not require a paid Render Shell, a new email address or an SMS provider. Do not put a password or URI in command arguments, shell history, source code or chat.

The command:

1. Requires the explicit `--production` argument. It refuses password arguments and piped/noninteractive input.
2. Uses MONGO_URI from the terminal/server environment only if already present; otherwise prompts for the production MongoDB URI with echo disabled. It does **not** load `.env` or `.env.development` implicitly.
3. Uses APP_DATABASE_NAME when present, otherwise the database named in the URI. If neither supplies a database, it asks for the exact live database name instead of guessing. Match the current Render application's actual database selection; older URI-only deployments with no database path may have used the driver's `test` default. Check Atlas before choosing.
4. Displays only the target hostname and database name for review, never the URI or database password.
5. Asks for the admin password twice with input hidden. The usual 15–128-character, up-to-512-byte policy applies; spaces/Unicode are supported. No default password exists.
6. Connects to that selected database and inserts only the `admin` user if the name is available. It stores the normal salted scrypt hash, `role: admin` and an explicit account approval time. Email and phone are omitted and remain unverified. It creates no browser session and sends no code/message.

After success, sign in to the live site using **admin** and the password you chose. The current live authentication flow already accepts explicitly approved users by username and does not require contact verification for such an account, so this insertion is compatible with the existing main release. The new role/contact display becomes available when this source update is deployed.

The existing Atlas Network Access rules must allow the computer running this command. Keep the connection URI private and use the same database as the live service. An Atlas connection error should be corrected there, rather than sending credentials through chat.

Repeated runs do not change an existing admin's password or history. If a normal account already owns `admin`, the command refuses to promote/overwrite it. Concurrent duplicate creation is handled without resetting an account. Public registration reserves `admin` case-insensitively once this source is deployed and ignores incoming role fields. Existing users keep normal member behavior. A password reset/recovery command is not added by this update; retain your chosen password securely.

The role does not add a user-management dashboard or grant access to other users' saved spots. Existing APIs still enforce owner-scoped history. No contact is falsely marked verified, and normal users still need contact details plus activation. The unchanged unique email/phone indexes permit one missing-contact record, fitting this single admin request; no indexes are dropped or rewritten. If another missing-contact record conflicts, provisioning fails without modifying it.

## Local screens without signing in

From the full branch checkout:

```bash
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Open the local URL printed by Vite, normally `http://127.0.0.1:5173`. No backend startup, AUTH_SECRET, MongoDB URI, Atlas database or registration is needed for this mode.

The Vite development server mounts a dedicated local Express adapter for `/api`. It supplies an ephemeral `UI Preview` identity, real math through the existing compute worker and empty in-memory history responses. All eight screens, card selection, betting UI, ranges, equity and ICM can be explored. Drafts stay in memory for the current browser session, as before; a reload can clear them. A permanent banner identifies the preview.

Saving is disabled in the UI and rejected by the adapter. Registration, login, logout and other account mutations are rejected. No real user/session or saved spot is created. For testing accounts and persistence, use the separate authenticated development workflow documented in BETA_STABILIZATION.md.

## Production isolation

- The adapter is mounted only by Vite's `serve` command in `ui-preview` mode, never by the production Express entry point.
- Its constructor refuses non-development or Render-hosted environments. It checks loopback client/host, exact same-origin requests and cross-site browser headers.
- The preview server binds to loopback. It has no proxy fallback to the normal backend. VITE_API_URL is forced to local `/api` for this mode, even if a local frontend environment file contains another API address.
- A production build in `ui-preview` mode is explicitly refused. The ordinary production build uses the normal API/authentication flow; setting a frontend preview flag cannot bypass production API authentication.
- The normal server does not create an admin at startup or read a default admin password. Only the interactive, explicitly invoked provisioning command can create it.

## Validation and delivery

The complete backend suite passes **332 tests** (the prior 325 plus five admin/credential scenarios and two preview isolation/math scenarios). The production frontend build passes. Tests verify reserved-role handling, contact-free schema validation, production HTTPS admin login, missing/wrong-password protection, idempotent/refused provisioning, hidden terminal input/cancellation, rejected secret arguments, local preview identity, real ICM, rejected writes/account actions/origins and no database access.

A real browser opened all eight views in preview without running a backend or connecting to Atlas, performed real equity and ICM, checked disabled/forbidden saves, refreshed without a login gate and checked 320/390/1440 widths. A build with `--mode ui-preview` was rejected as intended. No real production admin was created by tests; test passwords and accounts are synthetic.

Added complete files: `backend/src/admin/provision.js`, `backend/scripts/{createAdmin,secretPrompt}.js`, `backend/src/dev/preview.js`, `backend/src/engine/tests/{admin,preview}.test.js` and this guide. Existing user/auth code, account/table UI, Vite configuration, package scripts and documentation are updated. No file needs deleting. Download the branch ZIP to get the full cumulative project.
