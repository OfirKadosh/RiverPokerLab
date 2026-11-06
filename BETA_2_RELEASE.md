# Second beta — release candidate

Candidate branch: `release/beta-2`. Feature baseline: `085b39b8f365cae31d3d6b72fce4ae4e7ae24a50` (stage 13.2). Production branch baseline reviewed: `c315d22b323f642bf3eb14cafd5301f823fb4806` (`main`). The candidate contains all eight development commits after that baseline. No divergent production commits were present at review.

This is a prepared candidate, not a deployed release. The final candidate commit is the head of the consolidated pull request into `main`; that PR records the exact revision. Merge and deployment still require owner approval. No release tag or automatic merge is enabled.

## Included changes

- Account-compatible admin provisioning and a local read-only UI preview without login or Atlas. Existing users, manually activated accounts and private history remain supported.
- Restricted heads-up Hold'em river tree, exact weighted payoffs, CFR strategy frequencies, per-combo/action chip EV, and measured restricted exploitability.
- Temporary owner-scoped background solver jobs, progress, cancellation, navigation continuity, bounded queue/result retention and compiled river traversal.
- A bounded turn-to-river cash game with all legal river runouts and hidden-future-safe strategies.
- Outcome-weighted tournament ICM action comparisons for both streets, entire remaining field/prizes, explicit fixed responses, combo overrides, reached/counterfactual labels, and separate chip/prize values.
- Shared portable contracts and API/job client. The native shell formerly planned as 13.3 is deferred to stage 14, after this beta.
- `npm run setup` installs both locked dependency sets, including the local shared core package. `npm run release:check` runs tests, core type checking and the production build.

The existing equity, weighted ranges, Omaha High evaluation, table/betting tools and saved-spot history remain part of the cumulative application.

## Local review / fresh checkout

Use Node 22 (the Render target) or another supported Node version (>=22 and <25). From a clean working tree:

```powershell
git fetch origin
git switch release/beta-2
npm run setup
npm run release:check
npm run preview:dev
```

Keep the preview terminal running and open the printed localhost address. Preview does not connect to Atlas, sign users in, save history or modify accounts. Use the normal authenticated production build for account checks. The setup command uses `npm ci`, so it replaces installed dependencies to match lockfiles. It does not modify application settings, environment files or database records.

If switching branches would overwrite local work, preserve that work before switching. Do not discard local changes as part of this procedure.

## Validation and scope of evidence

- Owner reported the solver checks completed successfully before this release preparation.
- All 518 automated tests pass: 27 core, 481 backend and 10 frontend. These include hosted HTTPS/CSRF cookie semantics, manual activation, administrator login, per-user private history, session rotation/expiry/logout, queue limits and solver mathematics. Database adapters are exercised with isolated in-memory fixtures; no production Atlas credentials or writes are used.
- A fresh dependency install and full release check are run with Node 22.23.4. The same locked dependencies and normal Vite production build are used; no preview-mode deployment artifact is created.
- Production-build authenticated Chromium exercises login failure/success, remember-me, analytic river strategy, turn background navigation/result retention, logout, protected routes and responsive layouts. Additional ICM browser checks cover both bubble examples, action deltas, combo/full-field panels, exact river navigation, loading, confirmation, invalidation and navigation cancellation.
- Public-source changes are reviewed against the production branch. No new runtime environment variables, paid provider, new database collection, destructive migration or native runtime is required. The existing admin account must not be recreated. Native bearer tokens/offline solving remain unsupported.

These checks do not replace a smoke test of the actual Render revision, live Atlas indexes/configuration or the owner confirming the current deployed revision. Those checks are performed as part of an approved rollout.

## Diff and installation review

The feature baseline changes 82 files relative to the reviewed `main` baseline, spanning eight feature commits. The release-preparation changes add only setup/check commands and release documentation; no solver/auth/database behavior or production deployment setting is changed by this preparation. No direct dependency versions are upgraded. The backend/frontend lockfiles already include the private `file:../packages/core` dependency introduced in stage 13.1. That is why both dependency sets must be reinstalled after checkout.

