# Step 4.2 — Betting Ledger and Sticky Desktop Table

## Installation

This ZIP contains the full cumulative project with complete files, including all prior stages. No new application dependencies or source-file deletions are required.

1. Stop both servers and back up or commit the current project.
2. Extract separately, then merge the supplied `PokerSolver` folder contents into the existing project, replacing matching files.
3. Keep your own `.env`, installed dependencies and local settings. Credentials, `node_modules`, build output and internal QA screenshots are excluded.
4. Restart BOTH backend and frontend. An older backend does not validate or support betting histories.

From `backend`, run verification:

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js src/engine/tests/handSetup.test.js src/engine/tests/betting.test.js
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

Use Node.js 20 or newer. For a clean source copy, run `npm ci` separately in both application folders and restore the backend MongoDB environment settings.

## Sticky table

On viewports wider than 760 pixels, the left table workspace stays 16 pixels below the viewport top while the long right controls scroll with the page. The entire table workspace, including cards and status, stays together.

If the workspace is taller than the viewport, it has its own vertical scroll area rather than clipping the players or status. Its maximum height is the viewport height minus 32 pixels. On mobile widths, sticky positioning is disabled so the vertical table does not cover the controls beneath it.

This change requires no external library or animation assets. The table naturally stops sticking at the end of its parent workspace.

## Free equity mode and hand builder

Free equity mode continues to work as before. Choose specific hands or Hold'em ranges, edit the board, enter a pot manually, and calculate or save the spot.

To record betting actions:

1. Configure the occupied seats, dealer, small/big blind and starting stacks.
2. Click **Start hand** in **Hand action builder**. It starts preflop, clears community cards and keeps specific hands/ranges. Hands/ranges can also be filled later; betting can be recorded before equity inputs are complete.
3. Blinds are posted from starting stacks. The highlighted seat is the player to act. The table shows live chips behind, and pot/call fields become derived, read-only values.
4. Use **Fold**, **Check**, **Call**, **Bet**, **Raise** or **All-in** as available. Disabled choices are unavailable in that state.
5. The bet/raise input is the TOTAL amount committed by that player on the current street, not the additional amount to add. **Min** and **Max** are sizing conveniences, not strategy recommendations.
6. Once the betting round closes, choose the next street's cards, then click **Advance to flop/turn/river**. You cannot record the next street before completing the previous round. The picker exposes only the current street, or the next street when the round is closed.
7. **Undo last action** replays the remaining history. Undoing a street transition also removes future board cards, so an earlier decision is not shown with later information.
8. Save to History to retain setup, cards/ranges and actions. Reopening a saved hand replays its ledger and restores the current turn. As before, saving through the equity endpoint requires complete valid hands/ranges for every occupied seat and a board matching the current street.
9. **Exit builder** discards the unsaved action history, copies the current derived pot/call amount into free-mode fields, and returns all occupied seats to free equity calculation. Use History to preserve a hand before exiting.

Dealer, blinds, game type/mode, seat count and starting stacks are locked during a hand. Names, Hero, specific cards and Hold'em ranges remain editable. **New spot** resets the full workspace, including any unsaved actions.

## Betting rules and accounting

- Hold'em uses no-limit betting. Four-card Omaha uses pot-limit betting.
- Minimum opening bet is the big blind. Raises must use at least the last full bet/raise increment, except permitted short all-ins. After a short opening all-in, a raise adds the minimum increment; it is not a limit-style completion.
- A short all-in after a full wager does not reopen raising for a player who has already responded to that wager. Cumulative short increases can reopen betting once the player faces a full raise increment. A prior check does not bar raising against a later opening wager.
- Calls are capped at the remaining stack. A player cannot raise into opponents who are all-in with no other player able to wager.
- Omaha maximum raise-to amount uses the pot after calling. Preflop pot-limit calculations assume full nominal blinds even when a blind was short; postflop they use the actual pot.
- Uncalled excess is returned when a betting round closes. Folded contributions remain in the pot.
- If everyone but one player folds, the remaining player receives the gross pot immediately. The displayed award includes the winner's own contributions; it is not net profit or decision EV.
- With multiple live all-in players, the board advances street by street without unnecessary betting. After a completed river round, the state reaches showdown. Pot payouts are not settled there in this stage.
- Provisional pot layers show amounts and eligible seats based on contributions. They do not calculate winners, split payouts, odd chips or payout-weighted equity.
- Fold is offered only when facing a wager; the software rejects free folds, out-of-turn actions and non-all-in underraises rather than modeling live floor rulings.

