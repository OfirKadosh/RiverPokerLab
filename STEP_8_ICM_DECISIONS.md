# Stage 8: Outcome-weighted ICM Fold/Call analysis and saved tournament settings

This full source package includes all previous stages, including the independent stage 7 calculator. Trial deployment remains the agreed milestone at the end of stage 9. Nothing is deployed in this stage.

## Replace and run

Extract the complete project into a fresh folder. Preserve your own `backend/.env` and any private modifications before replacing old source. Run `npm ci` in `backend` and `frontend`; start `node src/server.js` in `backend` and `npm run dev` in `frontend`. No new dependencies or database migration are required. All source files are provided in full; no individual file needs deleting.

New files:

- `backend/src/engine/tournament.js`: field validation, elimination ordering and terminal prize values.
- `backend/src/engine/icmDecision.js`: paired per-outcome ICM aggregation and sampling uncertainty.
- `backend/src/engine/tests/tournament.test.js`: 21 mathematical, scope, precision, budget and API tests.
- `frontend/src/components/TournamentSettingsPanel.tsx`.
- `frontend/src/components/IcmDecisionResult.tsx`.
- This guide.

Complete updated files: backend `engine/engine.js`, `engine/analysis.js`, `server.js`, `models/Spot.js`; frontend `App.tsx`, `App.css`, `lib/poker.ts`, `components/OutcomePanel.tsx`, `components/IcmPanel.tsx`; root `README.MD` and `ROADMAP.md`.

## Workflow

1. Choose **Tournament**, add the players at the current table, and configure their hand-start stacks and blinds.
2. In **Tournament decision settings**, enter all remaining prizes, from first to last. Use a single currency or abstract prize unit, no currency symbols or thousands separators, and up to two decimals. Include guaranteed cash still owed to remaining players; exclude prizes already awarded. Unlisted last places receive zero.
3. Add players at other tables with their current positive stacks. The full remaining field, including the current table, must contain 2–9 players. Unknown outside hands do not need to be entered; those players do not act during this hand and their stacks stay fixed.
4. Confirm that the field and prizes are complete, then **Apply tournament settings**. Every table seat, including a folded player, is part of the tournament field.
5. Start/continue the hand builder. Select the player facing the current wager as Hero. Enter complete hands or valid unweighted Hold'em ranges for every table player.
6. Press **Analyze Hero · Fold vs Call**. Chip EV is available under the existing closing-call scope. Monetary ICM additionally requires both the hypothetical Call and Fold branches to close all remaining betting. Unsupported branches produce an explanation; no betting strategy is invented.
7. Read **ICM prize EV** separately from **Chip EV**. Expand expected values for all players and the outcome breakdown to inspect the calculations.
8. **Save spot to history** stores normalized applied tournament settings. If decision analysis is currently displayed, it is recomputed and saved too. Loading restores the settings, stacks, cards and action history. Equity/payouts are recomputed automatically; press Analyze again for fresh ICM decisions.

Editing the tournament form invalidates displayed decisions and blocks calculations/saving until settings are applied or **Use Chip EV only** is selected. Changing table seats or hand-start stacks requires reapplication. Settings are linked to stable seat IDs and hand-start stacks, not player array guesses or chips behind. Draft form edits are not persisted; only applied settings are saved with a spot. Switching away from the setup tab discards unapplied local form text, and may require reapplying the restored settings.

The independent **Tournament ICM** worksheet remains available below. Its own editable examples are separate and are not saved or automatically used as decision settings.

## Correct monetary comparison

The engine uses the same legal physical deal/runout for each Call/Fold pair. It settles each branch's main and side pots against that branch's live eligible players. Hero's folded cards/range remain blockers. Uncalled wagers are handled by the replay ledger. An uncontested Fold branch uses the already awarded ledger stacks and does not award the pot twice.

For every branch outcome:

1. Construct the complete final stack vector, including fixed outside stacks.
2. Assign prizes to players eliminated in this hand, using the explicit elimination rule below.
3. Apply ICM to surviving positive stacks using only the top remaining prizes. A sole survivor receives first prize directly.
4. Add the fixed elimination awards and average each player's prize value across all outcomes.

`ICM advantage of Call = expected prize value after Call − expected prize value after Fold`.

Monetary Fold EV is generally nonzero. In multiway hands it can depend on the other players' showdown and resulting eliminations, even when Hero's own folded stack stays fixed. This engine evaluates that branch too. Applying ICM once to average ending stacks would give a different answer and is deliberately not used.

The Chip EV panel keeps its previous decision-time convention: earlier contributions are sunk and Fold EV is zero. Its numeric values are chips, not monetary prize values. The two panels can recommend different choices.

### Regression example

Three players start with 100 chips each and 1/2 blinds. Each contributes 2 preflop, then all check the flop. On turn `Jh Th 2c 8s`, P1 (`Ah Kh`) shoves 98, P2 (`5s 6s`) folds, and Hero P0 (`9s 9d`) faces Call 98. With prizes `50, 50, 0`, exhaustive enumeration checks 42 legal rivers. Hero wins on 24 rivers and loses on 18.

- Chip Call EV: approximately +17.428571 chips.
- Monetary Call value: approximately 28.571429 prize units.
- Monetary Fold value: approximately 32.924092 prize units.
- Monetary Call minus Fold: approximately -4.352664 prize units.

