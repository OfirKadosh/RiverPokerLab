# Stage 8.1: Navigation and separate workspaces

This is a complete cumulative project, adding navigation before stage 9. The poker engine, API contracts, ICM calculations and MongoDB schema are unchanged from stage 8. Trial deployment remains scheduled as the development milestone at the end of stage 9.

## Installation

Extract the complete project into a fresh folder. Preserve your own `backend/.env` and any private changes. Run `npm ci` in `backend` and `frontend`, then `node src/server.js` from `backend` and `npm run dev` from `frontend`. No new dependency or database migration is required. All files are included in full; no individual source file needs removing.

Added:

- `frontend/src/lib/navigation.ts`: supported routes and hash navigation.
- `frontend/src/lib/workspaceState.ts`: small session-state types, defaults and typed field setters.
- This guide.

Complete updated files: `frontend/src/App.tsx`, `App.css`, `components/IcmPanel.tsx`, `components/TournamentSettingsPanel.tsx`, `components/BettingPanel.tsx`, root `README.MD` and `ROADMAP.md`.

## Navigation

| Menu item | URL fragment | Contents | Table visible |
| --- | --- | --- | --- |
| Spot setup | `#/spot` | Game mode/type, blinds, dealer, pot, players, cards and starting stacks | Yes |
| Hand actions | `#/hand` | Hand builder, wager input, history, streets, Undo and pre-hand blind preview | Yes |
| Analysis | `#/analysis` | Calculation settings, equity diagnostics, payouts, Chip EV/ICM decisions and saving | Yes |
| Tournament | `#/tournament` | Applied decision prizes, outside players and full-field confirmation | No |
| ICM calculator | `#/icm` | Independent stack/prize worksheet and finish probabilities | No |
| History | `#/history` | Saved spots and history refresh | No |

The menu remains accessible during scrolling and shows the current view. Desktop table stickiness is offset below the menu so the table does not cover navigation. Short desktop windows retain internal table scrolling; phones retain normal table page flow. Mobile navigation wraps into two rows without horizontal page overflow.

Workflow: configure a spot, open Hand actions to record a hand, open Tournament to apply monetary settings when needed, then open Analysis to calculate and save. Loading a historical spot opens Spot setup and restores its data. Use Hand actions to inspect/continue the restored action ledger and Analysis for the results.

The Tournament page explains how to enable Tournament mode if the spot is currently Cash. The independent ICM calculator can be opened in either game mode and does not require cards. It remains separate from applied decision settings.

## Why client-side pages

Navigation uses URL fragments, real links and the browser history API. Back/Forward and direct links to a supported view work without a full browser reload or extra server rewrite rules. Unknown or empty fragments normalize to Spot setup. The active page has an accessible heading, document title, current-link indicator and keyboard navigation.

Only the active page's controls are mounted. There is no collection of complete hidden forms/tables kept in the DOM. The hand builder, pre-hand preview, analysis results, tournament settings and standalone ICM panels are split into JavaScript chunks and requested when first needed. Downloaded modules can remain in the browser's normal module/cache storage; unmounting is not a claim to unload their JavaScript. The common app state retains the compact data needed to resume work.

A page transition alone does not change calculation inputs, start a new Monte Carlo/Exact run, reset a hand or recompute a finished ICM worksheet. A shared equity calculation already in progress may finish after navigating away; its result is kept for the same spot. Requests belonging only to an unmounted ICM/settings panel are aborted and their superseded results ignored. History is first requested when visiting History, with explicit refresh and normal post-save updates still available.

This approach avoids introducing a routing dependency, full-page reloads and duplicated calculation state. It is a UI organization and loading improvement; no benchmark claim is made about server simulation speed.

## State retention and limits

Across page transitions, the application retains:

- Current seats, hands/ranges, board, mode, stacks, blinds and Hero.
- Betting actions, current turn, pot, Undo state and unsubmitted wager amount.
- Current calculation method, chip unit and calculation/decision results for unchanged inputs.
- Applied tournament settings and unapplied tournament form text/confirmation.
- Independent ICM worksheet inputs and a completed worksheet result.

Changing real calculation inputs still invalidates stale results. Editing tournament drafts still blocks dependent spot calculations until the settings are applied or Chip EV only is selected. Navigation does not silently clear those drafts. Expanded disclosure panels, loading indicators and transient local validation errors may reset when their controls unmount. Navigating closes an open card editor; only applied range edits are retained, consistent with the existing editor's apply/cancel behavior.

These are in-memory session values, not an autosave or durable browser store. Refreshing/closing the browser or opening a new tab starts a fresh session; the route alone does not encode a spot. Save important spots through Analysis before refreshing. New spot intentionally resets the poker workspace and tournament settings. The independent ICM worksheet remains a separate tool and is not erased by New spot. Applied tournament settings are saved with the spot; independent worksheet drafts remain unsaved.

## Verification

`npm run build` in `frontend` passes and emits separate chunks for the optional panels. The 270 existing backend tests remain included; no backend file was changed for this stage.

Real-browser checks with the real engine and in-memory history cover all six views, unmounting inactive panels, preserved ICM inputs/results, preserved unapplied tournament drafts, wager draft retention, actual betting action execution, saving/loading a stage 8 tournament hand, retained chip/ICM decisions, no duplicate calculation requests on navigation, first-visit history loading, Back/Forward, invalid-fragment fallback, keyboard navigation, and all six pages at 320/390/820/1440 pixels. The table remains below the sticky desktop menu while scrolling. Checks use browser viewports, not physical phones or a live MongoDB connection.

Manual smoke test:

1. Open Spot setup, choose Tournament and configure a hand.
2. Enter part of a tournament form, visit another view, then return and confirm the draft remains.
3. Complete/apply tournament settings and build a supported closing-call spot under Hand actions.
4. Run Fold/Call under Analysis, navigate through all menu items, then return and confirm the result remains.
5. Calculate the independent ICM example, leave and return; confirm its inputs/result remain without a second request.
6. Save under Analysis, load under History, and inspect the restored Spot setup/Hand actions/Tournament pages.
7. On a phone-sized window, visit every view and confirm there is no horizontal page overflow.
