# Stage 11 — Restricted river strategy solver

Branch: `step-11-river-strategy-solver`, based on stage 10 at `c66b2d4b67b7d0eaf4a3593c69d9a71c1d4af57f`. This cumulative source includes the existing account, preview, loading, equity, ranges, ICM and river-tree features. It is for local review; it does not deploy or modify production data.

## Run and review

```bash
git fetch origin
git switch step-11-river-strategy-solver
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Open the printed local URL and choose **River tree**. No login or Atlas connection is needed in the local, read-only preview. Production APIs still require authentication. The existing pot and stacks describe the START of the river, before any river betting.

1. Select **Load 3-hand benchmark**, then **Build river tree** and **Solve river strategy**.
2. Inspect root EV, exploitability and the checkpoint table. The OOP net should approach `17/18` chips (about `0.9444`), and IP approaches `19/18`.
3. Select public nodes, inspect action frequencies and EV, click `22`, `33` or `44` in the matrix to filter physical combos. Public-node ranges change with solved actions.
4. Navigate elsewhere and return: the matching result, draft and selected node remain in this browser session.
5. Set 100 iterations and a zero target, then solve: a report may explicitly say **target NOT reached**. This is a valid approximate result, not a claim of convergence.
6. Change cards, ranges, sizes or solver settings during calculation: the request is cancelled, and an old reply cannot populate the changed spot. Navigating away also cancels an unfinished request.
7. Load the fixed-hand or weighted example to inspect the raised tree. Terminal branch accounting remains available in the separate explorer. A terminal node has no strategy; choose a decision in **Strategy at public node**.

No results are written to History, local storage or MongoDB. Reloading the browser clears this worksheet. No files need to be removed by users switching branches; Git supplies the complete source.

## Implemented game and algorithm

This solver supports the stage-10 heads-up, no-limit Hold'em cash **river-start** tree: complete board, exact private hands or weighted ranges, configured opening sizes and optional single raise/all-in. It does not solve turn play, Omaha, ICM, side pots, rake, outstanding wagers or actions outside the configured abstraction.

`riverTree.js` shares its validated tree and exact legal private deals with `riverSolver.js`. Product-weighted deals are conditioned on board and mutual blockers once, then used as chance probabilities. Hands with no positive-weight compatible deal do not create information sets.

The solver uses deterministic, full-traversal, simultaneous counterfactual regret minimization (CFR):

- An information set is one player's own physical combo plus the public action history. The policy never depends on the opponent's hidden combo.
- Each iteration freezes both current regret-matching policies while traversing every legal deal and branch. Counterfactual regret uses chance probability and opponent action reach, excluding own action reach.
- The output is the accumulated average policy weighted by chance and own action reach. It is not the final instantaneous regret-matching policy.
- Both players' net payoffs sum to the existing river pot. Subtracting half that constant pot from each player's net produces a zero-sum game; divide by the pot for numerical scaling. Reports convert back to chips and the original river-start stack baseline.
- Refunds, effective stacks, showdown outcomes and denomination-aware odd chips reuse the stage-10 accounting. IP is the button; OOP receives an odd split chip.

The original tree explorer continues to show terminal **unchanged-prior** branch payoffs. The new strategy section separately conditions reach and continuation on the solved policies. Those two views answer different questions.

## Exact quality measurement within the tree

At the initial uniform policy, up to ten subsequent checkpoints, and in the final report, evaluate both unilateral best responses. At each own decision, a best response chooses **one action per own combo**, aggregating across all compatible opponent hands using chance and opponent reach. It cannot choose a different action after secretly seeing the opponent's cards.

For average-policy expected net `V[p]` and unilateral best-response net `BR[p]`:

- `deviationGain[p] = max(0, BR[p] - V[p])`
- `NashConv = deviationGain[0] + deviationGain[1]`
- `exploitability = NashConv / 2`, in chips per deal
- `exploitabilityPotPct = 100 × exploitability / startingPot`

Convergence checkpoints may fluctuate. Stop at a measured checkpoint meeting the chosen target, or at the iteration limit, whichever occurs first. If uniform play already meets the target, report zero completed iterations. There is no fabricated live completion percentage or guaranteed target attainment. These exact best responses and targets concern this **configured game only**, not unrestricted or full-game GTO.

## Action and combo values

Each reached public node reports actual reach probability, posterior own-combo weights, reached-range action frequencies and action EV. Each combo's EV forces a selected action at that node, then both players follow the average continuation. It is net from river-start stack, so earlier river investments are included. Aggregate action EV forces the same action across the currently reached combo range; it is not weighted by the frequency of selecting that action.

The matrix colors are reached-mass-weighted action mixes over physical combos in each hand class. Disabled classes have no compatible positive-weight combo. Existing but off-path classes retain filter access with a neutral color; the UI does not replace a zero-reach range with an invented prior.

A combo with zero own earlier action reach but positive opponent reach is marked `counterfactual-only`: action EV ignores its zero own reach, so it describes a deviation, not an observed on-path range. If opponent reach is zero for all compatible deals, the row is `unreachable`, and its action EV is `null` / **—**. A zero-reach public node has no aggregate frequency or EV. All physical-combo policies are nevertheless valid normalized distributions.

## API and limits

Authenticated `POST /api/river-solve` accepts the same canonical input as `/api/river-tree`, plus:

```json
{"solver":{"maxIterations":2000,"targetPotPct":0.5}}
```

Returns `{ "success": true, "solution": ... }` containing average combo policies, root net EV, exact restricted best-response metrics, convergence history, input fingerprint, actual iterations, target/stop status, elapsed worker time and limits. The root `input` preserves the canonical game definition; the fingerprint covers that definition, while solver options are a separate field. UI matching uses the complete draft and solver settings.

| Bound | Value |
| --- | --- |
| Iteration limit | Integer 100–20,000; default 2,000 |
| Target | 0–5 percent of starting pot; default 0.5 |
| Legal positive-weight joint deals | At most 1,000 |
| Information sets | At most 4,000 |
| Estimated traversal work | `(maxIterations + 60) × jointDeals × publicNodes ≤ 30,000,000` |
| Public nodes | Existing stage-10 limit: 512 |

The work estimate conservatively reserves checkpoint traversal passes; it is not elapsed time or a live progress estimate. Budget checks reject oversized requests with HTTP 400 before CFR starts. No silent truncation, sampling or partial strategy is returned. The existing single CPU worker, bounded queue, per-user allowance, cancellation and 45-second timeout are reused. Queue failures return 503, timeouts 504, with retry guidance. This keeps CPU solving outside the HTTP event loop; response serialization still runs in the normal server process.

## Validation

Automated checks include the six-deal Kuhn-equivalent benchmark (the analytic centered OOP value is `−1/18` chips), an independently enumerated best-response reference over all pure information-set policies, a clairvoyant-response guard, raised-tree dynamic-programming reference, joint blocker/weight conditioning, normalized policies, action EV identities, zero-sum accounting, denomination scaling, odd chips, off-path semantics, option/work rejection, deterministic checkpoints, real worker dispatch, production authentication and API error statuses.

Run `npm test` and `npm run build`. Browser review covers real local-preview solves, matrix filtering, retained results, settings invalidation, stale request cancellation, target failure, validation messages, fixed-hand raised trees, terminal exploration, reduced motion, and 320/390/820/1440 viewport widths. No production DB is used by these checks.

Algorithm references: [Zinkevich et al., 2007](https://papers.nips.cc/paper_files/paper/2007/file/08d98638c6fcd194a4b1e6992063e944-Paper.pdf), [Johanson et al., 2012](https://poker.cs.ualberta.ca/publications/AAAI12-cfrbr.pdf). The implementation computes full-tree best responses directly; it does not implement CFR-BR or claim unrestricted-game guarantees.

## Release workflow

Keep this branch separate while reviewing several features together. Its draft pull request targets `step-10-river-decision-tree`, so the stage-11 changes are reviewable independently of earlier stages. Do not point Render at this branch or merge to `main` until the combined release is approved. The live site continues serving the existing deployed revision.
