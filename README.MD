# PokerSolver — River Poker Lab

A MERN application for building Texas Hold'em and four-card Omaha High spots, estimating multi-player showdown equity, and saving spots to MongoDB. The code and interface are in English.

## Stage 12.1 development branch

See [STEP_12_1_BACKGROUND_SOLVER.md](STEP_12_1_BACKGROUND_SOLVER.md). Branch `step-12-1-background-solver` adds owner-scoped background river jobs, measured iteration/checkpoint progress, explicit cancellation and a banner that survives navigation. Network retries preserve the same task, and stale results cannot populate changed inputs. Results are temporarily retained in bounded process memory; server restarts can lose them. This complete branch includes stage 11 and is for local review, without a production deployment.

## Stage 11 development branch

See [STEP_11_RIVER_SOLVER.md](STEP_11_RIVER_SOLVER.md). Branch `step-11-river-strategy-solver` adds CFR average strategies for the restricted heads-up Hold'em cash river tree, per-combo frequencies and action EV, a reached-range matrix, exact restricted best-response exploitability and honest convergence/stop reports. It includes stage 10 and all earlier development work. It is not merged or deployed; the live site stays on its current release.

## Stage 10 development branch

See [STEP_10_RIVER_TREE.md](STEP_10_RIVER_TREE.md). The new River tree workspace explores a bounded heads-up Hold'em cash river tree with exact private-range payoffs, configurable bet/raise sizes, refunds and split chips. It does not solve strategy or root action EV. Branch `step-10-river-decision-tree` includes all earlier stabilization/admin/preview work and is not deployed.

## Admin and local screen preview

See [ADMIN_AND_UI_PREVIEW.md](ADMIN_AND_UI_PREVIEW.md) for private one-time `admin` creation and `npm run preview:dev`, which opens all screens locally without sign-in or Atlas. Preview uses real calculations but blocks saving and account changes. Production authentication stays mandatory.

## Beta stabilization branch

See [BETA_STABILIZATION.md](BETA_STABILIZATION.md) for half-second loading feedback, reduced-motion behavior, bounded worker-thread calculations, Mongoose compatibility and isolated local development. This branch is for review; the live personal trial remains on its previously deployed main revision.

## Hosting preparation

See [DEPLOYMENT.md](DEPLOYMENT.md) for the prepared free Render service, same-origin client/API and explicit hosted manual activation. The initial personal trial is live; this stabilization branch has not been deployed. Hosted manual approval is separate from contact verification and does not label email/phone as verified. Upgrade hosting and switch to a real delivery provider through settings later.

## Current capabilities

- Nine navigable workspaces: Spot setup, Hand actions, Ranges, Analysis, River tree, Tournament, ICM calculator, History and Account.
- Registration/sign-in, email or SMS activation, remembered device sessions and private per-user saved history.
- Session state and drafts retained across navigation, with inactive panels unmounted and optional panels loaded on demand.

- Responsive visual poker table: horizontal on wide desktop screens and vertical on phones.
- Two to nine players with stable, clickable seats.
- Simple rank-and-suit cards; no image assets or complex illustrations are needed.
- A 169-cell Hold'em range matrix with weighted class/suit-specific combo notation, blocker counts, JSON import/export and observed-action frequency profiles.
- Specific-hand vs range and range vs range simulations, with global collision checks.
- A 52-card picker that fills the active card slot and advances to the next empty slot.
- Two hole cards for Hold'em and four for Omaha, with global duplicate-card blocking.
- Editable player names, separate starting/current stacks, a Hero marker, and stack depth in big blinds.
- Dealer selection, clockwise position assignment for 2–9 players, heads-up rules, and preflop/postflop order previews.
- Small/big blind posting previews, including short-stack forced all-ins, with optional explicit use of the blind pot.
- A live hand builder with turn-based Fold/Check/Call/Bet/Raise/All-in, no-limit Hold'em and pot-limit Omaha, automatic pot/chip accounting, street progression, action history, and Undo.
- A sticky desktop table with internal scrolling on short windows; mobile uses normal page flow.
- Community-card selection for preflop, flop, turn, and river.
- Auto/Exact/Monte Carlo equity: bounded exhaustive enumeration when manageable, otherwise 1,000 automatic or 5,000 manual Monte Carlo samples.
- Independent main/side-pot settlement, clockwise odd chips, and expected or final ending stacks when betting is closed.
- Hero Fold-versus-Call chip EV for calls that close all remaining betting, with Monte Carlo uncertainty intervals.
- Independent exact ICM calculator for all 2–9 remaining tournament players, with prize equity and finish probabilities.
- Outcome-weighted ICM Fold/Call analysis with saved tournament settings, outside-table stacks, elimination cash and paired sampling uncertainty.
- Split-pot equity and strict Omaha two-hole-card evaluation.
- Stale results are cleared when calculation inputs change; superseded responses are ignored.
- Saved-spot history, including player stacks, seat positions, Hero, and big blind for newly saved visual spots.
- Legacy spot loading with clearly stated defaults when table metadata is missing.
- Shared backend input validation and structured HTTP 400 responses for invalid requests.

