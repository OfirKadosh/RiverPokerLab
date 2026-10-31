# Steps 5–6: Exact equity, pot payouts and closing-call EV

This full project includes all previous stages, including the sticky desktop table and mobile layout. Replace the previous source tree with this complete copy, or compare complete files before merging your own later edits. Keep your own `backend/.env`; credentials and installed dependencies are excluded. No source file needs to be deleted individually. No database migration is required.

## Start

1. Run `npm ci` in both `backend` and `frontend`.
2. Restore your MongoDB URI in `backend/.env` using `.env.example` as a guide.
3. In `backend`, run `node src/server.js`.
4. In `frontend`, run `npm run dev`.

## Calculation method

The analysis panel offers **Auto**, **Exact**, and **Monte Carlo**. Auto selects exhaustive enumeration only within a bounded work/search budget; otherwise it samples. The status reports the actual method and number of evaluated legal states or samples. The automatic MC budget is 1,000 samples; manual calculations and saves use 5,000. Exact ignores that sample budget and enumerates all accepted states.

For two fixed Hold'em hands, a flop has 990 unordered turn/river completions, a turn has 44 river completions, and a complete river has one state. Two fixed four-card Omaha hands on a flop have 820 completions. Counts decrease with additional players and dead cards. Folded hands/ranges remain blockers. Range enumeration is uniform over legal physical joint deals, not equally weighted hand classes.

Exact is intentionally bounded: at most 50,000 states and approximately 2,000,000 five-card evaluations, with a 250,000-edge joint-range search budget. Expensive preflop or wide range calculations produce a clear validation error when Exact is forced. Auto falls back to Monte Carlo. These are application work limits, not mathematical limitations. Range compatibility and Monte Carlo rejection sampling retain their own safeguards.

## Pot payouts

Start the hand builder to obtain contribution-aware pot accounting. Once no further betting is possible, each pot is evaluated against only its eligible live players. Folded contributions stay in the pot. A player can have zero shared showdown equity yet still win a side pot; equity percentages and per-pot payouts therefore remain separate concepts.

Choose **Smallest chip** to set the unit used for odd-chip splitting. Blinds, starting stacks, wagers and pots must be compatible with that unit when payout analysis is requested. Amounts use at most two decimal places. Each tied pot is split into whole chip units; odd chips go clockwise after the dealer among tied winners. This project uses that defined rule; no suit-based tie breaker is used.

- Unknown board cards or range hands: expected payouts and expected ending stacks.
- Completed showdown with specific hands: final settlement and final table stacks.
- Uncontested hand: the award already recorded by the ledger, without awarding it twice.
- Future betting remains: an explanation that payout EV is unavailable.

Expectation calculations do not mutate the ledger or commit projected chips. Final table stacks are a presentation of the derived settlement; Undo replays the original action ledger and invalidates the result.

## Hero: Fold versus Call

Select the player currently facing a wager as Hero, then press **Analyze Hero · Fold vs Call**. Analysis is supported only if calling closes all remaining betting, such as a closing all-in call or a river call that completes the action. If additional betting is possible, the panel explains why the comparison is unavailable.

`Call EV = chips behind after calling + expected eligible pot payout − chips behind before calling`.

Fold EV is zero relative to the current decision: previous contributions are sunk. The engine uses all main/side-pot entitlements and refunds. This is chip EV in both Cash and Tournament modes. Monte Carlo results include a standard error and approximate 95% interval; fewer than 30 samples or an interval covering zero produces **Uncertain**. Exact enumeration removes sampling error but does not remove uncertainty about the correctness of the supplied ranges.

No ICM, bounties, rake, action-dependent range updates, fold-equity model, bet/raise optimization, GTO strategy or action frequencies are implemented. A profitable Call compared with Fold does not establish that Call is optimal among every possible raise.

## Saving and compatibility

Save stores the selected method, smallest chip and payout summary with the existing spot data. If a decision analysis is currently displayed, saving recalculates and stores it too. Loading restores settings, cards and action history, then recalculates equity/payouts; press the analysis button again for a fresh decision comparison. Older spots default to Monte Carlo and chip unit 0.01.

`POST /api/calculate` accepts optional `calculationMethod` (`auto`, `exact`, `monteCarlo`), `chipUnit`, and boolean `includeDecisionAnalysis`. Existing clients default to Monte Carlo and keep their existing response fields. Added fields include `method`, `samples`, `enumeration`, `payoutSummary`, and optionally `decisionAnalysis`. `POST /api/analyze-decision` accepts the same spot/ledger inputs and returns `{ success, analysis }` without saving. Unsupported strategic scope returns `available: false`; malformed input returns HTTP 400. The old `evResults` formula remains only for compatibility and is not used by the new decision panel.

## Complete files added

- `backend/src/engine/exact.js`
- `backend/src/engine/payouts.js`
- `backend/src/engine/analysis.js`
- `backend/src/engine/tests/payoutAnalysis.test.js`
- `backend/src/engine/tests/analysisApi.test.js`
- `frontend/src/components/OutcomePanel.tsx`
- This guide.

Complete files updated: backend `engine/engine.js`, `engine/rangeSampler.js`, `server.js`, `models/Spot.js`; frontend `App.tsx`, `App.css`, `lib/poker.ts`, `components/BettingPanel.tsx`; root `README.MD`.

## Verification

From `backend` (explicit filenames also work in PowerShell):

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js src/engine/tests/handSetup.test.js src/engine/tests/betting.test.js src/engine/tests/payoutAnalysis.test.js src/engine/tests/analysisApi.test.js
```

From `frontend`: `npm run build`.

209 backend tests passed, including all 193 tests from stage 4.2. The frontend production build passed. Real-browser checks passed for the existing betting/sticky workflows and the new settings, Auto fallback, decision analysis, save/load, stale-result invalidation, final river settlement, forced-Exact error recovery, and layouts at 320/390/820/1440 pixels.

API persistence tests use mocks; browser flows use the real calculation engine with in-memory history and no connection to the live MongoDB database. Responsive viewport checks do not replace testing on a physical phone. The package does not deploy hosting.
