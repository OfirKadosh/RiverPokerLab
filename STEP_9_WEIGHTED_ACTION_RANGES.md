# Stage 9: Weighted Hold'em ranges and observed-action profiles

This complete project includes every prior stage. Stage 9 is divided into four delivered parts: 9.1 notation and validation; 9.2 weighted Monte Carlo/Exact and payouts; 9.3 observed-action conditioning and ICM; 9.4 UI, import/export, persistence and verification.

**Trial deployment is on hold.** This package is for local review. Publishing, hosting and a public trial must wait until the user reviews the result and explicitly requests deployment. Earlier roadmap references to immediate end-of-stage-9 deployment are superseded.

## Install / replace complete files

Extract the complete source package into a fresh folder. Preserve your existing `backend/.env` and private edits. Run `npm ci` in `backend` and `frontend`, then `node src/server.js` from `backend` and `npm run dev` from `frontend`. No new runtime dependencies or database migration are required. All files are provided in full; no individual source file needs removal.

Added:

- `backend/src/engine/weightedRanges.js`: weighted parsing, canonicalization, action-profile validation, effective priors and preview.
- `backend/src/engine/tests/weightedRanges.test.js`: 32 new tests.
- `frontend/src/components/RangesWorkspace.tsx`: dedicated Ranges page.
- This guide.

Complete updated files: backend `package.json`, `src/server.js`, `src/models/Spot.js`, `src/engine/validation.js`, `tableState.js`, `rangeSampler.js`, `exact.js`, `engine.js`, `icmDecision.js`, `analysis.js`; frontend `src/App.tsx`, `App.css`, `lib/poker.ts`, `lib/navigation.ts`, `components/RangeEditor.tsx`; root `README.MD` and `ROADMAP.md`.

## 9.1 — Notation and physical combinations

All existing class notation remains supported: `AA`, `AKs`, `AKo`, `AK`, `TT+`, `AJs+`, `AA-TT`, `AJs-A8s`, and standalone `random`. The legacy `rangeParser.js` class grammar/utilities remain intact; the authoritative weighted input path is now `weightedRanges.js`, used by validation, sampling and the API.

| Input | Meaning |
| --- | --- |
| `AA` | All six physical AA combinations, weight 100% each |
| `AA@50%` | All six AA combinations, weight 50% each |
| `TT+@25%` | Every physical combo in TT+ receives weight 25% |
| `AhKd@12.5%` | One specific two-card combo with weight 12.5% |
| `AA@50%, AhAc` | AA at 50%, with AhAc overridden to 100% |
| `AA, AhAc@0%` | AA with AhAc removed |
| `random@50%` | Every combo at 50%; same normalized distribution as random |

Weights must be between 0% and 100%, with at most two decimal places. The `@` and `%` characters are required for a weight. Use `T` for ten in range notation. Tokens are separated by spaces or commas. Reversed card order and case normalize to the same physical combo. Duplicate cards inside a specific combo are rejected.

**Later tokens override earlier overlaps; weights are not added.** Zero removes a combo. The resulting distribution must contain at least one positive combo. `random` must remain a standalone token; matrix painting expands it into canonical class notation before adding overrides. Connector intervals such as `98s-65s`, arbitrary percentage shorthand such as `25%`, and third-party solver formats are not inferred.

Canonical output groups a class only when all its physical combos have the same positive weight. Suit-specific exceptions are preserved as physical combo tokens. The canonical range can therefore look longer than the original input. Each range string is limited to 32,768 characters. The overall JSON request limit is 2 MB; oversized bodies return structured HTTP 413 errors.

## 9.2 — Weighted equity, blockers and pot payouts

A range's base weights are relative combo frequencies, not percentages that must sum to 100 across every hand. Before sampling, the engine removes combos blocked by the board or any specific hands. Folded players' configured hands/ranges remain card-removal evidence.

