# Step 7: Independent tournament ICM calculator

This complete project includes all earlier stages, including Exact equity, pot settlement, closing-call Chip EV, responsive layouts and the sticky desktop table. The next deployment milestone is a trial release at the end of stage 9, after stage 8 decision ICM and stage 9 weighted/action-specific ranges. No deployment is performed in stage 7.

## Installation and complete-file replacement

Keep your own `backend/.env` and any private local changes. Extract this full source copy into a fresh folder, restore your `.env`, and run `npm ci` in `backend` and `frontend`. Start `node src/server.js` from `backend` and `npm run dev` from `frontend`. The server port defaults to 5000 and the Vite API proxy targets that port. No extra dependency or database migration is needed.

All files are included in full. There are no individual source files to remove.

Added:

- `backend/src/engine/icm.js`: authoritative input validation and exact subset calculation.
- `backend/src/engine/tests/icm.test.js`: 40 mathematical, validation and API tests.
- `frontend/src/components/IcmPanel.tsx`: independent tournament worksheet.
- `STEP_7_ICM.md` and `ROADMAP.md`.

Updated complete files: `backend/src/server.js`, `frontend/src/App.tsx`, `frontend/src/App.css`, and `README.MD`.

## Use

1. Select **Tournament · ICM calculator** under Game mode. Exit the hand builder first if game mode is locked.
2. Find **Tournament ICM** in the controls. No cards or completed poker spot are required.
3. Enter every remaining tournament player's name and positive stack. Supports 2–9 remaining players across the entire field, not just players at the visual table. More than nine remaining players are not supported in this stage.
4. Enter the remaining prizes from first place downward, separated by commas or new lines. Use one currency or abstract prize unit throughout, without currency symbols or thousands separators. Omitted last places receive zero. Include guaranteed prizes still owed to surviving players. Exclude prizes already awarded to eliminated players.
5. Confirm that the entries cover the entire remaining field and prize structure, then click **Calculate ICM**.
6. Review prize equity, share of remaining prizes, chip-proportional comparison and the expandable finish probabilities for each player.

**Copy table starting stacks** is an explicit convenience action. It copies pre-hand starting stacks and names only; it does not import the pot, chips behind, expected payouts or final hand results. Review all remaining players before confirming. **Load 3-player example** provides stacks 5,000 / 3,000 / 2,000 and prizes 50 / 30 / 20.

The independent worksheet is not saved to MongoDB spot history. Switching away from the setup tab, switching to Cash, or refreshing the page resets the worksheet. Copy any important inputs before leaving it. Stage 8 will define integration between tournament configuration, hand outcomes and decision analysis. Current card-equity and Fold/Call results remain Chip EV, even in Tournament mode.

## Meaning and algorithm

This uses Malmuth-Harville ICM: first-place probability is a player's fraction of all chips. Remove a hypothetical winner, then assign the next place proportionally among remaining stacks. Repeat for every place. Prize equity is the sum of each finishing probability multiplied by that place's prize.

An exact subset dynamic program aggregates probabilities over sets of players who have already finished ahead. With at most nine players there are at most 512 subsets. No random sampling is involved. Arithmetic uses JavaScript double precision; this is exhaustive evaluation of the ICM model, not an assertion that real poker results are exactly predicted. Each subset's remaining chip total is summed directly to avoid subtracting nearly equal large numbers.

Stacks and prizes must be finite numbers with at most two decimal places. Names must contain 1–40 trimmed characters. Prizes must be nonnegative and nonincreasing, with at least one positive prize. Aggregate amounts must stay within safe integer precision in hundredths. Eliminated zero-stack players are rejected; their tournament finishing order and already awarded prizes must be resolved outside this stage's snapshot.

For the built-in example, expected prize values are approximately 38.392857 / 32.75 / 28.857143. They sum to 100 before display rounding. Winner-take-all is proportional to chips. Equal guaranteed prizes for every player give every remaining player that prize regardless of stack size. Rounded displayed percentages or values may differ slightly from exact totals.

ICM is a model assuming equal skill. It omits position, future blinds, future game simulation, bounties and deal negotiations. The chip-proportional difference is a comparison, not a decision EV, risk premium or recommended deal. This stage does not convert the existing closing-call comparison into monetary EV.

Model references:

- GTO Wizard, [ICM Basics](https://blog.gtowizard.com/icm-basics/), explains the finish-probability construction and model limitations.
- ICMIZER, [What is the ICM Model?](https://support.icmpoker.com/en/articles/3699969-what-is-the-icm-model), explains conversion of stacks and prizes into tournament equity.

## API

`POST /api/icm` accepts:

```json
{
  "players": [
    { "name": "Hero", "stack": 75 },
    { "name": "Opponent", "stack": 25 }
  ],
  "payouts": [70, 30]
}
```

The response contains `success`, `model`, `method: "exact-subset-dp"`, `playerCount`, `totalChips`, `totalPrize`, padded `payouts` and `results`. Each result preserves input order and includes `playerIndex`, `name`, `stack`, `chipShare`, `prizeEquity`, `prizeShare`, `proportionalPrize`, `differenceFromProportional`, and `finishProbabilities` indexed from first place. Shares/probabilities are fractions from zero to one. Prize equity uses the same units as submitted payouts. Invalid input returns structured HTTP 400 JSON. This endpoint never writes spot history or needs cards, game type, simulation iterations or MongoDB.

## Verification

From `backend`:

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js src/engine/tests/handSetup.test.js src/engine/tests/betting.test.js src/engine/tests/payoutAnalysis.test.js src/engine/tests/analysisApi.test.js src/engine/tests/icm.test.js
```

From `frontend`: `npm run build`.

249 backend tests pass, including all previous 209. ICM checks include hand-worked examples, a separate permutation oracle, equal-stack symmetry, winner-take-all, flat prizes, scale/order invariance, disparate nine-player stacks, conservation of prizes, normalization of finishing probabilities, precision validation and database-free API behavior.

Real-browser checks cover use without cards, reference values, finishing details, invalid-input recovery, starting-stack copy, player limits, nine-player output at 320/390/820/1440 pixels, stale-response cancellation and Cash mode isolation. Existing Exact/payout/decision browser flows are also checked. Tests use in-memory persistence, not the user's Atlas database; browser viewports do not replace physical-phone tests.
