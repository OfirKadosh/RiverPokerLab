# Second beta — consolidated release review

The cumulative development through stage 13.2 is available for owner review for the second beta. The native shell formerly planned as 13.3 is deferred to stage 14 and does not block this beta. This document does not authorize or perform a merge, release tag, environment change or deployment. The owner will inspect the cumulative result before approving rollout.

## Included in the proposed update

- Loading feedback and transitions, isolated development, bounded CPU workers and local UI preview.
- Admin/account compatibility already covered by the development branches; existing manual activation and private per-user history.
- Restricted river tree, CFR average strategies, per-combo action EV, exact restricted best responses and measured convergence.
- Background jobs with real progress, cancellation, ownership and bounded temporary retention.
- Compiled river traversal, recorded before/after benchmarks, larger bounded ranges and resource feedback.
- Portable shared contracts/API/job client, explicit valuation metadata and authenticated capability discovery. Native token support remains disabled; fixed-response tournament action valuation has its own prize-unit contract.
- Outcome-weighted turn/river ICM action comparison with the complete field, explicit fixed responses, off-path labels and side-by-side chip/prize values.
- Bounded turn-and-river strategy with all legal runouts, correct private-information/chance handling, and a separate navigation workspace.

The prepared release candidate is cumulative on `release/beta-2`, based on `step-13-2-tournament-decisions`. See `BETA_2_RELEASE.md` for the full release notes, validation and rollout/rollback procedure. Draft PRs are stacked on their preceding development branches; they are not separate production deployments. Existing `main` and the Render deployment were not modified during these stages.

## Before approving the combined release

- [x] Owner reported successful local solver checks. Authenticated browser checks cover navigation, loading/cancellation and phone-sized layouts; live deployment checks remain pending.
- [x] Both ICM examples and response/field semantics checked with automated engine/API and authenticated-browser checks, including off-path labels and cancellation.
- [x] Fresh Node 22 install and `npm run release:check`: 518 tests, core typecheck and normal production build. Exact candidate revision is recorded by the consolidated PR head.
- [x] Cumulative diff reviewed against `main` baseline `c315d22b323f642bf3eb14cafd5301f823fb4806`: eight feature commits ahead, no divergence at preparation. Recheck before merge.
- [x] Authenticated fixture tests cover normal-user/admin login, manual activation, logout/remember-me and separate histories; production-build browser smoke checks also pass. Live Atlas/Render smoke testing remains required after approved deployment.
- [ ] Confirm production build uses the normal mode, with preview login bypass unavailable, and current runtime/environment settings still valid.
- [ ] Confirm the intended Render branch/revision and return-to-previous-revision procedure before rollout.
- [ ] Owner approves the feature scope and deployment. Only then prepare the combined merge/release and deploy.

After deployment, smoke-test login, private history, one ordinary equity calculation, the river analytic reference, the small turn example and cancellation. Confirm the live revision and logs. Resource measurements from development are not promises of Render execution speed.

## Current product limits for release notes

River strategy and the new turn game are heads-up Hold'em cash abstractions. They do not provide unrestricted/full-game GTO, Omaha strategy, tournament ICM strategy, flop strategy or general re-raise trees. Existing Omaha equity and tournament/ICM tools keep their own supported scopes. The turn abstraction permits one opening size per street plus optional all-in, with no raises.

Background tasks/results live in bounded process memory and can be lost on restart or free-host sleep. They are distinct from saved MongoDB spot history. Worksheets are not automatically restored after browser reload. No email/SMS provider, payment service or additional paid infrastructure is introduced by this update.

## Work after this update

Stage 14 (formerly 13.3) adds the native shell and platform authentication/lifecycle integration after the second beta. Stages through 13.2 are the current beta candidate scope; the owner must approve rollout. Tester feedback, broader solver games and durable/shared job storage can follow separately.