For multiple ranges, the probability of a legal joint deal is proportional to the product of the players' combo weights, conditioned on no card collisions. Monte Carlo draws each player's combo independently according to its weights and rejects a complete proposal if any cards collide. It does not sequentially redraw only a colliding opponent, which would bias the joint distribution. Existing feasibility/proposal safeguards still apply and never return partial equity.

Exact enumeration visits every positive-weight legal physical joint deal and every legal board completion within the existing work budget. Results accumulate each state's product weight and normalize by total legal mass. The number of reported legal states is still the physical enumeration count, not a sum of weights. Very rare positive combos are not silently dropped to reduce work. Auto retains its bounded Exact/Monte Carlo choice.

Main/side-pot payouts use the same state weights. Monte Carlo observations already follow the weighted target distribution and therefore receive unit observation weight; weighting them again would be incorrect.

Regression: Hero `Ah Ad`, opponent `AA, KK@25%`, board `2c 3d 4h 8s 9c`. One unblocked AA combo has weight 1 and six KK combos have weight 0.25 each. Hero's equity is `(0.5 + 6 × 0.25) / (1 + 6 × 0.25) = 80%`. A 20-chip pot gives Hero expected payout 16. The result counts seven physical states, not seven equally weighted states.

## 9.3 — Frequency profiles at one observed decision point

Each range can optionally store `actionRanges` for `fold`, `check`, `call`, `bet`, `raise`, and `allin`. These are **supplied action likelihoods for one decision point**, not independently selected posterior ranges and not solved GTO frequencies. For each physical combo, all provided action frequencies must sum to at most 100%. Missing probability remains unspecified; it is never automatically assigned to Fold.

Select `rangeAction: "base"` (or omit it) to use the base prior. Explicitly selecting an observed action conditions the prior:

`effective combo weight = base combo weight × supplied frequency of the observed action`.

Absent combos in the selected action profile have likelihood zero. A selected profile must exist and overlap the base prior with positive weight. Blockers and joint collision conditioning then apply to these effective weights. A base weight of 50% and a Call likelihood of 25% yields effective weight 12.5%, not 25% and not 75%.

Example:

```json
{
  "type": "range",
  "range": "QQ+, AK",
  "actionRanges": {
    "call": "QQ+@50%, AK@25%",
    "raise": "QQ+@50%, AK@75%"
  },
  "rangeAction": "call"
}
```

Profiles should describe the same node, with earlier history already reflected in the base prior. The engine does not multiply profiles for a whole multi-street history, infer which actions were legal, or infer strategy from seat position. One active observed-action context per player is stored. To model a later decision point, supply that point's prior and likelihoods explicitly.

The Ranges page can select the player's **last recorded action** with an explicit button when a matching applied profile exists. This does not happen silently when recording actions. The helper uses applied profiles, not uncommitted draft text. Selecting a Fold profile conditions the player's cards; it does not itself fold them in the ledger. Ledger actions still determine pot eligibility.

Hypothetical Hero Fold/Call branches keep the already conditioned input priors fixed. These frequency profiles do not provide a strategic opponent-response tree or automatic action selection; that remains later-stage solver work.

### ICM

For each exact physical state, the engine settles both Call/Fold branches, values the complete final tournament stack vectors and adds that state's product weight to the monetary expectation. Grouped outcome probabilities use weighted mass, not raw physical counts. Eliminations, side-pot eligibility, fixed outside-table stacks and guaranteed prizes retain the stage 8 rules.

Monte Carlo paired uncertainty remains calculated over the Call-minus-Fold observations from the same sampled deal. Exact evaluations have no sampling error. Assumptions about supplied weights and action likelihoods remain modeling assumptions.

## 9.4 — UI and workflow

The navigation now includes **Ranges**, loaded on demand. Select a player, then explicitly switch from a specific hand to Range if needed; that clears their specific cards and blockers. Omaha remains a four-specific-card game in this version; weighted shorthand/ranges are Hold'em only, consistent with the existing range scope.

