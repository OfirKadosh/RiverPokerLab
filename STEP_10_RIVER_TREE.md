# Stage 10 — Restricted heads-up river decision tree

Development branch: **step-10-river-decision-tree**, based on `beta-stabilization-transitions` at `79ec84779343d316365c3e9ab78e3ffe03b37904`. This complete branch includes the previous animations, worker queue, admin provisioning and local preview. It has not been merged or deployed. The live Render application and production data remain unchanged; feature development is accumulated for a later reviewed release.

## Run and review

From a clone of RiverPokerLab:

```bash
git fetch origin
git switch step-10-river-decision-tree
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Open the local URL printed by Vite and choose **River tree**. No account, backend startup or Atlas connection is needed in this local preview. Production API authentication stays mandatory. The new workspace is lazy loaded and uses the existing half-second loading feedback, card picker and range editor. Navigation now has nine views, with a three-column mobile/tablet layout; the desktop sticky table accounts for the taller tablet navigation.

## What this stage implements

- A standalone river-start worksheet for exactly two active players: OOP first and IP/button second.
- No-limit Hold'em cash Chip EV, with a complete five-card board, existing pot and actual stacks behind at river start.
- A specific two-card hand or a weighted Hold'em range for each player. Existing single-node action-prior profiles can explicitly condition a root range. They are not inferred from tree actions.
- Check/check, check/bet, bet/fold, bet/call, one optional raise and responses to that raise. At most one raise is allowed per betting sequence; no re-raises.
- Up to three opening bet percentages and two raise percentages, plus an optional effective-stack all-in action. Illegal below-minimum sizes are omitted with explanations.
- Exact terminal accounting: invested chips, uncalled refunds, contested awards, expected ending stacks and net change from river start. Split pots respect the configured smallest chip; OOP receives an odd split chip because IP is the button.
- A navigable tree outline, action buttons, ancestor breadcrumbs and separate node details. Drafts, the matching result and selected node survive page navigation, but are not saved to History or persisted across browser reloads.
- Fixed-hand and 25%/75% weighted examples. The optional copy action imports cards/ranges and pot from a two-player Hold'em cash free spot with a complete board. It does not import stacks or an action ledger; the user must identify OOP/IP and enter river-start stacks behind explicitly. Swap changes player order.

Omaha, tournament/ICM trees, additional streets, rake, side pots, outstanding river wagers and arbitrary action-ledger import are out of scope for this restricted abstraction. The application's existing Omaha, tournament and side-pot tools remain available on their original pages.

## Conditional payoffs are not solved action EVs

This stage builds the public betting structure and its terminal payoff model. It does **not** solve a strategy, response frequencies, exploitability or a recommended action. Decision nodes deliberately have no value or strategy field. The UI does not rank decisions by their terminal branch payoffs.

Private hands are drawn from the product of the supplied combo weights, conditioned on board/fixed-hand and mutual card collisions. Every branch uses this same input distribution. Selecting a Fold branch means assuming that particular fold happens; it does not infer how often an opponent folds or which combos they fold. Likewise a called bet's expected payoff under unchanged priors is not the EV of choosing Bet against a strategic opponent. The next stage will need private-hand information sets, strategy-dependent reach probabilities and convergence evidence.

For example, with pot 100 and OOP holding a certain winner:

| Path | OOP net from river | IP net from river |
| --- | ---: | ---: |
| Check / Check | +100 | 0 |
| Bet 50 / Fold | +100 | 0 |
| Bet 50 / Call | +150 | -50 |
| Bet 50 / Raise to 150 / Fold | -50 | +150 |
| Bet 50 / Raise to 150 / Call | +250 | -150 |

Those are conditional terminal payoffs, not a comparison of action EVs. No probability of a call/raise/fold was assumed.

## Sizing and accounting conventions

Money inputs must be safe positive amounts with at most two decimals and divisible by the smallest chip. Computation uses integer denomination units, with a conservative combined numeric limit. Target sizes round to the nearest denomination and merge when rounding/capping produces duplicates.

- Opening bet target = configured fraction × current pot.
- Raise target = current highest contribution + configured fraction × pot **after calling**.
- With initial pot 100 and a 50 bet, pot after calling is 200. A 50% pot raise increases the wager by 100, making the raise target 150.
- Full raises must increase the highest contribution by at least the previous full bet/raise increment. A smaller raise can appear only as an effective all-in.
- Wagers cap at the smaller river-start stack. A deeper player's excess chips stay behind; no unsupported side pot is invented. This is an effective-stack cap and is not necessarily a literal all-in for the deeper player.
- At a fold, unmatched contributions are returned before awarding the contested pot. For contributions 50 versus 150, 100 is refunded to the raiser and the contested pot is initial pot + 100.
- Net from river = ending stack minus stack behind at river start. The two net values sum to the pre-existing pot, because past contributions have already left the displayed stacks. They are not claimed to be zero-sum values relative to the start of the whole hand.
- At a weighted showdown, the expected award averages actual integer-chip winner/split settlements; a fractional expected award is not an extra fractional physical chip.

## Exact work and implementation

`backend/src/engine/riverTree.js` validates and normalizes the input, enumerates compatible private deals, caches river hand scores and builds a finite public tree. `prepareRiverDeals` is exported so a later solver can reuse the joint weighted private outcomes rather than attempt to solve from a single aggregate equity.

Work limits are 20,000 compatible private deals, 200,000 enumeration search steps and 512 tree nodes. Larger inputs fail explicitly and instruct the user to narrow ranges. No partial tree, silent truncation or Monte Carlo fallback is returned. Candidate combo counts describe board/fixed-card filtering; the legal joint-deal count and probabilities additionally account for mutual range collisions.

The task runs through the existing cancellable bounded Worker pool. Queue, per-user caps and 45-second total deadline remain unchanged. Worker errors map back to the existing JSON error conventions. There is no database write, history mutation, new collection or migration.

## API

`POST /api/river-tree`, authenticated in the normal server, takes:

```json
{
  "gameType": "holdem",
  "gameMode": "cash",
  "board": ["2s", "3d", "7h", "8c", "9s"],
  "potSize": 100,
  "chipUnit": 1,
  "minBet": 2,
  "players": [
    { "name": "OOP", "stack": 200, "input": ["Ah", "Ac"] },
    { "name": "IP", "stack": 200, "input": { "type": "range", "range": "KhKc, QhQc@50%" } }
  ],
  "betSizes": [0.5, 1],
  "raiseSizes": [0.5, 1],
  "maxRaises": 1,
  "includeAllIn": true
}
```

Percentages in the API are fractions: 0.5 means 50%. The UI accepts percentages such as `50, 100`. Returns `{ success: true, tree }` with normalized input, exact chance summary, flat ID-indexed nodes, parent/action links, scope notes and work limits. Terminal nodes have outcome arrays in OOP/IP order. `winner` is populated for fold awards; showdown outcomes are represented by the chance model and expected awards. Decision nodes have no solved EV, frequency or recommendation. Validation receives 400, missing authentication 401, pool pressure 503 and timeouts 504.

The development preview adapter explicitly permits this read-only calculation route while continuing to block account actions and saved-spot writes.

## Validation

- **370 backend tests passed**: the prior 332 plus 38 river-tree checks.
- Production frontend build passed.
- Tests cover connected bounded trees, chip conservation, check/check, bet/fold/call, raise sizing and refunds, denomination rounding/deduplication, unequal stacks, short all-ins/raises, full-raise minimums, odd split chips, product-weighted/mutually blocked ranges, explicit root action priors, exact-budget rejection, unsupported scope and malformed/null inputs.
- Real Worker dispatch and both protected API and local-preview endpoint behavior were exercised without Atlas.
- Real-browser checks covered the nine-page preview, fixed/weighted examples, branch navigation and net values, retained draft/result/selected node, input invalidation/error recovery, card blockers, no-raise mode, unequal stacks, valid and invalid source copy, reset during a pending request even when the example inputs are identical, reduced motion and 320/390/820/1440 widths.

These are local automated checks, not a test on physical phones or new production deployment. No live account was created, password entered, database contacted or hosted service changed.

## Complete source

Added `backend/src/engine/riverTree.js`, `backend/src/engine/tests/riverTree.test.js`, `frontend/src/lib/riverTree.ts`, `frontend/src/components/RiverTreePanel.tsx` and this guide. Updated the task dispatcher, protected API, local preview allowlist, test script, App/navigation/styles and current project guides. No old source file needs deleting. The branch contains the entire cumulative application for later combined testing/release.
