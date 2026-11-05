# Stage 12.2 — Measured river solver performance

Branch: `step-12-2-solver-performance`, based on `step-12-1-background-solver` at `8c797703a7521d6022173593f87a2b85c22e7dae`. This complete cumulative branch is for local review. No merge, deployment, account or database change is included.

## Run and review

```bash
git fetch origin
git switch step-12-2-solver-performance
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Open **River tree**, select **Load larger-range example**, then **Build river tree** and **Solve river strategy**. The example has 48 physical combos per player, 2,064 legal joint deals and a 3,000-iteration limit with a zero target. A zero target requests the whole budget unless exact zero exploitability is measured; it does not promise convergence. Inspect **Calculation time and resource details** after completion.

Before solving, try 5,000 iterations: the UI explains that this combination exceeds the work budget and suggests at most 3,169 iterations. Return to 3,000 to solve. The existing **Load 3-hand benchmark** remains a separate six-deal analytic reference. Navigation, cancellation and recovery still use the stage-12.1 background job controller.

## What changed and why

A CPU profile of the previous 456-deal, 7,000-iteration case placed most sampled CPU time in its recursive per-deal tree traversal. The production solver now compiles the fixed public tree once into reusable numerical buffers and evaluates it in loops:

1. Freeze the regret-matching current policies for a complete iteration.
2. Compute each player's action reach by public history and OWN hand. Share unchanged opponent-reach buffers across branches where that opponent has not acted.
3. Evaluate decision-node deal values bottom-up and accumulate chance/opponent-reach-weighted regrets. Terminal utility arrays are reused.
4. Accumulate average policy once per information set using own action reach. The positive chance marginal is a fixed scalar for each own combo, so it cancels when that combo's accumulated action weights are normalized. Chance probabilities remain in every regret update and all evaluations.

The algorithm remains full-traversal simultaneous CFR with a reach-weighted average strategy. It still visits every legal deal and configured action, including zero-own-reach branches needed for counterfactual regret. Exact private deals, blockers, weighted priors, refunds, odd chips, action EV and information-set-constrained best responses retain their meanings. There is no combo sampling, hidden-card revelation, abstraction change or silent truncation.

The original stage-12.1 solver is frozen in `backend/src/engine/tests/support/riverSolverReference.js` for differential tests and reproducible benchmarks. It is loaded only by test/benchmark code. Production loads `riverKernel.js` through `riverSolver.js`.

## Recorded benchmark

Raw samples, environment, source hashes, phase timings and peak process RSS are in `backend/benchmarks/river-performance.json`. Measurements used Node v24.22.1 on the recorded Linux host, one isolated child per engine/case, one warm-up and five measured runs, with explicit garbage collection before each measured run. Wall time includes preparation, CFR, quality checks and the final report.

| Case | Legal deals | Previous median | Compiled median | Ratio |
| --- | ---: | ---: | ---: | ---: |
| Three-hand reference | 6 | 57.6 ms | 30.2 ms | 1.91× |
| Pair ranges, 7,000 iterations | 456 | 910.7 ms | 218.5 ms | 4.17× |
| Weighted pair ranges | 456 | 245.4 ms | 105.5 ms | 2.33× |
| Raised tree | 12 | 98.0 ms | 42.9 ms | 2.29× |
| Expanded pair ranges | 2,064 | Outside old deal limit | 463.4 ms | — |

Maximum absolute differences across all reported mathematical metric fields, per-combo policies and action EVs were below `6e-13` in the four comparable cases. Floating-point summation and average normalization can differ; these are not claims of bitwise equality. Differential checks tolerate `1e-7`, and the analytic six-deal value/early-stop checkpoint remain independently checked.

Compiled cases comparable with the baseline peaked at roughly 55–59 MiB process RSS; the expanded case peaked at about 84.4 MiB across warm-up and repeats. The compiled traversal trades additional reusable buffers for less repeated work; total process memory does not uniformly decrease. These isolated-process observations include the interpreter/JIT and do not represent the deployed HTTP/MongoDB server's total memory, worker heap guarantees or Render timings. Speed varies with hardware, Node version, ranges and tree shape. Tests impose no wall-time threshold.

Reproduce from the repository root:

```bash
npm run benchmark:river
```

The command prints a full report. To save one, run from `backend`:

```bash
node scripts/benchmarkRiver.js benchmarks/local-river-performance.json
```

`BENCH_REPETITIONS` optionally selects 1–10 runs (default 5). No network, account, MongoDB or production service is used. CPU profiling can be performed with Node's `--cpu-prof` on the benchmark sample or solver entry point; generated profiles are local analysis artifacts.

## Resource bounds

Measured gains support a conservative work-limit increase of 2×. Larger combinations still need to fit every independent bound.

| Bound | Stage 12.1 | Stage 12.2 |
| --- | ---: | ---: |
| Legal joint private deals | 1,000 | 4,000 |
| Information sets | 4,000 | 8,000 |
| Estimated traversal work | 30,000,000 | 60,000,000 |
| Maximum iterations | 20,000 | 20,000 |
| Deal × public-node cells | No separate bound | 500,000 |
| Planned core numerical buffers | No separate bound | 8 MiB |

Estimated work is still `(maxIterations + 60) × jointDeals × publicNodes`, reserving checkpoint passes. The cell bound also limits the size of quality-analysis matrices. The numerical buffer plan counts terminal utilities, compiled decision values, deal indices/probabilities, shared reach arrays, current strategies, regrets and strategy sums. It is checked before allocating terminal/compiled buffers, and the work limit is checked before CFR starts. This figure excludes JavaScript objects, reporting/best-response temporary arrays, JIT, serialized results and the HTTP server; it is explicitly labelled **core solver buffers** in the UI.

The public tree response includes `solverLimits` from the server's shared budget module. The UI uses those values and the exact built deal/node counts to estimate work. It prevents an obviously oversized submission and suggests a smaller iteration limit when appropriate. Information-set and memory feasibility remain authoritative server checks. The main tree explorer retains its separate stage-10 enumeration limits; an affordable tree is not automatically an affordable strategy solve.

The existing CPU worker memory settings, 45-second timeout, job ownership, queue, per-user active limit and bounded temporary-result retention remain in place. No partial strategy is returned on a resource rejection. Broad `random` vs `random` ranges remain unsupported by these bounds.

## Result diagnostics

`solution.performance` adds:

- `kernel`: `compiled-public-tree`.
- `timingsMs.setup`: validation, legal deals, payoff preparation and kernel setup.
- `timingsMs.iterations`: the iteration loop excluding timed quality evaluations; includes average-policy construction and progress-message overhead.
- `timingsMs.quality`: initial and checkpoint profile/best-response evaluation.
- `timingsMs.report`: final detailed evaluation and report preparation.
- `resources`: exact structural work/cell counts and planned core buffer byte counts, with the compiled kernel's actual allocated buffer bytes.

Timers are rounded to tenths of a millisecond; total runtime is rounded to a whole millisecond. Minor timing gaps/rounding differences are expected. JSON serialization, HTTP transfer, queue waiting, browser rendering and the existing submission-feedback delay are outside the engine timings. Timing/resource details are collapsed by default and help explain how to reduce expensive inputs.

## Validation

```bash
npm test
npm run build
```

The full backend suite and frontend job-client tests cover all earlier features. Added differential tests compare complete policies, weighted/posterior combo values, per-action EV, root EV, best responses, exploitability, history and early stopping against the frozen stage-12.1 solver. They include weighted raised trees, very unequal weights, check-only/odd-chip outcomes, exact buffer-accounting checks and equality/overflow at each budget boundary.

Real bounded-worker tests solve the expanded 2,064-deal example and a 3,684-deal all-pairs case. Policies remain normalized, values finite and total expected net conserved. Existing analytic Kuhn and independently enumerated best-response/hidden-card guards remain active. No production DB is used.

Chromium review verifies the new example, server-provided budget text, disabled over-work solve with a suggested limit, the real background result after navigation, performance details, 48-combo class filtering, reduced motion, the original three-hand example and no page overflow at 320/390/820/1440 viewports. These are browser viewport checks, not physical-phone or deployed-host measurements.

## Next

Stage 12.3 remains the bounded turn-and-river extension. This stage supports a complete river board only; Omaha, ICM and unrestricted/full-game GTO are outside this solver. Review this cumulative branch before approving a combined release; no per-stage deployment is automatic.