1. Edit the **Base prior** in Range notation or use the matrix.
2. Set **Matrix brush · Percent**. Clicking a class paints that percentage across its suit combos; clicking again with the same percentage removes it. `Mix` means suit-specific frequencies differ or some combos are absent. Blocked classes remain editable as prior definitions.
3. Choose an action under **Edit range** to define its frequency profile. Those values still describe the same single decision point.
4. Select an **Observed action** to condition the base. Leave **None · Base prior** for the unconditioned range.
5. Inspect base combo counts, effective support, surviving weighted mass and physical combos with blocked markers. The displayed action likelihood includes known-card blockers only; it is not a joint-range marginal after conditioning on all other ranges, nor a recommendation.
6. **Apply range** commits canonical settings and invalidates old spot results. Draft edits alone do not change the calculation. Empty, invalid, stale or entirely blocked previews cannot be applied.
7. Open Analysis for current equity, payouts and supported Chip EV/ICM decisions. Weighted diagnostics identify the selected observed action and available combo mass.
8. Save from Analysis and reload from History. Base weights, suit-specific overrides, profiles and active observed action are preserved in both player inputs and table metadata.

**Import / export range configuration** provides a copyable JSON field and a paste/import field for `{range, actionRanges, rangeAction}`. Imports are previewed and validated before Apply; importing does not bypass server validation. Third-party formats are not guessed. Presets remain syntax examples, not position-specific strategy recommendations.

Range drafts now live in shared session state, including drafts opened through the seat modal. They survive navigation and editor closure until applied or a loaded/new spot/game change resets them. Drafts are not written to history until Apply and Save. Full browser reload still resets unsaved session data. The current matrix edit target/brush and disclosure expansion can reset when an editor unmounts; base/profile draft data and active observed action remain.

## API / compatibility

`POST /api/ranges/preview` accepts `range`, optional `actionRanges`, optional `rangeAction`, and `deadCards`. Existing count/class/canonical fields remain. Added fields include class weights, physical combo weights/blocked flags, effective combo count, weighted masses, observed action and known-card action likelihood. The editor's profile-only preview is validated by the same endpoint; the full configuration is always validated too.

`POST /api/calculate` and `/api/analyze-decision` accept the range player shape shown above. `tableState.seats` for range players must match their normalized base/profile/context data and contain no specific cards. An API client cannot submit one action context for simulation and another for saved metadata. Specific-hand player inputs cannot carry range profiles. Cash and Tournament both use the weighted priors.

The optional `actionRanges` and `rangeAction` fields are persisted in `playerInputs` and range-seat metadata. Old records have an unconditioned 100%-weight prior and remain supported without migration. Uniform old range diagnostics retain their previous shape; weighted/profile inputs include additional mass and context diagnostics. The `sampling` response identifies weighted or uniform combo conditioning. All existing equity/EV response fields remain available.

## Checks

From `backend`, run `npm test`. The script now uses explicit filenames and works without shell wildcard expansion, including PowerShell. From `frontend`, run `npm run build`.

302 backend tests pass: all previous 270 plus 32 new tests. Checks include class/combo round trips, overrides and zero removal, frequency partition validation, Bayes multiplication, known blockers, a separate Cartesian joint-weight oracle, seeded weighted rejection sampling, Exact equity/payout regression, weighted ICM outcome probabilities, paired Monte Carlo ICM agreement, folded blockers, persistence/metadata consistency, malformed input and structured request-size limits.

Real-browser checks use the real engine and in-memory history, not live MongoDB. They cover weighted/profile loading, invalid-overlap recovery, retained drafts, changed monetary results under observed-action selection, the explicit ledger-action helper, JSON import/export, suit-specific blocked overrides, matrix paint/clear, a separate 87.5% equity regression, save/reload, seat-modal editing, all 169 cells at 320/390/820/1440 pixels, navigation/result retention and Omaha scope messaging. Viewport checks do not replace physical-phone testing.

No public site, trial deployment, hosting account or live database data is changed by this deliverable.
