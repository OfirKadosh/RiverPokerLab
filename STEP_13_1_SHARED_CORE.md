# Stage 13.1 — Shared contracts and portable API foundation

Branch: `step-13-1-shared-core-api`, based on stage 12.3 at `fe35ee154ae7f838aa51958b36adb0c4e6095f8d`. The complete cumulative source remains a review branch, with no merge, deployment, version tag, production account change or database migration.

## Run

Stop an existing dev server, then:

```bash
git fetch origin
git switch step-13-1-shared-core-api
npm --prefix backend ci
npm --prefix frontend ci
npm run preview:dev
```

Both install commands matter in this stage: they link the new local `@river-poker-lab/core` dependency. No separate root install or package build is required. All previous screens remain available. There are no new secrets, providers or environment variables to configure.

## Delivered foundation

`packages/core` holds portable DTOs, pure request builders, explicit valuation semantics, a fetch client and the proven job lifecycle controller. Backend and frontend use the same private file dependency. It has no runtime npm dependencies and imports no React, database, Node builtin or computation engine.

The React web client now consumes the shared code rather than retaining its own copies of the domain and job contracts:

- `poker.ts` re-exports game/range/table/history/calculation types and card constants, while keeping UI seat state and presentation helpers local.
- `riverTree.ts` re-exports solver DTOs and portable editor data while keeping React workspace state/default examples local.
- River tree and turn request assembly use shared builders. Valid cards/amounts produce the same mathematical input; incomplete/invalid editor values can now be rejected locally before HTTP submission.
- The shared API client handles request transport and errors. `api.ts` is a thin browser adapter for cookies, Request/URL inputs and the existing unauthorized event.
- `useRiverJob` owns the shared controller above routed screens. Half-second visual feedback, reduced-motion behavior, React updates and session disposal remain in the web host.
- Account identity/session and login/registration DTOs are shared; existing cookie authentication and approval behavior remain unchanged.

Full poker calculation remains server-side. Frontend betting/setup helpers and visual components were not moved into a native UI or computation bundle. Sharing the request/result boundary does not mean React DOM components can render in React Native.

## API contract and capability endpoint

The current additive contract is version 1. Responses include the `X-River-Contract-Version` header. The authenticated `GET /api/capabilities` provides body-level version/capability discovery for clients that cannot inspect a cross-origin response header.

It reports:

- Current restricted river/turn Chip EV solver limits.
- Existing independent ICM snapshots and closing-call ICM comparison, up to nine remaining players.
- `icmTree.enabled: false` — stage 13.1 does not implement tournament turn/river strategy.
- Cookie-session authentication and `bearerTokens: false`; the local read-only preview identifies itself separately.
- Process-memory job retention, no restart survival, no browser worksheet restoration and no offline solving.

No API path was renamed; `/api/river-jobs` continues serving both explicitly selected turn and existing river jobs. Older response fields remain present. New clients may call `capabilities()` after authentication to check the server contract and supported features. The current web avoids an additional boot request and continues its existing flows.

## Explicit value formats

Cash strategy results add `contractVersion` and `valuation`, without changing existing metrics:

```json
{
  "kind": "chip-ev",
  "unit": "chips",
  "baseline": "turn-start-stack",
  "street": "turn",
  "startingPot": 2,
  "expectedNet": [-3, 5]
}
```

The values are signed net changes from the selected street's starting stacks, and sum to the existing pot. The river variant uses `river-start-stack`.

The already supported outcome-weighted ICM Fold/Call comparison adds a distinct valuation shape:

```json
{
  "kind": "icm-prize-ev",
  "unit": "prize-units",
  "baseline": "absolute-expected-prize",
  "model": "Malmuth-Harville ICM",
  "expectedByAction": {"call": 28.571429, "fold": 32.924092},
  "difference": {"action": "call", "reference": "fold", "value": -4.352663}
}
```

This metadata describes existing calculations; it does not convert the cash CFR into an ICM solver. The original numeric fields/recommendation remain unchanged. New comparison metadata computes the displayed difference from the two reported means; tiny floating-point differences from the original paired estimator are possible.

`parseValuation` validates kind, unit and baseline and returns a discriminated TypeScript union. A client cannot parse a prize-unit payload as chip net simply because both contain numbers. Current cash strategy endpoints also reject an explicit unsupported ICM valuation marker. Range/board/game validation and all computation bounds remain on the server.

## Prepared native boundary

The shared client accepts fetch, request headers, credentials policy and unauthorized handling from its host. The job controller accepts a secure request-ID factory. DTO declarations compile with ES2020 alone, without the DOM library. The runtime supports CommonJS and ESM imports, and its import path needs no window, document, storage, Node crypto or React.

A future Expo/React Native host can therefore reuse requests, result interpretation and job lifecycle while implementing native screens and platform services. Native authentication is still a separate task: backend bearer/refresh-token support, secure credential storage and app lifecycle behavior have not been added. Generic headers are an extension seam, not a promise that the current backend accepts bearer tokens. Closing/reopening an app still cannot recover jobs lost by a server restart; durable retention remains separate work.

## Packaging and deployment compatibility

`backend/package.json` and `frontend/package.json`, with their lockfiles, reference `file:../packages/core`. The existing Render command already installs both from the full Git checkout, so it can resolve the package. Include `packages/core` in any custom deployment/source copy. No standalone bundle generation, registry publication or paid service is needed.

The Vite configuration explicitly handles the linked CommonJS package in development and production builds. Root `npm run build` first runs the native-style type fixture, then the web production build. Root `npm test` runs core, backend and frontend tests. Existing backend-only and frontend-only commands remain available.

The recorded stage-12.2 performance report remains a historical benchmark of that revision, not a new timing claim for this refactor. Mathematics and bounded worker execution are preserved; this stage adds metadata and request/transport boundaries.

## Review and validation

```bash
npm run test:core
npm run typecheck:core
npm test
npm run build
```

Core tests cover non-mutating normalization/builders, malformed requests, unit/baseline separation, injected transport and UUID adapters, HTTP status/retry guidance, timeouts/cancellation, path containment, CJS/ESM imports and import without browser/Node builtins. Browser-adapter tests verify Request bodies/overrides, cookie headers, destination containment and unauthorized events. Existing job race tests now exercise the actual shared implementation.

Backend contract tests use the portable client/builders against the real local-preview API and bounded workers for both streets. They verify version/capability truthfulness, authentication, no DB writes, Chip EV annotations, rejection of unsupported ICM markers, and the existing tournament regression where positive Chip EV corresponds to an ICM Fold recommendation.

Production-build Chromium review uses a memory-backed authenticated user (no Atlas), real cookie/CSRF flow, invalid-password handling, remember-me, river/turn calculations, navigation, retained worksheets, logout revocation and authenticated capability/job protection. Viewports include 320/390/820/1440. These are browser and transport/type portability checks, not a native app build or live-production test.

## Next

13.2 adds bounded turn/river tournament action valuation using complete field/payout inputs and outcome-weighted ICM against explicitly defined response policies. Full tournament equilibrium solving requires its own mathematical treatment; it is not enabled by the new result types.

Stage 14 (formerly 13.3) adds the native shell and platform-specific authentication/lifecycle integration after the second beta. Stages through 13.2 are reviewed for that beta; see `RELEASE_REVIEW.md`. No rollout is automatic.