## Scope

This version is an equity calculator and visual spot builder. It settles side-pot payouts and compares closing calls with folds, but does not solve betting strategies, compute action frequencies, or solve unrestricted multi-street strategy. An independent ICM snapshot calculator is available in any game mode. Outcome-weighted closing Fold/Call ICM comparison is available with applied Tournament settings. The hand builder records betting actions and computes provisional contribution layers. Range simulations are supported for Hold'em only, with weights applied to physical combos and joint collision conditioning. Tournament decisions show Chip EV and, with applied full-field settings and both branches closed, separate ICM prize EV. The existing backend Call EV formula and response fields remain available for backward compatibility; the new table intentionally does not present them as strategic action recommendations.

In free equity mode, starting stacks are recorded before forced blinds and current-stack fields retain the prior spot value. In the hand builder, chips behind, pot, call amount and turn are derived from starting stacks, blinds and the replayed actions. The table shows those live remaining stacks. Setup is locked during a hand. Provisional pot layers are accounting summaries; a separate payout panel evaluates entitlements once no future betting remains. Folded players cannot win equity, but their configured cards or ranges remain blockers. Hero selects the acting player for decision analysis and does not change showdown equity. Automatic equity requires a complete specific hand or an applied Hold'em range for every occupied seat. An empty hand is not treated as random; choose the explicit All hands range preset to model a random Hold'em hand.

## Requirements

- Node.js 22 or 24 and npm (Render is configured for Node 22).
- A MongoDB connection for accounts, sessions and authenticated API access, including history. Database-free tests use explicit fixtures.
- A private AUTH_SECRET and an enabled verification channel (explicit development delivery is available for local review).

## Setup

For isolated development, install dependencies from the repository root:

```bash
npm --prefix backend ci
npm --prefix frontend ci
```

Copy `backend/.env.development.example` to the private `backend/.env.development`, enter your development database credentials and a fresh AUTH_SECRET, then run these commands in separate terminals:

```bash
npm run dev:backend
```

```bash
npm run dev:frontend
```

The backend launcher requires the development file and forces the `river_poker_lab_dev` database. Use a database user restricted to that database and keep it separate from the production database. See [BETA_STABILIZATION.md](BETA_STABILIZATION.md) for isolation details. Never point a development client at the live API.

`npm start` remains the hosting command and uses deployment environment settings; keep the real connection URI and secret private.

The frontend uses `/api` by default. Vite forwards `/api` to `http://127.0.0.1:5000`. Keep the proxy target in `frontend/vite.config.ts` aligned with your backend port.

Vite listens on `0.0.0.0`. To try the development UI from a phone on the same network, open the computer's LAN IP and the Vite port shown in the terminal, for example `http://192.168.1.10:5173`. Use the computer's address, not `localhost` on the phone. Local firewall settings must allow that connection.

For a future deployment, prefer same-origin API routing; authenticated requests use cookies and an exact allowed-origin configuration. A separate same-site API requires matching HTTPS/origin settings. Set `VITE_API_URL` only when appropriate, including `/api`, then rebuild. For a same-origin deployment, configure the host to forward `/api` to the backend. A Vite production build alone does not publish or host the backend.

## Navigation

Use the top menu to switch workspaces without a browser reload. The Ranges page edits weighted priors and explicitly observed-action profiles. Configure the spot in **Spot setup**, record actions in **Hand actions**, apply prizes in **Tournament**, and calculate/save in **Analysis**. **ICM calculator** is a separate worksheet; **History** opens saved spots. Back/Forward and view links work through URL fragments. Session data and unapplied drafts survive page transitions, but not a browser refresh. See [STEP_8_1_NAVIGATION.md](STEP_8_1_NAVIGATION.md) for routing, state retention and loading details.

## Use the table

1. Choose Hold'em or Omaha. Changing the game clears specific hands and ranges but preserves the board and player metadata.
2. Tap an existing player to edit the name, stack, Hero marker, and cards. In Hold'em, choose Specific hand or Range. Use the matrix or notation, then Apply range; closing the range editor without applying discards its draft.
3. Tap a vacant seat or **Add player** to add a player. Remove players in the editor, keeping at least two.
4. Choose cards in order. Used cards are dimmed and disabled. Tap a filled slot to replace it, or use **Clear selected card** to release it.
5. Tap a board slot to choose community cards. A flop needs three cards; turn and river must follow in order.
6. Equity updates after a short debounce when the card inputs are complete. **Recalculate** uses exhaustive enumeration when selected/affordable, otherwise 5,000 samples. Monte Carlo estimates can vary.
7. Under **Analysis**, **Save spot to history** recalculates with the selected method (5,000 samples for Monte Carlo) and saves the cards plus table setup. Invalid stacks, names, or big blind disable saving.
8. Load a spot from **History** to restore the table and recompute current equity. Saving a loaded spot creates a new history entry.