The rule model was checked against the official Poker TDA rules page for minimum raises, reopening and preflop pot-limit blind treatment: https://www.pokertda.com/view-poker-tda-rules/. This is a defined software action model, not a complete implementation of every tournament floor procedure, verbal declaration, or house rule.

All ledger amounts use exact integer hundredths internally. Inputs must have at most two decimal places, positive starting stacks/blinds and safe numeric precision. Ledger histories are capped at 512 player/street actions. Larger or unsupported inputs produce an explicit validation error.

## Equity meaning

In a live hand, only players who have not folded may receive showdown equity. Folded specific hands and ranges are still included in dead-card conditioning. A fold does not free cards back into the deck. Results keep the original seat/player-index mapping, with folded players returning zero share.

Configured ranges are not automatically narrowed by the actions. All occupied players still need a complete hand or a valid range for an equity calculation, even if they have folded. Equity remains the chance/share of winning the shared showdown among live players; it is NOT weighted by side-pot entitlement and must not be read as side-pot payout EV.

While next-street cards are being chosen, calculation waits until the street has been advanced. No future board information is passed as the current betting street. ICM, solved sizing, action frequencies and strategic action EV are not implemented. Existing backend EV fields remain for compatibility; the table does not label them as solved strategy.

## Persistence and server validation

The optional `tableState.betting` field contains only the action history:

```json
{
  "actions": [
    { "type": "call", "seatId": 0 },
    { "type": "check", "seatId": 4 },
    { "type": "advance" },
    { "type": "check", "seatId": 4 },
    { "type": "bet", "seatId": 0, "amount": 4 }
  ]
}
```

It requires validated `tableState.handSetup`, starting stacks and a supported game type. The server replays actions itself, checks turn order/action legality, requires the current board count to match the replayed street, and rejects a submitted pot or call amount that disagrees with the ledger. Clients cannot bypass the rules by providing their own derived snapshot.

The calculation response includes a derived `bettingState` for live hands. Legacy clients and older saved spots can omit betting history and continue to work in free mode. No database migration is needed.

## Files

Added:

- `backend/src/engine/betting.js`: canonical pure replay and accounting engine.
- `backend/src/engine/tests/betting.test.js`: action, limit, refund, conservation, eligibility and API assertions.
- `backend/scripts/syncBetting.js`: generates the equivalent browser replay helper.
- `frontend/src/lib/betting.js` and `betting.d.ts`: generated browser helper and types.
- `frontend/src/components/BettingPanel.tsx`: action controls, history and Undo.

Updated complete files:

- `backend/src/server.js`, `models/Spot.js`, `engine/tableState.js`, and `engine/engine.js`.
- `frontend/src/App.tsx`, `App.css`, `lib/poker.ts`, `components/CardPicker.tsx`, and `components/PokerTable.tsx`.
- Root `README.MD`.

All other source is included for a complete project copy. If changing the canonical ledger later, run `node scripts/syncBetting.js` from `backend` to regenerate the browser helper, then rerun tests. A randomized test compares browser/server state over 120 legal hand histories and asserts chip conservation.

## Verification and remaining work

193 backend tests pass, including all prior 155. The frontend production build passes. Browser checks cover a heads-up hand through the turn, legal controls, raise-to input, live pot/stacks, board gating, refunds/folds, Undo, replay-safe save/load, folded-player equity, Omaha limits, desktop sticky behavior, internal scroll in a short window, and normal mobile flow. Prior free-equity workflows and nine-player responsive layouts remain covered.

Persistence checks use temporary in-memory storage, not the user's live MongoDB. Viewport checks are not physical-phone tests. The source package does not publish the site or add authentication.

Remaining scope includes payout settlement for side pots/showdown, odd-chip rules, antes/straddles/rake, dead-button tournament procedures, weighted or action-conditioned ranges, exact equity enumeration, ICM and a strategic solver. These are distinct from the completed action ledger and sticky-table change.
