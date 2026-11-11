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

## Version 1.1 — bankroll

The bankroll release follows the stable 1.0 solver release. Development continues on `release/v1-1-bankroll-practice`.

| Step | Deliverable | State |
| --- | --- | --- |
| 1. Bankroll ledger | Account-scoped opening balance, cash sessions, tournaments, deposits and withdrawals. Includes a responsive entry form and list with edit and delete actions. | Implemented for branch review |
| 2. Bankroll dashboard (1.1.1) | Inclusive date filters, cash and tournament results, newest-first ledger with load more, and a daily closing balance chart. The chart includes every entry type and carries the opening balance into the selected period. | Implemented for branch review |
| 3. Release validation | Owner verified the mobile staging flow with separate test accounts. The dashboard distinguishes poker profit and loss by color. | Ready for the 1.1 release after stable 1.0 |

The current balance is opening balance plus net transfers plus poker profit. Enter the total paid for a cash session or tournament, including all rebuys or re-entries. Tournament prizes and cash-outs are recorded separately. Transfers affect the balance but do not count as poker profit.

Each bankroll uses one currency (ILS, USD, EUR or GBP) and supports up to 2,000 entries. The opening balance can be corrected after setup. Amounts are stored in integer minor units. UI preview shows a read-only sample ledger.

## Version 1.2 — practice

Initial branch: `release/v1-2-practice`. The first exercise set covers heads-up Hold'em river Fold/Call in Cash and Tournament. It varies suit assignments, shoving-range weights, pots, and stacks across a bounded template set. Cash uses exact terminal chip EV and Tournament uses fixed-response ICM. The server withholds results until the first answer and replays that result on retry. Open questions are temporarily kept in process memory. First answers, totals, and streaks are saved to the account. The first answer sets the account's practice time zone for consistent day boundaries across devices.

- Let players choose Cash or Tournament and the type of decision to practice. Draw a random spot from validated templates, varying hands, boards, ranges and other supported inputs. Present only legal actions and reveal the solution after the first submitted answer.
- Begin with supported heads-up cash river decisions and tournament Fold/Call ICM decisions with a complete field and explicit assumptions. Use the existing engine to grade and explain each spot. In cash, show action EV and mix where relevant. In tournaments, explain chip EV and prize EV separately when both are available.
- Accept multiple actions when their values are within the declared scoring tolerance. Skip or regenerate a spot if the analysis cannot support a reliable grade. Show what made the accepted answers reasonable.
- Keep private practice progress with correct-answer streaks, consecutive practice days, personal records and milestone achievements. Count the first graded answer once per exercise and a completed exercise once per local practice day. Store progress by account for continuity across devices.

| Step | Deliverable |
| --- | --- |
| 1. Practice questions | Initial Cash and Tournament river Fold/Call templates implemented. Expand the template set and decision types. |
| 2. Grading and explanations | Grade on the server with the existing solver and ICM engine. Accept equivalent actions within a declared tolerance. |
| 3. Personal progress | Implemented persistent totals, correct-answer and practice-day streaks, personal bests, and three initial milestones. Count first answers and local practice days once. |
| 4. Release validation | Verify grading, date boundaries, account isolation and mobile layouts. |
