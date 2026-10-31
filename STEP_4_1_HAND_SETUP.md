# Step 4.1 — Positions, Blinds and Starting Stacks

This is the complete cumulative project, including validation, the responsive table, and Hold'em ranges. It contains complete replacement files and new files, not snippets. No application dependencies or source deletions are required.

## Install and run

1. Stop both servers and back up or commit the current project.
2. Extract separately and merge the supplied `PokerSolver` folder contents into the existing project, replacing matching files.
3. Keep your own backend `.env`, dependencies and local configuration. Real credentials, `node_modules`, build output and internal QA screenshots are excluded.
4. Restart both backend and frontend.

From `backend`, run verification:

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js src/engine/tests/handSetup.test.js
```

Then start the backend separately:

```bash
node src/server.js
```

From `frontend`, run these separately:

```bash
npm run build
npm run dev
```

Node.js 20 or newer is required. For a clean source copy, run `npm ci` separately in each application folder first and configure the backend MongoDB environment settings.

## New workflow

- Choose the **Dealer / Button** from occupied players, use **Move button clockwise**, or open a player and click **Set as dealer**.
- The table shows a `D` marker and each player's position.
- Set **Small blind** and **Big blind**. Both must be finite positive numbers; small blind cannot exceed big blind.
- Edit **Starting stack · chips** in each player editor. It must be finite and greater than zero.
- The table and player list show starting stacks, with depth in big blinds.
- **Current stack · chips** preserves the separate chips-behind value from the existing spot. It is not automatically changed in this stage.
- The setup preview shows which seats post blinds, actual chips posted, remaining chips, forced all-ins and the resulting initial pot.
- **Use blind pot** explicitly copies the preview's initial pot to the manual current-pot field and resets the existing call amount to zero. It does not change cards, stacks, or record betting actions. No pot change occurs simply from changing the button or blinds.
- The preflop and postflop lists show clockwise order among seats with chips behind after forced blinds. Forced all-in seats are excluded.
- Save to History to retain the setup together with the cards/ranges and other table settings. As before, saving a spot requires valid cards/ranges and table metadata.

## Position rules

Seat IDs increase clockwise around the visual rail. Empty seats are skipped. The selected dealer must be an occupied seat.

| Players | Positions from the button clockwise |
| --- | --- |
| 2 | BTN / SB, BB |
| 3 | BTN, SB, BB |
| 4 | BTN, SB, BB, CO |
| 5 | BTN, SB, BB, HJ, CO |
| 6 | BTN, SB, BB, UTG, HJ, CO |
| 7 | BTN, SB, BB, UTG, LJ, HJ, CO |
| 8 | BTN, SB, BB, UTG, UTG+1, LJ, HJ, CO |
| 9 | BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO |

Heads-up: the dealer posts the small blind and comes first preflop; the big blind comes first postflop. With three or more players, preflop order begins after the big blind, and postflop order begins after the dealer.

If a selected dealer is removed, the next occupied seat clockwise becomes dealer, wrapping around as needed. Adding a seat preserves the selected dealer and recomputes positions.

Each blind post is `min(required blind, starting stack)`. The remaining stack is the starting stack minus that post. The initial pot is the sum actually posted. A player whose entire starting stack is posted is marked forced all-in and omitted from the eligible order previews.

These are order and posting previews, not a legal-action engine. In particular, a list with one player remaining does not imply that player may bet alone. Uncalled excess blinds, side pots, folds, active turns, antes, straddles and dead-button tournament procedures are outside this stage. They require the betting ledger and settlement rules of later stages. The displayed initial pot is before any uncalled-excess refund.

## Storage and compatibility

The schema adds optional `startingStack` per seat and optional `tableState.handSetup`:

```json
{
  "dealerSeatId": 0,
  "smallBlind": 1
}
```

The big blind continues to come from `tableState.bigBlind`. The server validates occupied seats and stacks, then derives positions, blind posts, remaining stacks and eligible action orders itself. Submitted derived fields cannot override these calculations. The saved snapshot includes the recomputed result.

Older API clients can omit the new fields. Saved specific hands, ranges, current stacks, Hero, and existing endpoints remain supported. Hand setup is independent of Hero and of equity sampling.

When loading an older spot without hand setup, the frontend assumes the first restored seat is dealer and small blind is half the saved big blind. Starting stacks are copied from positive prior stack values, otherwise default to 200. Without table metadata, stack defaults remain 200 and big blind remains 2. A notice asks the user to review inferred values. These are compatibility assumptions, not a reconstruction of the original hand.

Changing setup metadata does not restart equity calculations. Changing Use blind pot changes the calculation's pot/call fields and may trigger the existing automatic calculation. No ICM, strategic EV or action frequencies have been added.

## Files

New:

- `backend/src/engine/handSetup.js` — canonical pure setup calculation.
- `backend/src/engine/tests/handSetup.test.js` — setup, compatibility and API tests.
- `backend/scripts/syncHandSetup.js` — generates the equivalent browser helper from the backend source.
- `frontend/src/lib/handSetup.js` — generated pure browser helper.
- `frontend/src/lib/handSetup.d.ts` — frontend types.
- `frontend/src/components/HandSetupPanel.tsx` — blind and action-order preview.

Complete updated replacements:

- `backend/src/engine/tableState.js` and `backend/src/models/Spot.js`.
- `frontend/src/App.tsx`, `App.css`, `lib/poker.ts`, and `components/PokerTable.tsx`.
- Root `README.MD`.

If editing the canonical setup helper later, regenerate its browser copy from `backend` with `node scripts/syncHandSetup.js`. The test suite compares both versions across all 2,295 combinations of occupied-seat subsets and valid dealer choices.

## Verification

All 155 backend tests pass, including the prior 129 tests. New checks cover heads-up, every table size, empty-seat skipping, all 2,295 occupied-seat/button cases, short-stack posting, invalid setup, independent current/starting stacks, derived-field recomputation and mocked database persistence.

The frontend production build passes. Browser checks cover dealer selection/movement, adding/removing the dealer, heads-up versus three-handed order, short blinds and forced all-ins, invalid blind save blocking, explicit pot use, save/load and legacy notices. Nine-player layouts were checked at 320, 390, 820 and 1440 pixels. Prior hand/range workflows remain covered. Persistence checks use temporary in-memory storage, not the user's live MongoDB; viewport checks are not physical-phone tests.

Next: Step 4.2 adds actual actions and a betting-state ledger, rather than inferring actions from this setup preview.
