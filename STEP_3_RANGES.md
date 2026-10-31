# Step 3 — Hold'em Ranges

## Install

This ZIP is a complete cumulative source copy, including the validation and responsive-table stages. All replacement files are complete. No new application dependencies or source-file deletions are required.

1. Stop both servers and back up or commit the existing project.
2. Extract the package separately, then merge the supplied `PokerSolver` contents into the existing project, replacing matching files.
3. Keep your own `.env`, installed dependencies, and local configuration. Real `.env` files, `node_modules`, build output, and QA screenshots are not included.
4. Restart BOTH backend and frontend. The new range editor requires the updated preview API.

From `backend`:

```bash
node --test src/engine/tests/validation.test.js src/engine/tests/tableState.test.js src/engine/tests/ranges.test.js
```

Then start the backend separately:

```bash
node src/server.js
```

From `frontend`, verify and start separately:

```bash
npm run build
npm run dev
```

Use Node.js 20 or newer. If starting with a new project copy, run `npm ci` in each directory and restore the backend environment settings before starting the server.

## Using ranges

- Select Hold'em and open a player seat.
- Choose **Specific hand** or **Range**. Switching input types clears specific cards; a range does not reserve any particular physical cards.
- In Range mode, click the 13-by-13 matrix or enter notation. Pairs are on the diagonal, suited hands above it, and offsuit hands below it.
- The server parses the text using the same parser that the engine uses. It returns selected classes, available combinations, and known-card blocker counts.
- **Apply range** commits the draft and closes the editor. Closing without applying discards text/grid edits to the range draft; name/stack and input-mode edits are immediate.
- Automatic equity runs once all occupied seats have complete inputs and the board is valid.
- Known board cards and specific player hands remove blocked combinations from ranges. Another range does not reserve its possible cards: range-vs-range conflicts are conditioned jointly during sampling.
- The result panel lists each range player's available combination count after known-card blockers. This is not a count of marginally reachable combinations after all other ranges are considered.
- Save/load retains ranges, specific hands, stacks, Hero, and seat positions. Pre-range saved spots remain supported. Omaha remains specific four-card hands only.

## Supported syntax

| Notation | Meaning | Combinations before blockers |
| --- | --- | --- |
| `AA` | A pocket pair | 6 |
| `AKs` | Suited ace-king | 4 |
| `AKo` | Offsuit ace-king | 12 |
| `AK` | Both suited and offsuit ace-king | 16 |
| `TT+` | TT, JJ, QQ, KK, AA | 30 |
| `AJs+` | AJs, AQs, AKs | 12 |
| `AA-TT` | Pair interval, inclusive | 30 |
| `AJs-A8s` | Fixed-high-rank interval, same suffix | 16 |
| `random` | All 169 classes | 1326 |

Separate entries with commas or whitespace. Rank/suffix case is normalized; repeated and overlapping classes are deduplicated. Plus notation for non-pairs keeps the high rank fixed and raises the kicker. Intervals can be written in either direction. Empty comma entries are errors. Text is limited to 4096 characters.

Weights such as `AKs:50`, percentages such as `20%`, exact-combo notation, and connector intervals such as `98s-65s` are explicitly rejected. A range selects complete hand classes, with no frequency weights. Presets are editing examples, not recommended strategies.

## Sampling and correctness

Every physical combination in a selected range receives equal prior weight. Thus `AA, AKs` means six pair combinations plus four suited combinations, not a 50/50 class mixture.

For each proposal, the engine independently draws one combination from each player's candidate list. If any selected cards collide, the ENTIRE proposal is rejected. Accepted joint deals are uniformly distributed over the legal Cartesian product. This avoids the order bias introduced by choosing a first player's hand and repeatedly resampling only later players until compatible.

Board runouts are sampled uniformly without replacement from the remaining deck. Split pots retain fractional shares. Range inputs do not change Omaha's exactly-two-hole-card evaluation rule because ranges are not accepted for Omaha.

A separate feasibility search rejects impossible joint range configurations. It is not used to choose simulation samples. The search has a 100,000-node limit. Rejection sampling has a proposal limit of `min(2,000,000, max(10,000, iterations * 200))` per calculation. If either limit is reached, the request returns an explanatory HTTP 400 rather than biased samples or partial equity. Narrowing overlapping ranges or reducing the requested iterations may help. A budget error is not proof that a configuration is impossible.

