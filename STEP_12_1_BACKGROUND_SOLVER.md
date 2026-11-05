# Stage 12.1 — Background river calculations

Branch: `step-12-1-background-solver`, based on stage 11 at `c0c769617a06164a78ab053ac41ca7c0c3362674`. This is complete cumulative source for local review. It includes all earlier development work. No production merge, deployment or database change is part of this stage.

## Run

```bash
git fetch origin
git switch step-12-1-background-solver
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Choose **River tree** in the local preview. It uses the real worker and math without login or Atlas. Production continues requiring the existing authenticated session. No environment variable, new service, paid provider or migration is needed for this feature.

## Review flow

1. Select **Load 3-hand benchmark**, build the tree, then solve. The original reference result and convergence metrics are preserved.
2. After starting, switch to **Ranges** or another page. The background calculation banner remains available there. Use **View river calculation** to return to its worksheet and result.
3. For a longer test, use `22,33,44,55` for both ranges with the benchmark board, pot and stacks. Build, then set 7,000 iterations and a zero target. This creates 456 legal joint deals and stays inside the existing 30-million work limit. Select **Solve river strategy** and switch pages immediately. Runtime depends on the machine; very fast tasks may finish before the first visible progress update.
4. Start again, press **Cancel calculation**, and verify that a cancelled task never publishes a partial strategy. A task that already completed can return its complete result before cancellation wins the race.
5. Change river inputs or solver settings during a run. The previous task is cancelled; stale replies cannot fill the changed worksheet. Navigation alone leaves it running.
6. Verify reduced motion and narrow viewports. Loading feedback remains available, while progress always represents actual completed work rather than an animation timer.

The worksheet and displayed results remain session-only. Reloading the browser clears the worksheet and does not automatically restore a previous task. An abandoned server task can keep running until it finishes or times out; another task from that user must wait or be cancelled from its original tab. Logging out/unmounting the app attempts to cancel its active task. Closing a tab does not guarantee a cleanup request reaches the server.

## Progress meaning

Worker messages report preparation, CFR iterations and exact best-response evaluation. The displayed percentage is **completed iterations / configured maximum iterations**, explicitly labelled as the iteration budget used. It is not an estimate of remaining time or a guarantee of convergence. A successful run may stop at, for example, 14,000 / 20,000 iterations when its quality target is reached. The measured exploitability and the iteration of that measurement are shown together; checkpoint evaluation can lag the current iteration count.

The UI polls immediately after accepting the job, then every 750 ms while connected. It displays measured counts, not synthetic interpolation. The existing half-second feedback applies to successful submission; polling itself has no artificial delay. Very small reference games can complete before submission feedback ends. Only a complete final worker result is rendered as a strategy.

## Backend lifecycle and API

`SolverJobs` owns a job's abort signal independently of any HTTP connection. Finishing or disconnecting the creation/polling request does not terminate the calculation. The existing single worker, FIFO queue, worker memory limits, 45-second calculation timeout and other task types remain in use. Cancelling an active job terminates its worker; the pool restarts before processing waiting work. Cancelling a queued job removes it without affecting the active task.

| Request | Behavior |
| --- | --- |
| `POST /api/river-jobs` | Accept `{ input: <same canonical river input with solver options>, requestId: <unique UUID> }`; return 202 and a job snapshot |
| `GET /api/river-jobs/:id` | Return this owner's status/progress; include the full solution only when completed |
| `GET /api/river-jobs` | Return this owner's retained job summaries, without solution payloads |
| `DELETE /api/river-jobs/:id` | Cancel an active job; return its confirmed final status; a completed job remains completed |

Every route is behind the existing production authentication and origin checks. Write requests use the existing JSON client header; DELETE sends a JSON body too. A job belonging to another user returns the same 404 as an unknown job. Snapshots expose no owner identifier, input fingerprint, cookie, password or database credential. The requestId is an idempotency token, scoped to its owner: repeating identical input and token returns the same retained job; reusing the token for different input returns 409.

The original synchronous `/api/river-solve` endpoint remains available for compatibility and tests. The new UI uses jobs. Exact equity, ICM and the branch tree API continue using their existing interfaces; this stage does not expand the mathematical game's scope or work limits.

## Bounds and retention

| Resource | Limit |
| --- | --- |
| Active background river jobs | One per authenticated user |
| All job records in one Node process | 32 |
| Retained job records per owner when a new job is created | 4, including the new one |
| Aggregate retained serialized result bytes | 16 MiB |
| Terminal result validity | 10 minutes after completion/failure/cancellation, subject to earlier eviction |
| Solver work, worker queue and timeout | Existing stage-11 limits and existing pool limits |

Expired records are pruned on job requests. Older terminal jobs can be evicted to admit a new record or result within the bounds. Active jobs are never evicted as if they completed. A single result larger than the retained byte budget fails explicitly. No partial strategy is retained or silently truncated. Validation/work errors from the worker appear as failed job snapshots with an error status; an accepted 202 is not a promise of mathematical success.

This storage is **process memory**, separate from MongoDB history. It is suitable for page navigation in the current single-process trial. Server restarts, free-host sleep, deployments and process replacement can lose tasks/results. A missing/expired job displays an explicit unavailable message. Durable jobs, browser-reload restoration and multi-instance coordination are outside this stage and would require shared persistent storage. No new infrastructure is provisioned here.

## Client lifecycle and recovery

`RiverJobClient` is owned by `App`, above the routed panels. It polls through page changes and stores a result only when the entire river draft and solver settings still match the task key. The account provider keys App by user ID, so a different account gets a new controller and worksheet. Logout/unmount disposes the old controller; its late responses cannot update another account's state.

Submission retries use the same requestId. If creation replies are lost, the client can query its own job summaries to recover that ID. Polling failures retry with capped exponential backoff and an explicit reconnecting message. Individual network requests time out after 10 seconds. A 401/403/404 becomes an explicit unavailable state rather than an endless successful-looking spinner. Cancellation is shown as pending until the server confirms it; network failure does not falsely report success.

Cancellation before a creation reply is handled by remembering the intent, then sending DELETE as soon as the server ID is obtained. Input invalidation aborts outstanding reads and ignores old generations. Completed policies are retained in the matching in-memory worksheet, even if their temporary server copy later expires.

## Validation

Install both dependency sets above, then run from the repository root:

```bash
npm test
npm run build
```

Root tests run the backend suite and standalone frontend client race tests. Backend-only tests remain available through `npm --prefix backend test`; client tests through `npm --prefix frontend test`. The client tests use the frontend's existing TypeScript compiler, with no additional test framework or runtime dependency.

Coverage includes unchanged analytic solver results despite progress reporting, real worker phase/count delivery, monotonic iterations, owner isolation, idempotency, active quotas, capacity/result-memory/TTL bounds, cancellation races, failures/timeouts, production authentication, local preview with no DB writes, cancellation during submission, stale polls, reconnects, lost creation replies, account disposal and duplicate-submit prevention.

Chromium checks use the real local-preview server and a 456-deal job. They verify navigation during solving, actual running/completed reports, no duplicate submission or implicit navigation cancellation, explicit cancel, input invalidation, reconnect after a failed poll, matching results, missing-job reporting, reduced motion and 320/390/820/1440 viewports. Transport failure and missing-job responses are deliberately injected for those error scenarios; the strategy calculations use the real worker. These are browser viewport checks, not physical-device or live-production tests.

## Next stages

- 12.2: profile and optimize solving before increasing private-range/work limits.
- 12.3: extend to a bounded turn-and-river game with correct chance nodes, private information and convergence checks.

Keep this branch and its draft pull request separate for review before a combined release. Do not deploy automatically per stage.
