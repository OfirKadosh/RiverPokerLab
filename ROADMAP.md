# Development roadmap

The code, UI and documentation are English. Development explanations are Hebrew. Each delivered stage includes a complete cumulative source package.

| Stage | Scope | State |
| --- | --- | --- |
| 1–4.2 | Validation, visual responsive table, ranges, setup, betting ledger and desktop sticky table | Delivered |
| 5–6 | Bounded Exact/Auto equity, main/side-pot settlement, closing-call Chip EV | Delivered |
| 7 | Independent 2–9-player tournament ICM snapshot calculator | Delivered |
| 8 | Outcome-weighted monetary ICM comparison for supported Fold/Call decisions; tournament configuration persistence and elimination handling | Delivered |
| 8.1 | Separate navigation views, lazy panel loading and retained session drafts/results | Delivered |
| 9 | Weighted combinations and explicit action-specific ranges, with consistent conditioning and validation | Delivered for review |
| Accounts before trial | Registration, verification, server sessions and private per-user history | Delivered for review |
| Personal trial | Same-origin frontend/API, manual approval, free Render and Atlas | Live; user confirmed core flow |
| Beta stabilization | Loading transitions, bounded CPU worker, Mongoose compatibility and isolated development | Development branch; ready for review |
| Admin / UI preview | Private admin provisioning and local screens without login/Atlas | Implemented on development branch; production provisioning pending owner password |
| 10 | Restricted heads-up Hold'em cash river tree, exact weighted terminal payoffs and explorer | Delivered on step-10-river-decision-tree; not deployed |
| 11 | CFR average strategies, combo/action EV, reached-range matrix and exact restricted exploitability | Delivered on step-11-river-strategy-solver; not deployed |
| 12.1 | Owner-scoped background river jobs, measured progress, cancel and navigation continuity | Delivered on step-12-1-background-solver; not deployed |
| 12.2 | Compiled CFR traversal, reproducible profiling/benchmarks, larger bounded ranges and resource feedback | Delivered on step-12-2-solver-performance; not deployed |
| 12.3 | Bounded two-street CFR, exact legal runouts, hidden-future-safe best responses and turn explorer | Delivered on step-12-3-turn-river-solver; not deployed |
| 13.1 | Portable domain/solver/account DTOs, shared request/API/job client and explicit valuation metadata | Delivered on step-13-1-shared-core-api; not deployed |
| 13.2 | Outcome-weighted turn/river tournament action comparison under fixed responses | Delivered on step-13-2-tournament-decisions; not deployed |
| 14 (formerly 13.3) | Native shell with platform authentication/lifecycle adapters | Deferred until after the second beta |
| Combined beta update | Owner review of stages through 13.2, candidate checks and approved deployment | Candidate on release/beta-2; awaiting approval, not deployed |
| Later | Tester feedback, account/history features and operational improvements | After the reviewed update |

## Personal trial and ongoing development

The personal trial is live at https://river-poker-lab.onrender.com/ and the user confirmed registration, login and history work. Ongoing improvements are developed on a separate branch, with no merge or live deployment as part of this stabilization step. See BETA_STABILIZATION.md for the current update, tests and review/rollout workflow. Registration remains open with manual activation. Stage 10 now adds a restricted heads-up river tree on its own branch. Stage 11 now adds restricted-tree strategy solving on its own cumulative review branch; see STEP_11_RIVER_SOLVER.md. Stage 12.1 adds temporary background river jobs and progress on its cumulative review branch; see STEP_12_1_BACKGROUND_SOLVER.md. Stage 12.2 adds compiled traversal and measured capacity increases; see STEP_12_2_SOLVER_PERFORMANCE.md. Features will be reviewed together before a combined release; no per-stage deployment is automatic.

## Stage 9 delivered parts

- 9.1: weighted class/physical combo notation, overrides and validation.
- 9.2: product-weighted joint sampling, collision conditioning, Exact accumulation and payouts.
- 9.3: one-node observed-action profiles, explicit ledger-action selection and weighted per-outcome ICM.
- 9.4: dedicated Ranges navigation, matrix brush, JSON exchange, draft retention, persistence and checks.

See `STEP_9_WEIGHTED_ACTION_RANGES.md` for the delivered semantics and supported limits. Inputs are supplied priors/frequencies, not automatically solved strategy.

## ICM integration constraint

Stage 8 evaluates ICM separately for each complete outcome stack vector, then weight the monetary results. Applying ICM to average ending stacks is not equivalent. See `STEP_8_ICM_DECISIONS.md` for implemented scope, elimination rules and outside-table assumptions. Fold branches, returned uncalled chips, side pots, elimination payouts and simultaneous eliminations require explicit semantics and tests. The stage 7 endpoint currently accepts only surviving positive stacks; this alone is not sufficient to value all decision branches.

## Second beta scope

Stage 13.2 completes the intended development scope before owner review for the second beta. The native shell is moved from 13.3 to stage 14 and does not block this release. See `STEP_13_2_TOURNAMENT_DECISIONS.md` and `RELEASE_REVIEW.md`.

## Version 1.1 — bankroll and practice

Both modules are planned for 1.1 and can be delivered in separate increments.

### Bankroll

- Track cash sessions and tournaments in each member's private account. Capture cash buy-ins and cash-out, or tournament entries/re-entries and prizes.
- Record deposits and withdrawals separately from play results. Show current balance, net results for the selected period, and a session history with cash and tournament filters.
- Start with one currency per bankroll and a mobile-friendly entry form.

### Practice

- Let players choose Cash or Tournament and the type of decision to practice. Draw a random spot from validated templates, varying hands, boards, ranges and other supported inputs. Present only legal actions and reveal the solution after the first submitted answer.
- Begin with supported heads-up cash river decisions and tournament Fold/Call ICM decisions with a complete field and explicit assumptions. Use the existing engine to grade and explain each spot. In cash, show action EV and mix where relevant. In tournaments, explain chip EV and prize EV separately when both are available.
- Accept multiple actions when their values are within the declared scoring tolerance. Skip or regenerate a spot if the analysis cannot support a reliable grade. Show what made the accepted answers reasonable.
- Keep private practice progress with correct-answer streaks, consecutive practice days, personal records and milestone achievements. Count the first graded answer once per exercise and a completed exercise once per local practice day. Store progress by account for continuity across devices.