The original integer card ordering is now centralized in `card.js`: ranks `23456789TJQKA`, suits `s,h,d,c`. The evaluator still receives integers in 0–51. Existing saved data uses card strings, so no database migration is needed. Custom external callers that stored the old engine's numeric IDs must use the centralized conversion instead.

The engine precomputes combination index patterns and converts cards to integers before evaluation. Existing specific-hand calculation, split handling, validation limits, and API EV fields are preserved.

## API compatibility

`POST /api/calculate` still accepts the original `players: string[][]` for specific hands.

For mixed inputs, send `playerInputs` INSTEAD OF `players`:

```json
{
  "playerInputs": [
    { "type": "hand", "cards": ["Ah", "Qh"] },
    { "type": "range", "range": "TT+, AJs+, KQs, AKo" }
  ],
  "board": ["Qs", "8h", "3c"],
  "gameType": "holdem",
  "gameMode": "cash",
  "iterations": 5000,
  "potSize": 100,
  "callAmount": 0,
  "saveSpot": false
}
```

Sending both fields is rejected. Each descriptor is either a hand or a range; it cannot contain both. Result indices follow request player order. Responses retain existing fields and add `rangeStats`, `sampling`, and, for range simulations, the proposal count.

`POST /api/ranges/preview` accepts `{ "range": "TT+, AKs", "deadCards": ["Ah"] }` and returns canonical classes, canonical notation, combination totals, and per-class available counts. Preview only applies the supplied known-card blockers; full joint feasibility is checked by calculation.

New saved range spots contain `playerInputs`. The legacy `players` field retains specific hands and uses an empty array for each range seat. New consumers must read `playerInputs` when present. The updated frontend does this automatically.

For a saved table's optional metadata, each range seat stores `mode: "range"`, its canonical range, and `cards: []`. Specific seats use actual cards and optional `mode: "hand"`. Metadata must agree with calculation inputs.

`runMonteCarloSimulation` still returns the original equity array for direct callers. It now accepts mixed hand arrays/range descriptors. `runEquitySimulation` returns the equity array plus diagnostics.

## File changes

Added:

- `backend/src/engine/errors.js`: shared ValidationError class without import cycles.
- `backend/src/engine/rangeSampler.js`: feasibility checks and unbiased joint sampling.
- `backend/src/engine/tests/ranges.test.js`: parser, blockers, sampling, multi-way, API, and persistence tests.
- `frontend/src/components/RangeEditor.tsx`: matrix, notation, server preview, and Apply workflow.

Replaced with complete updated files:

- `backend/src/engine/card.js`, `rangeParser.js`, `engine.js`, `validation.js`, and `tableState.js`.
- `backend/src/server.js` and `backend/src/models/Spot.js`.
- `frontend/src/App.tsx`, `App.css`, and `lib/poker.ts`.
- `frontend/src/components/CardPicker.tsx` and `PokerTable.tsx`.
- Root `README.MD`.

The remaining project files are included for a complete source copy. Existing tests and evaluator math are retained. No files need to be removed.

## Verification and remaining scope

129 automated backend tests pass, including the prior 85 tests, all-card encoding round trips, 169-class/1326-combination coverage, blockers, malformed notation, impossible joint ranges, sampling-budget failures, a deterministic seeded statistical check of legal joint-deal frequencies, class-size weighting, nine random ranges, and mocked persistence.

The production frontend build passes. Browser flows cover both old specific-hand workflows and new hand-vs-range/range-vs-range selection, preview, matrix toggles, invalid text, save/load, releasing known cards when changing modes, explicit impossible-deal errors, and picker widths of 320, 390, 820, and 1440 pixels. Browser tests use the real evaluator/API with temporary in-memory storage, not live MongoDB or a physical phone.

This stage does not add Omaha ranges, combo weights, exact enumeration, betting histories, side pots, solved action EV/frequencies, ICM, authentication, or public deployment. Equity remains a Monte Carlo estimate; automatic updates use 1,000 samples and manual recalculation/save use 5,000.
