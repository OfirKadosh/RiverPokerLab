# Stage 12.3 — Bounded turn-and-river strategy

Branch: `step-12-3-turn-river-solver`, based on stage 12.2 at `0c695d09ee33cdb651631dadfb3f90b21f6e78fc`. This cumulative source includes all earlier features and remains a review branch. No merge or deployment is included.

## Run and review

```bash
git fetch origin
git switch step-12-3-turn-river-solver
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Choose **Turn tree** in the navigation. The local preview uses real computation with no login, Atlas connection or account writes. Production authentication remains mandatory.

1. **Load turn example** supplies a four-card board, two weighted physical-combo ranges, pot/stacks and sizes. Select **Solve turn → river**. The default example has four compatible private pairs and 176 exact pair/runout scenarios.
2. Inspect root net EV, exact restricted exploitability, best-response gains and checkpoint history. A result that exhausts its iteration limit without meeting the target explicitly says so.
3. Choose **Check**, then **Check** in the selected-node explorer. This reaches a river-reveal node. The example has 48 possible public river cards across its private pairs; each individual pair has exactly 44 legal rivers.
4. Select **Ah**. The OOP combo containing Ah disappears from that continuation because it is blocked by the public board. Continue through river actions to inspect conditional net and terminal settlement.
5. Return through the public-history breadcrumbs and inspect a different turn action or river card. River strategy can change with the revealed card; turn strategy is shared across all still-hidden future rivers.
6. Switch to another page during a run, then return through **View turn calculation**. Cancel a run, or change its inputs to invalidate it. The river and turn worksheets retain independent drafts and results; only one background postflop job may run per account.

Specific hands use the existing simple visual card picker. Weighted ranges use the existing range editor and action-prior conditioning semantics. Inputs and results are session-only, not saved to History or restored after reload. Server restarts can lose temporary jobs, as in stage 12.1.

## Implemented scope

- Exactly two active players, OOP first and IP/button second, with a complete four-card turn board.
- Hold'em cash Chip EV, a pot that already exists before turn betting, and actual stacks behind at that moment.
- One configured opening bet percentage per street, plus optional effective-stack all-in; Fold/Call responses. No raises on either street.
- Full turn betting, every legal river, and a fresh river betting round after turn Check/Check or Bet/Call while both players retain chips.
- A called turn all-in reveals a legal river and settles directly. It does not create a phantom betting round against a player with no chips left.
- Exact legal private-pair and river enumeration, product weights conditioned on known/mutual blockers, and denomination-aware refunds/split settlement.
- CFR average policies by own physical combo and public history, action EV, actual reached ranges, restricted best-response exploitability and convergence checkpoints.

There is no flop strategy, re-raise tree, rake, side pot, outstanding turn wager, Omaha strategy, tournament ICM strategy or unrestricted/full-game GTO guarantee. Existing equity, Omaha, tournament, history and river-only tools retain their scopes and remain available.

## Chance and information model

For each compatible positive-weight private pair, exactly eight distinct cards are known to the model: four board cards and four private cards. All 44 remaining rivers are enumerated. A scenario's prior probability is:

`product private-pair weight / total compatible private-pair weight / 44`.

The future river is latent at the turn. A turn information set contains a public action history and the acting player's OWN hand, aggregating all compatible opponent hands and future rivers. A river information set additionally includes the revealed public river and the complete preceding turn history. Equal-pot subgames reached through different turn actions are deliberately not merged.

At each public reveal, a sparse chance branch selects only scenarios consistent with that card. Scenario probabilities already include the `1/44` chance factor; the branch does not multiply that factor again. The public-card distribution can be nonuniform across weighted ranges because different private pairs block different cards. After solved turn actions, the display conditions this distribution on the action-dependent posterior rather than unchanged input priors.

The sparse representation stores each river subgame only over its compatible scenarios. This avoids allocating a dense public-node × all-future-rivers matrix for every node. It remains exhaustive, not sampled. Hard structural bounds are enforced while constructing the game.

## Strategy and quality

`turnSolver.js` runs full-traversal simultaneous CFR. Current policies are frozen across an iteration. Counterfactual regret uses scenario probability and opponent action reach; average strategies use scenario probability and own action reach. Future-card scenarios share each turn own-hand policy. Zero-own-reach branches remain available to counterfactual regret and deviations.

Quality uses exact unilateral best responses inside the configured game. At each own information set, one action is selected across all compatible opponent hands and, before reveal, all hidden future rivers. Opponent policies, blockers and public chance remain in the weighting. A response that sees the future card early would obtain an unfair advantage; an independent test checks that this oracle response exceeds the permitted response in a drawing-hand example.

As on the river page:

- `NashConv` is the sum of both unilateral best-response gains.
- `exploitability = NashConv / 2`, in chips per deal.
- `% starting pot = exploitability / original turn pot × 100`.

The initial uniform policy and up to ten subsequent checkpoints are assessed. Stop at a measured target or the iteration limit; a check-only game can already be solved at iteration zero. Progress reports completed iterations and the last measured checkpoint. No partial strategy is published during solving.

## Accounting and display

Every payoff uses the stacks at TURN start as its baseline. River investments are added to previous turn investments before computing net. Uncalled chips are refunded, contested awards use only matched investments, and OOP receives an odd split chip because IP is the button. The two expected net values always sum to the pot that existed before turn betting.

Public-node conditional net uses the solved probability of reaching that history. At zero actual reach it is undefined and omitted. Per-combo action EV forces the selected action, then follows the average continuation, including investments already made on either street. Counterfactual-only rows ignore zero own action reach; an impossible opponent path has `null` / **—** action EV. Combos incompatible with a revealed river are absent from that subgame's rows.

The new tenth navigation page uses a compact responsive layout. The sticky table on existing setup/analysis pages measures the actual navigation height and reserves bottom space for its scrollable viewport, including at tablet widths where navigation has two rows.

## Bounds

| Resource | Limit |
| --- | ---: |
| Compatible private pairs | 16 |
| Private-pair / river scenarios | 704 = 16 × 44 |
| Public nodes | 3,000 |
| Information sets | 6,000 |
| Sparse node / scenario visits | 120,000 |
| Estimated work | `(maxIterations + 60) × sparse visits ≤ 60,000,000` |
| Iterations | 100–2,000; engine default 500 |
| Quality target | 0–5% of original turn pot |

The UI example requests 1,500 iterations and a 0.5% target. Different legal inputs can exceed the work or information-set limit even if each private range looks small. Rejections return no sampled, truncated or partial solution. The existing single CPU worker, queue limits, cancellation, timeout, per-owner active-job quota and temporary-result retention apply. No new provider, paid service, environment variable or database migration is required.

## API integration

The authenticated background API remains `/api/river-jobs`. To explicitly select the new task, its input includes `solverStreet: "turn"`, a four-card `board`, `betSizes` for the turn and `riverBetSizes` for the river. Set `maxRaises: 0`, `raiseSizes: []`; the remaining player, pot, denomination and solver-option fields follow the existing interface. Other unknown street selectors are rejected. Omitting the selector preserves the original river job behavior.

The worker dispatches `turnSolve`; the legacy synchronous `/api/river-solve` stays river-only. A completed turn solution adds `turnTree` with its public nodes, bounds, private/scenario counts and sparse visit count. Its `metrics` adds `publicValues`, including solved reached-card probabilities at chance nodes. Existing average-policy, EV, quality, history, target and job-status fields are retained. All job reads/cancels remain owner-scoped and authenticated, including in the shared one-active-job quota.

## Validation

Run `npm test` and `npm run build` after installing both dependency sets. Tests cover:

- Exactly 44 legal rivers per private pair and normalized weighted chance, including mutual card collisions and unequal private weights.
- Check-only value against the independent exhaustive equity engine and a known 15-out drawing-hand result.
- Fixed-private-hand best responses against an independent public-chance dynamic program; a future-seeing response is explicitly disallowed.
- Weighted river-only continuations against independently conditioned river solver profiles and best responses for each public river.
- Strategy-dependent card posteriors, preserved public histories, policy normalization, deterministic CFR and decreasing measured exploitability.
- Turn all-in direct settlement, refunds, both-street investment accounting and denomination-aware odd chips.
- Malformed/unsupported inputs, exact 16-pair boundary, no-truncation overflow, work rejection and real-worker/background API dispatch.

Chromium review uses the real four-pair calculation, checks navigation while solving, all 48 public-card branches, blocker removal, river terminal exploration, independent retained worksheets, cancel/error states, reduced motion, the original river reference and 320/390/820/1440 viewport widths. Tablet checks include the sticky table below the measured navigation. These are browser viewport checks, not physical-device or deployed-host tests. No production DB is used.

## Release next

After this stage, proceed to a combined release review rather than making stage 13 a prerequisite. See `RELEASE_REVIEW.md` for the concrete checks and release scope. The draft pull request targets stage 12.2; production stays on its deployed branch until the owner reviews and approves the update.
