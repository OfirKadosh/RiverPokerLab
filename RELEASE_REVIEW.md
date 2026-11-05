# Next beta update — review before deployment

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

The source is cumulative on `step-13-2-tournament-decisions`. Draft PRs are stacked on their preceding development branches; they are not separate production deployments. Existing `main` and the Render deployment were not modified during these stages.

## Before approving the combined release

- [ ] Owner reviews the new River tree and Turn tree screens locally, including phone-sized layout, loading, cancel and page navigation.
- [ ] Review both ICM bubble examples, explicit field/response assumptions, action deltas, zero-reach labels, and pending-request cancellation.
- [ ] Run the cumulative `npm test` and `npm run build` on the final release candidate; record its exact commit and results.
- [ ] Review the final diff against the current production branch, including any independent production changes since development began.
- [ ] Verify authenticated normal-user/admin flows, manual activation, logout/remember-me, and separate histories for two users in an authenticated test environment. Database-free UI preview alone does not validate a deployed account integration.
- [ ] Confirm production build uses the normal mode, with preview login bypass unavailable, and current runtime/environment settings still valid.
- [ ] Confirm the intended Render branch/revision and return-to-previous-revision procedure before rollout.
- [ ] Owner approves the feature scope and deployment. Only then prepare the combined merge/release and deploy.

After deployment, smoke-test login, private history, one ordinary equity calculation, the river analytic reference, the small turn example and cancellation. Confirm the live revision and logs. Resource measurements from development are not promises of Render execution speed.

## Current product limits for release notes

River strategy and the new turn game are heads-up Hold'em cash abstractions. They do not provide unrestricted/full-game GTO, Omaha strategy, tournament ICM strategy, flop strategy or general re-raise trees. Existing Omaha equity and tournament/ICM tools keep their own supported scopes. The turn abstraction permits one opening size per street plus optional all-in, with no raises.

Background tasks/results live in bounded process memory and can be lost on restart or free-host sleep. They are distinct from saved MongoDB spot history. Worksheets are not automatically restored after browser reload. No email/SMS provider, payment service or additional paid infrastructure is introduced by this update.

## Work after this update

Stage 14 (formerly 13.3) adds the native shell and platform authentication/lifecycle integration after the second beta. Stages through 13.2 are the current beta candidate scope; the owner must approve rollout. Tester feedback, broader solver games and durable/shared job storage can follow separately.