Node 22.23.4 fresh setup installed 87 backend packages and 136 frontend packages. The complete check passed with 27 core, 481 backend and 10 frontend tests, followed by DOM-free core type checking and the normal Vite production build. The setup itself was exercised on a directory without node_modules or local environment files.

## Release limits to communicate to testers

1. River and turn strategic solving are restricted heads-up Hold'em cash games, not unrestricted GTO, Omaha strategy, flop strategy or general multi-way strategy. Quality metrics apply only inside the configured tree.
2. Tournament action preferences are exact evaluation under supplied fixed response weights, not an ICM equilibrium/GTO strategy. Weights vary by street/own combo/legal action, not automatically by texture or pot odds. The full remaining field supports 2–9 players. Only the two active players may have funded the modeled starting pot; outside stacks remain fixed. No bounties or rake.
3. Work, range, memory, queue and retained-result limits reject oversized requests explicitly. Free-host performance and idle wake-up may add delay; a development timing is not a Render speed promise.
4. Jobs/results live in process memory and can be lost after restart or idle sleep. Worksheets survive page navigation within a session, not browser reload. They are separate from saved MongoDB history. Pending fixed-policy ICM requests cancel when leaving the worksheet.
5. Registration remains open with the existing manual activation flow. Automated email/SMS delivery and billing are not enabled.

## Approved rollout procedure (not executed during preparation)

1. Recheck the candidate PR head and `main`. If either changed, rerun the affected review/checks; do not deploy an unreviewed revision.
2. Record the actual currently deployed Render commit from its dashboard and confirm it is available for rollback. The production branch baseline above is not proof of the live deployed revision. Check database backup/recovery availability using the existing Atlas account; no database change is requested by this release.
3. Confirm the existing service uses Node 22, repository root, same-origin `/api`, production authentication, existing Atlas URI and `AUTH_SECRET`. Preserve these values and manual-delivery settings. Do not copy a local `.env` or enable a development/preview bypass. No new secret needs to be shared in chat.
4. After explicit owner approval, merge the consolidated release PR into `main` and record the resulting merge SHA. The blueprint sets automatic deployment off; confirm the actual service setting before merging because dashboard settings can differ from the blueprint.
5. Deploy that reviewed `main` revision explicitly in Render. Keep the existing build command:

   ```bash
   npm --prefix backend ci --omit=dev && npm --prefix frontend ci --include=dev && npm run build
   ```

   Start command stays `npm start`; readiness path stays `/healthz`.
6. Confirm the deploy succeeded, the live commit matches the approved merge, `/healthz` is ready, and logs contain no startup/index/import errors. Existing processes may keep serving during a normal replacement, but session requests/jobs can be interrupted by restarts; do not promise uninterrupted calculations.
7. Smoke-test normal-user/admin login, remember-me/logout, manual activation, two separate histories, one equity calculation, the three-hand river benchmark, the small turn game/background cancellation, and both ICM examples on the actual site. Do not publish tester credentials or private log codes.

## Rollback

If startup/auth/history or calculations regress, use Render's rollback/redeploy for the **recorded prior deployed commit**, without changing Atlas URI, `AUTH_SECRET` or deleting user/history data. Confirm readiness, login and history again. A later automatic deployment must not silently reinstall the bad revision: keep deployment controls explicit until corrected code is reviewed.

This candidate introduces no destructive data migration and keeps existing saved-spot shapes. Rollback does not recover in-memory solver jobs, which must be rerun. If a real database issue occurs, investigate it separately rather than clearing collections or assuming a code rollback repairs data.

## Next decision

The candidate is prepared for the owner's release approval. No merge, tag or Render deployment is included in the preparation task. Stage 14 starts separately after the second beta and feedback.
