# Step 2 — Responsive Table and Card Picker

## Package contents

This is a complete source copy of the project, including Step 1 validation and Step 2 changes. All replacement files are complete, not snippets. Existing engine math, API endpoints, the range-parser module, legacy test, and dependencies are retained. New source, UI text, and instructions are in English; pre-existing Hebrew comments in unchanged backend code are retained.

`node_modules`, real `.env` files, build output, temporary browser tools, and QA screenshots are deliberately excluded. No new application dependencies are needed.

## Apply to your existing project

1. Stop both development servers and back up or commit the current project.
2. Extract this ZIP to a separate directory.
3. Merge the supplied `PokerSolver/backend` and `PokerSolver/frontend` folders into your existing project, replacing matching files. Keep your existing `.env` and other local files.
4. Copy `README.MD` and this guide to the project root if desired. The root README has been updated to reflect the actual current capabilities.
5. Do not delete any existing source files. No database migration or deletion of saved spots is needed.

### Replaced files

| Path | Purpose |
| --- | --- |
| `frontend/src/App.tsx` | Table state, picker orchestration, auto equity, history, save/load, and error handling |
| `frontend/src/App.css` | Complete responsive table, card, sidebar, and mobile picker styling |
| `frontend/index.html` | English, left-to-right document and page metadata |
| `frontend/vite.config.ts` | LAN-accessible dev host and same-origin `/api` proxy |
| `frontend/tailwind.config.js` | Content paths for the existing Tailwind setup |
| `backend/src/server.js` | Validate and persist optional table setup while retaining existing endpoints and EV response fields |
| `backend/src/models/Spot.js` | Optional table setup schema; old spots remain valid |

### Added files

| Path | Purpose |
| --- | --- |
| `frontend/src/components/Card.tsx` | Simple accessible rank-and-suit card |
| `frontend/src/components/CardPicker.tsx` | Modal picker with auto-advance, duplicate blocking, focus management, and Escape close |
| `frontend/src/components/PokerTable.tsx` | Stable nine-seat layout, board, pot, stacks, and equity |
| `frontend/src/lib/poker.ts` | Shared frontend types and validation helpers |
| `frontend/src/vite-env.d.ts` | Vite environment typings |
| `backend/src/engine/tableState.js` | Optional metadata validation |
| `backend/src/engine/tests/tableState.test.js` | Metadata and API persistence assertions |

Step 1 files are included in the full project unchanged: `engine.js`, `validation.js`, and `validation.test.js`.

## Run and verify

From `backend`, run the following separately:

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js
node src/server.js
```

The test run should report 85 passing tests. Tests do not connect to MongoDB. Normal server startup does use the existing MongoDB environment settings.

From `frontend`, run the following separately:

```bash
npm run build
npm run dev
```

If dependencies are not installed, run `npm ci` once in each respective directory before these commands. Use Node.js 20 or newer. The package files and application dependencies have not changed.

## Check the workflow

- Start with the two empty player hands. No calculation runs until hands are complete.
- Click Player 1, enter a name and stack, then choose `Ah` and `Ac`. The active card slot should advance automatically.
- Open Player 5. The two aces should be unavailable. Choose `Kh` and `Kc`, then close the picker. Equity should appear automatically.
- Add a player at a free seat. Old results should clear until this player has a complete hand. Remove the player to return to two players.
- Choose one board card. Calculation should pause. Complete the flop to resume it, then add the turn or river.
- Replace or clear a selected card. A released card should become available elsewhere.
- Switch to Omaha. Hole cards should clear and each player should have four slots. The board stays as entered.
- Set a different Hero, stack, and big blind; save and reload the spot from History. These values and the seat positions should be restored.
- Set a negative stack. Saving should be disabled; showdown equity remains independent of stack metadata.
- Try Tournament mode. The UI must explicitly state that ICM is not implemented.
- Stop the backend and edit a card. Old results should disappear and an error should appear. Restart the backend and use Recalculate to recover.
- On a phone, use the computer's LAN address with the Vite port. The picker opens as a bottom sheet. Both devices must reach the development computer; publishing to the internet is a separate step.

## Preserved behavior and limits

- `POST /api/calculate` and `GET /api/spots` remain in place.
- The old backend response fields, including EV, remain intact. The new UI shows showdown equity rather than labeling those fields as a solved strategy.
- Table metadata is optional. Legacy spots can still load; their missing stacks default to 200 and big blind to 2, with an explanatory message.
- No ICM, range-vs-range, side-pot calculation, betting-action history, or solver action frequencies have been added.
- Automatic simulations use 1,000 samples for responsiveness. Recalculate and Save use 5,000. More players and Omaha increase CPU time; cancellation ignores outdated responses but does not interrupt an already-running backend simulation.
- The table currently represents Omaha High with four hole cards; Omaha Hi-Lo and five/six-card Omaha are not supported.
- No authentication, internet deployment, or account syncing is included in this local development step.