The Fold outcome stacks are 98/104/98. The Call outcomes are 202/0/98 or 0/202/98. This illustrates why a positive Chip EV call need not have positive ICM EV.

## Elimination rule

This version implements the explicit rule `starting-stack-split` for eliminations in the modeled hand:

- A player with more chips at the start of the hand finishes above another player eliminated in the same hand.
- Equal hand-start stacks tie and share the combined prizes for those places equally.
- Every surviving player finishes above every player eliminated in that hand.
- Guaranteed cash and elimination prizes are included once, not discarded when a stack reaches zero.

This rule is consistent with the [PokerStars simultaneous-elimination explanation](https://www.pokerstars.com/help/articles/rules-table-master/213164/). It is a defined application rule, not a claim to implement every tournament's house procedures. Antes are not modeled. Eliminations or chip changes on other tables during this hand are outside this version's scope. Shared prize values are mathematical amounts and can contain fractions smaller than a currency cent; real-world payout rounding is not simulated. Odd tournament chips are still resolved separately by the existing per-pot clockwise chip rule.

[ICMIZER's calculation explanation](https://www.icmizer.com/en/blog/how-icmizer-makes-icm-calculations/) describes evaluating result stacks separately and weighting their monetary values by outcome probabilities. This package implements that outcome-weighting principle for its explicitly supported Call/Fold scope.

## Exact, Monte Carlo and limits

The underlying card method remains Auto/Exact/Monte Carlo. Exact uses all accepted legal states within the existing enumeration budget; Monte Carlo estimates outcome frequencies. Every ICM snapshot uses exact subset DP within floating-point precision.

Monte Carlo error for the monetary advantage is measured on the paired Call-minus-Fold observations, including their covariance. The panel reports a paired standard error and approximate 95% interval. Fewer than 30 observations or an interval covering zero produces **Uncertain**. Exact enumeration has no sampling interval; supplied ranges and the ICM model still have real-world limitations.

Unique terminal ICM valuations are cached. At most 4,096 distinct stack vectors can be valued per decision; exceeding that limit produces a structured validation error and no partial decision. The response/UI shows up to 12 most frequent paired outcome groups, with an explicit truncation flag; expected values and uncertainty include every observation, not just displayed rows.

Configured ranges remain unweighted priors and are not updated by the Fold/Call action. Stage 9 will add explicit weighted/action-specific range inputs. No rake, bounties, future-game simulation, skill adjustment, bet/raise optimization, GTO frequencies or unrestricted multi-street strategic solver is included. The comparison only establishes which of Fold and Call is better under the supplied assumptions.

## API and storage

`POST /api/calculate` and `POST /api/analyze-decision` accept optional `tournament` settings alongside the existing spot inputs:

```json
{
  "fieldConfirmed": true,
  "eliminationRule": "starting-stack-split",
  "tableSeats": [
    { "seatId": 0, "startingStack": 100 },
    { "seatId": 4, "startingStack": 100 }
  ],
  "otherPlayers": [{ "name": "Outside player", "stack": 50 }],
  "payouts": [50, 30, 20]
}
```

The `tableSeats` order must match validated `tableState.seats`; IDs and starting stacks must agree exactly. Settings require Tournament mode and table metadata. The full field and prizes reuse stage 7 numeric and ordering validation. Unsupported/malformed settings return HTTP 400.

When analysis is requested and in scope, `decisionAnalysis.icm` contains `available`, `model`, `unit: "prize-units"`, `method`, `samples`, `decision`, `expectedCallPrize`, `expectedFoldPrize`, `deltaCallVsFold`, `standardError`, `confidence95`, per-player expected values and grouped outcomes. Existing root `decisionAnalysis.callEV`/`foldEV` fields retain chip units for compatibility. Missing settings preserve legacy chip analysis and provide an explicit unavailable ICM message. Cash-mode responses do not include monetary ICM analysis.

Saved spots add optional typed `tournament` metadata. Existing `decisionAnalysis` storage retains the monetary result when requested. Legacy records remain loadable with no migration; they have no tournament settings until explicitly applied. No historical spot is rewritten or automatically assigned default prizes.

## Verification

From `backend` (explicit filenames work in PowerShell):

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js src/engine/tests/handSetup.test.js src/engine/tests/betting.test.js src/engine/tests/payoutAnalysis.test.js src/engine/tests/analysisApi.test.js src/engine/tests/icm.test.js src/engine/tests/tournament.test.js
```

From `frontend`: `npm run build`.

270 backend tests pass, including the previous 249. New checks include chip/ICM disagreement, separate side-pot outcomes, stochastic Fold values, elimination cash, simultaneous equal-stack ties, nine-player full fields, exact Omaha river analysis, paired MC uncertainty, explicit budget failure, validation and persistence through a mocked API.

Real-browser checks use the real engine with in-memory history and no Atlas connection. They cover settings application, monetary results, save/restore, invalid settings recovery, outside players, stale-result invalidation, reapplication after stack changes and widths 320/390/820/1440. Existing standalone ICM and Exact/payout/Chip EV browser flows are also checked. Physical phones, real MongoDB operations and public hosting are not part of these checks.
