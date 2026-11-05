# @river-poker-lab/core

Private, zero-dependency runtime package shared by the Node backend, React web client and future native host. It contains transport/domain code; it imports no React, DOM module, database driver, Node builtin or poker computation engine.

## Contents

| File | Responsibility |
| --- | --- |
| `src/models.d.ts` | Game/range/card inputs, table/history/calculation DTOs, solver trees/results, account identity, jobs and tournament configuration |
| `src/index.d.ts`, `src/transport.d.ts` | Public declarations and minimal fetch/signal/header interfaces that compile without DOM types |
| `src/contracts.js` | Card normalization, pure postflop request builders and explicit valuation formats |
| `src/client.js` | Injected fetch client, JSON/CSRF/cookie handling, typed endpoint methods, timeout/abort and HTTP errors |
| `src/jobs.js` | Host-owned polling/cancellation/reconnect controller with idempotent submission and stale-generation protection |

The runtime is plain CommonJS with explicit exports compatible with ESM imports. TypeScript declarations are provided. There is no package build step and nothing is published to a registry. Backend/frontend package locks reference `file:../packages/core`; their normal `npm ci` installs the local package. Deploy the complete repository, including `packages/core`, rather than copying only `backend` or `frontend`.

## Request and result boundaries

`buildRiverTreeRequest(draft)` and `buildSolverRequest(draft, settings, 'river' | 'turn')` convert portable editor data into numerical API inputs without mutating the draft. They normalize card aliases and catch incomplete cards, known-card duplicates, blank/invalid amounts and malformed size text before transport. Range grammar, mutual range feasibility, denomination alignment and all mathematical/resource checks remain authoritative backend responsibilities.

Current strategy builders support Hold'em cash only. They reject tournament valuation markers rather than silently treating an ICM request as Chip EV. No tournament-tree strategy is implemented here.

`parseValuation` returns a discriminated union:

- `chip-ev`: chips, signed `expectedNet` by player, starting pot, and `turn-start-stack` or `river-start-stack` baseline.
- `icm-prize-ev`: prize units, absolute expected Call/Fold prize values, Malmuth-Harville model and their difference. This is the existing outcome-weighted closing-call comparison, not a new tournament tree solver.

A consumer must branch on `kind`. A negative net chip value and a positive absolute prize value have different meanings and cannot share an unlabeled number display. Unknown units/baselines are rejected by the parser. Original response fields remain available for older clients.

## Transport host responsibilities

`createApiClient` accepts an API base URL/path, injected fetch transport, credentials mode, optional async headers provider and unauthorized callback. Its high-level JSON methods enforce the existing application header, preserve HTTP status and Retry-After, and support cancellation/timeouts. Paths stay within the configured API service. It never opens a window, navigates a screen, stores credentials or adds visual loading delays.

Browser hosts may use `/api`; native hosts need a reachable absolute API URL and suitable transport/auth adapters. The host provides standard fetch primitives (`Headers`, `AbortController`, URL handling) when invoking network operations. Importing the package itself needs none of them. No implicit Node/browser crypto polyfill is bundled.

`RiverJobClient` accepts a request function, state callback, polling interval and optional `{ createRequestId }` adapter. The web host uses secure-context `crypto.randomUUID`; a native host must supply its platform's secure UUID implementation if that global is unavailable. No weak random fallback is used. The controller belongs to the signed-in session scope. Retain it across screen changes, and dispose it on logout/account changes. View-level loading feedback remains the host's responsibility.

Current production authentication is still the existing HttpOnly cookie session. Generic header injection is an integration seam, not implemented bearer-token support. No secure token storage, native login session, refresh-token endpoint, biometric unlock, Expo app, offline solver or durable job storage is delivered in this package.

## Capability discovery

The authenticated API exposes `GET /api/capabilities` with `contractVersion: 1`. `client.capabilities()` rejects an unsupported version. The response states the current cash solver limits, existing ICM snapshot/closing-call support, absence of ICM tree solving, current authentication mode and temporary process-memory job semantics. Local preview explicitly identifies itself as local preview.

## Verification

From the repository root, after installing backend/frontend dependencies:

```bash
npm run test:core
npm run typecheck:core
npm test
npm run build
```

The native contract fixture compiles with `lib: ["ES2020"]` and no DOM/React/Node types. Runtime tests load the module in a VM with no browser globals or Node builtin imports, and exercise a native-style injected transport/UUID adapter. This is a portability boundary check, not a built or physically tested iOS/Android app.
