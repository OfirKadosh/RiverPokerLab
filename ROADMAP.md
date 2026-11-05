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
| 12.3 | Bounded turn-and-river game with chance nodes and convergence checks | Planned |
| 13 | Broader production access, account/history features and operational improvements | Planned |

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
