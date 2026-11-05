# Stage 13.2 — Tournament turn/river action comparison

Branch: `step-13-2-tournament-decisions`, stacked on `step-13-1-shared-core-api`. Complete cumulative source; no merge or deployment. The native shell formerly labeled 13.3 moves to stage 14 and is not a prerequisite for the second beta.

## Use the workspaces

Open **River tree** or **Turn tree**, then expand **Tournament decisions · ICM**. The cards/ranges, opening pot, stacks behind, denomination and bet sizes in that existing worksheet define the hand geometry. Cash CFR controls and results remain separate and are not used by the tournament comparison.

1. Supply both actual hand-start stacks, every outside surviving player's stack and the remaining prizes in descending order. Confirm the complete remaining field.
2. Review the fixed turn/river response weights for both players. Confirm these are assumptions. Uniform defaults are test weights, not a solved strategy. Check/call and uniform presets are available; physical-combo overrides accept JSON.
3. Compare actions, inspect OOP facing a bet, and navigate action paths and public river cards. Expected prize values, differences against Fold/Check, chip values, reached combo distributions and all-field prize values are separate columns.

**Load ICM bubble example** replaces the source worksheet and field/policy settings. Both examples have 98 chips behind per active player, 100 actual hand-start chips, pot 4, a third player with 98 chips and payouts 50/50/0. The opponent shoves after Hero checks. River Hero Qh Qc faces Ah Ac @40% / Th Tc @60% on 2s 3d 7h 8c 9s. Turn Hero 9s 9d faces Ah Kh on Jh Th 2c 8s, including all 44 legal rivers. Hero's Call gains chips but loses prize value relative to Fold under these responses. The root action can differ; inspect the facing-bet node.

## Meaning of the analysis

This is exact evaluation of configured actions against **fixed response weights**, not a tournament equilibrium, a recursive optimal strategy or full-game GTO. It reports no NashConv/exploitability. One action is forced at the inspected node, then BOTH players follow supplied responses for the rest of the hand. Weights depend on street, own private combo and legal actions. They are not conditional on public river texture, pot odds, exact bet size, or earlier history. Different size actions each receive their configured relative weight; changing the available action set changes normalized frequencies.

All-in bets/raises use `allin` weight when they consume the effective stack; calling an all-in uses `call`. Missing weights are zero. Every compatible combo must have positive weight on at least one legal action at every decision, including off-path decisions. Overrides replace the entire action-weight map for their street. Example:

```json
[{"cards":["Ah","Ac"],"river":{"check":1,"call":1,"allin":0}}]
```

Each complete terminal stack vector is settled using integer chip units, uncalled refunds, odd split chips to OOP, and existing elimination semantics. ICM is then computed separately on that outcome, and expected prize values are probability-weighted. It is never applied to average stacks. Actual hand-start stacks determine elimination ranking; equal starting stacks split the corresponding eliminated prizes. Outside chips remain fixed, but their expected prizes can change. Monetary payoffs are not zero-sum between only the two active players.

Private-deal priors account for joint blockers/weights. Turn policy shares each private-hand choice across hidden future rivers; revealed-river branches use compatible scenario subsets. Later action posteriors depend on supplied responses. Reached aggregate action values force the same selected action across the currently reached own range. Off-path aggregate values and recommendations are null/empty. Own-combo counterfactual values may remain available if only the player's own earlier action excluded the path; they are explicitly labeled.

Chip EV is net from the beginning of the selected street (both streets for turn), while monetary EV is absolute expected remaining prize value. Delta columns use Fold if available, otherwise Check, otherwise the first action. Values carry the independent `icm-tree-ev` / `prize-units` / `fixed-response-policy` contract, not the cash `RiverSolution` or old closing-call payload.

## Supported limits

- Exactly two active Hold'em players with a fresh turn or river, no outstanding bet. No tournament Omaha strategy, rake or bounties.
- Entire remaining field: 2–9 players, positive surviving stacks and 1–N descending remaining prizes; shorter lists pad with zero.
- **Only these two active players may have funded the starting pot**: sum(hand-start stack minus current stack behind) must equal that pot. Pots with dead money contributed by folded/outside players are rejected rather than guessed. The existing closing-call analyzer keeps its separate ledger-based scope.
- Existing river tree geometry limits (including at most one raise) remain. Turn allows one sized opening bet per street plus optional all-in, with no raises, 16 compatible private pairs and up to 704 exact pair/runout scenarios.
- Additional ICM bounds: 120,000 node/scenario visits, 128 unique ending-stack vectors, 128 compatible combo overrides per player. Exceeding a bound rejects the request rather than sampling or returning a partial model.

## Runtime and API

`POST /api/tournament-tree` accepts `analysisKind: fixed-policy-icm`, `street`, `spot` with `gameMode: tournament`, `tournament` and `responsePolicy`. The portable core provides the typed `buildTournamentTreeRequest`, `compareTournamentTree` SDK method, `IcmTreeValuation` and result DTOs. Authentication/CSRF, request cancellation and the existing bounded shared CPU-worker queue remain in force. Queue contention/timeouts fail explicitly. Local UI preview permits the same real read-only computation without Atlas or persistence.

Completed results and forms survive navigation within the browser session. Input changes invalidate displayed results. Pending ICM requests cancel when leaving the page or changing inputs; they are request-scoped comparisons rather than background iterative CFR jobs. A half-second minimum loading indicator provides feedback and honors reduced-motion preferences. No user history/database write is introduced.

Capabilities advertise `icm.treeActions.enabled: true` and fixed-response evaluation, while `solvers.icmTree.enabled` remains false because no full strategic ICM solver is provided. Cookie sessions and unsupported native bearer/offline solving behavior are unchanged.

## Review and release

Run `npm test` and `npm run build`. Use `npm run preview:dev` for local database-free UI review. Load the bubble example in each street, compare, inspect OOP facing a bet, check that Call has positive chip delta and negative prize delta, navigate the tree, and edit an input to verify stale results disappear. Review complete field assumptions and fixed responses before interpreting any preference.

After owner review, stages through 13.2 are the candidate scope for the **second beta**. Stage 14 native screens/platform authentication are deferred. Follow `RELEASE_REVIEW.md`; no automatic production update.

Validation recorded for this stage: 27 portable-core tests, 481 backend tests and 10 frontend tests (518 total); production build and DOM-free contract typecheck. Authenticated Chromium checks cover both ICM examples, confirmations, loading, separate chip/prize action values, exact river navigation, all-field/combo panels, form edits, session retention, cancellation on navigation and 320/390/820/1440 layouts. No production database is used.
