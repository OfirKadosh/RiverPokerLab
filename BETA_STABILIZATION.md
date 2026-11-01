# Beta stabilization and loading transitions

This is a complete cumulative update developed on `beta-stabilization-transitions`. The existing personal trial at https://river-poker-lab.onrender.com/ stays on its current `main` revision. This branch has not been merged or deployed and no production database, account, billing or hosting setting was modified.

## Loading and navigation

- A shared animated spade/ring and a status label indicate real pending work: session checks, sign-in/registration/activation, equity calculations, saving, history, ICM, tournament settings, range previews and lazy views.
- Navigating to a different page presents an approximately 500ms opening state followed by a gentle content entrance. The table stays stable when switching among table workspaces; editable drafts remain in the existing parent state.
- Requests start immediately. Successful requests shorter than 500ms are held only for the remaining part of that interval, preventing a flash. Longer requests are not delayed for another half-second. Existing typing/debounce intervals still apply before automatic requests start. Background session refreshes do not receive an artificial delay.
- Errors appear immediately. Cancellation clears timers, and replaced/unmounted requests cannot publish stale calculation/history/ICM/range results. Duplicate action buttons remain disabled during pending work. Empty history is not shown while history is still loading.
- The operating system/browser reduced-motion preference disables the new movement and skips artificial waits. Status text and disabled controls still communicate pending work.
- Fast navigation, Back/Forward and external hashes still use the current route. Switching pages does not intentionally recalculate an unchanged spot or discard its parent-owned drafts.

The indicators are indeterminate: no fabricated completion percentage is shown. A pending response can include waiting in the server queue. The app does not claim to know which iteration is currently running.

## Background calculation worker

All authenticated calculation routes (`/api/calculate`, `/api/analyze-decision`, `/api/icm`, `/api/ranges/preview`) send the expensive math to one persistent Node Worker thread per application process. Authentication, request validation, session lookup and owner-scoped persistence stay on the main thread. The HTTP request still returns the same result shape; no extra polling protocol or database job collection is required. The worker runs pure engine code and receives no session/provider credentials or database connection environment.

- One CPU task runs at a time; at most eight wait, with at most four outstanding tasks per authenticated user.
- A task's 45-second deadline includes queue time. A full queue returns a retryable HTTP 503; timeout returns 504. Both expose a clear error and Retry-After header.
- Disconnecting a request removes a waiting task or terminates the active computation. A replacement worker can handle later work. No spot is persisted after a cancelled computation returns. A database write that has already begun cannot be undone by closing the browser; refresh History before retrying a save whose acknowledgment was lost.
- Worker error, timeout, cancellation and shutdown settle waiting promises rather than leaving a spinner waiting indefinitely. Queued jobs are memory-only; a server restart loses them and clients must retry. User records, sessions and completed saved spots remain in Atlas.
- The worker has a 128MiB old-generation heap limit. Password hashing retains its existing separate bounded scrypt queue. The service still shares CPU and RAM, so this improves responsiveness rather than guaranteeing a particular throughput on Free hosting.

Main-thread parsing, validation, JSON serialization and database operations are still necessary. This is not a distributed job system, unlimited parallel calculation service or a strategic GTO solver.

## Mongoose compatibility

All five account-store `findOneAndUpdate` option objects now use `returnDocument: "after"`, replacing deprecated `new: true` with the same return-after-update behavior. Atomic challenge conditions, expiry, rates and ownership logic remain unchanged. No migration or data rewrite is needed. The live warning disappears only after this update is actually deployed.

## Isolated local development

1. Download/clone the full development branch. Keep the current live deployment linked to `main`.
2. Install dependencies with `npm --prefix backend ci` and `npm --prefix frontend ci` from the repository root.
3. Copy `backend/.env.development.example` to `backend/.env.development` (the latter is ignored by Git). Put a development Atlas URI and a newly generated private AUTH_SECRET in that file. Prefer a separate Atlas database user restricted to `river_poker_lab_dev`. Confirm that the production app is not using this development database name.
4. Start the backend with `npm run dev:backend`. This launcher requires that specific file, does not fall back to the live `.env`, forces NODE_ENV=development and selects `river_poker_lab_dev` even if the URI contains another database name. It does not copy production data or create tester accounts for you. A database user without access to that development database will fail instead of writing into its URI's production database.
5. Start the frontend in another terminal with `npm run dev:frontend`. Vite forwards relative `/api` requests to the local backend. Do not set VITE_API_URL to the live site during development.

`npm start` is still the production-compatible command and reads the existing deployment settings. Use the new development launcher for local work. No live connection string or secret was fetched, entered or changed during implementation. There is no production-to-development data migration.

## Validation

- 325 backend tests passed, including the prior 320 regressions and five real-worker/queue/HTTP scenarios.
- Frontend production build passed.
- Worker checks cover exact equity, ICM/range transfer, validation errors, global/user queue caps, queued and active cancellation, timeout/crash recovery, shutdown, health/session responses during CPU work, retryable overload, and disconnect-before-persistence.
- Browser checks cover the half-second route state, slow-request indicators, duplicate-submit disabling, retained ICM drafts, stale cancellation, rapid navigation and Back/Forward, reduced motion, immediate errors, and 320/390/820/1440 widths.
- The built client was checked through a local HTTPS reverse proxy with real account middleware: manual activation, Secure/HttpOnly cookies, private equity/save/history and logout passed using an in-memory store.
- The existing weighted ranges, exact/ICM, save/load, matrix and Omaha scope browser regression passed.
- The development launcher was checked to refuse startup without its dedicated environment file. No Atlas user/database was provisioned or contacted for these tests.

Representative one-off local Node 24 worker timings were about 152ms for the two-hand 990-runout Hold'em flop, 73ms for 1,000 preflop Hold'em samples and 203ms for 1,000 preflop Omaha samples. The first includes worker startup. These are development-machine observations, not Render Free performance or a concurrency SLA. Recheck on hosting when deploying this revision.

## Review and rollout

Review the branch/PR and run it against the development database. Merge into `main` only when ready, then explicitly deploy that reviewed commit in Render. Check that automatic deployment is still disabled in the live service. This update does not perform the merge or deployment. A free-service restart/redeploy can briefly interrupt requests; persistent data remains in Atlas. A separate staging Render service would require its own development database credentials and is not created here.

Added complete files: `frontend/src/lib/loading.ts`, `frontend/src/components/LoadingIndicator.tsx`, `backend/src/compute/{tasks,worker,pool}.js`, `backend/scripts/dev.js`, `backend/.env.development.example`, `backend/src/engine/tests/compute.test.js`, test-only `support/computeWorker.js`, and this guide. Existing server/account store, task-using UI panels, package scripts/lock metadata, README, roadmap and deployment guide are updated. No source file needs deleting. The branch ZIP contains the entire project.

Primary API references: [Node Worker threads](https://nodejs.org/api/worker_threads.html), [Mongoose update options](https://mongoosejs.com/docs/api/query.html), [reduced-motion preference](https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion).