The **Existing call amount** disclosure preserves the original request field. It does not create a betting history or enable decision analysis.

## Verification

Install both backend and frontend dependencies, then run from the repository root:

```bash
npm test
```

The backend and standalone frontend client tests cover card and request validation, API error responses, evaluator regression scenarios, metadata consistency, range grammar, blocker counts, infeasible deals, statistical sampling symmetry, and mocked persistence. They do not connect to MongoDB.

The unchanged legacy smoke test is also available:

```bash
node backend/src/engine/test.js
```

From `frontend`:

```bash
npm run build
```

Browser checks covered selection/auto-advance, duplicates, add/remove, incomplete inputs, automatic Hold'em/Omaha equity, save/load through an in-memory backend, tournament disclosure, invalid stacks, error recovery, and nine-player layouts at 320, 390, 820, and 1440 pixels. These are browser viewport checks, not tests on physical phones or a live MongoDB database.

## Project structure

```text
PokerSolver/
├── backend/
│   └── src/
│       ├── engine/
│       │   ├── engine.js
│       │   ├── evaluator.js
│       │   ├── validation.js
│       │   ├── tableState.js
│       │   ├── rangeParser.js
│       │   └── tests/
│       ├── models/Spot.js
│       └── server.js
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── App.css
│       ├── components/
│       │   ├── Card.tsx
│       │   ├── CardPicker.tsx
│       │   └── PokerTable.tsx
│       └── lib/poker.ts
└── STEP_2_TABLE.md
```

All engine, parser, and card utilities now use the same numeric card encoding defined by `card.js`. Saved cards remain strings, so existing saved spots require no migration. See `STEP_3_RANGES.md` for supported syntax, API request shapes, sampling rules, limitations, and installation details.

Stage 4.2 is documented in `STEP_4_2_BETTING_STICKY.md`. Earlier stage guides describe their original delivery versions. The new stage adds live betting and uncalled refunds; showdown side-pot payouts, strategic decision EV and ICM are still future work.

## Steps 5–6

See [STEP_5_6_EXACT_PAYOUTS_EV.md](STEP_5_6_EXACT_PAYOUTS_EV.md) for calculation methods, per-pot payouts, the closing-call EV scope, API additions and complete-file replacement instructions. Earlier stage guides describe their respective historical snapshots.

## Stage 7 and next release

See [STEP_7_ICM.md](STEP_7_ICM.md) for the independent ICM calculator and [ROADMAP.md](ROADMAP.md) for the remaining stages. Trial deployment is on hold pending review of stage 9 and an explicit user instruction. ICM worksheet entries are currently session-only and are not saved to spot history.

## Stage 8

See [STEP_8_ICM_DECISIONS.md](STEP_8_ICM_DECISIONS.md) for outcome-weighted ICM decisions, saved full-field settings, elimination rules, API fields and complete-file replacement instructions. Independent worksheet drafts remain separate; applied decision settings are saved with spots. The original personal trial is live; later development remains on separate branches for a combined reviewed release. Earlier stage guides describe their historical snapshots.

## Stage 8.1

The navigation reorganization is delivered before stage 9. Historical stage guides describe their earlier single-page layouts; the current menu and draft-retention behavior are documented in [STEP_8_1_NAVIGATION.md](STEP_8_1_NAVIGATION.md).

## Stage 9

See [STEP_9_WEIGHTED_ACTION_RANGES.md](STEP_9_WEIGHTED_ACTION_RANGES.md) for all four delivered range sub-stages, notation, conditional frequency semantics, UI/API fields, verification and complete-file replacement instructions. Weighted ranges remain Hold'em-only; Omaha uses four specific cards. `npm test` now runs the full backend suite and frontend job-client checks. Stage 9 itself did not deploy; the original personal trial was subsequently deployed. This development branch has not been deployed.

## Accounts before trial deployment

See [ACCOUNTS_AND_VERIFICATION.md](ACCOUNTS_AND_VERIFICATION.md) before starting this version. All app APIs require a verified session; the Account page controls sign-out. Saved spots are filtered by their server-assigned owner. Legacy ownerless records stay hidden, not deleted. Real email/SMS requires provider settings; explicit local development delivery prints codes only to the backend terminal. Trial deployment remains on hold.
