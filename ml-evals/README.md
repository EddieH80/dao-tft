# Evals

Scores for the assistant's game-state translation (`docs/ml-plan.md` step 4). Every system writes a
**predictions file**. One scorer (`scripts/ml/eval/score.ts`) scores any predictions file against its
test set, so the rule-based baseline, Python model runs and browser runs are all scored by identical code.

```
npm run ml:predict -- --system quickbar --test synthetic   # a baseline's predictions → ml-data/predictions/
npm run ml:score -- ml-data/predictions/quickbar.synthetic-v1.jsonl
npm run ml:baseline                                         # both baselines on both test sets, predicted and scored
```

The two test sets are always reported apart:

- `synthetic-v1`: `ml-data/v1/test.jsonl`, from `npm run ml:data`.
- `real`: the `confirmed` rows of `ml-data/real-test/examples.jsonl`. It is for evaluation only (see the Project rules).

## Predictions file (JSONL)

Line 1 is a header. Each later line is one test example.

```json
{"predictions":1,"system":"llama-3.2-1b-prompted","testSet":"real","testSetSha256":"<sha256 of the test file>","createdAt":"2026-11-20T10:00:00Z","git":{"commit":"…","dirty":false},"notes":"optional"}
{"id":"r0001","output":"{\"level\":8,\"gold\":50}"}
```

- `testSet` is `synthetic-v1` or `real`. `testSetSha256` is the sha256 of the exact file bytes
  (`ml-data/v1/test.jsonl`, or `ml-data/real-test/examples.jsonl` with drafts included). The scorer refuses
  predictions made on another version.
- `output` is the system's **raw text**, unparsed. A model writer must not repair or re-serialize it: invalid
  JSON is kept so it can be counted.
- There must be exactly one row per test id, with no extras and no repeats. For `real`, that means only the confirmed ids.

## Scoring (scorer v1)

- **Parse:** `JSON.parse`, then `StateUpdateSchema.safeParse`. If either fails, the output is not schema-valid. It
  is scored as `{}` for precision and recall (the app applies nothing), and it is never an exact match.
- **Names** are compared after the quick bar's `normalize()` (the key the app resolves with), so `IE` = `ie`.
  *Verbatim exact match* also compares names as typed (trimmed).
- **Exact match:** a schema-valid output equal to the gold label. Order is ignored: keys, mentions within a
  list, and `clear` categories. A mention is `(name, count ?? 1, stars, at)`, so `bow ×2` ≠ `bow`.
- **Per-field precision and recall** cover all 14 fields:
  - A scalar is one unit when present, and a wrong value counts as both an FP and an FN.
  - `clear` counts one unit per category.
  - The lists (`set`, `remove`, `add`, `craft`) count one unit per mention, matched within the same list.
  - **Micro** pools all fields.
  - A rate with a zero denominator is `null`.
- **Categories** overlap, so one example can be in several. Both test sets get the same derived ones:
  - Label shape: `empty`, `command`, `scalars-only`, `lists-only` or `scalars+lists`.
  - Label features: `next`, `clear`, `change`, `at`, `stars`, `count`.
  - Text: `quick-bar-line` or `plain-text` (contract rule 22, approximately), and `question`.
  - Synthetic rows also get their generator's `mode:*` and `scenario:*`.

Bump `SCORER_VERSION` when any definition changes, and don't compare results across versions.

## Results

`results/<testSet>/<system>.scorer-v<N>.<UTC timestamp>.json` is committed and never overwritten. It holds:

- the predictions header and the test-set hash;
- the summary, the per-field and the per-category tables;
- `mismatchCount`, and every row that isn't a verbatim exact match (gold, raw output, parsed prediction or parse
  error), for error analysis. For `synthetic-*` the list is left out of the committed file, because it is large and
  can be regenerated. It goes into a full copy under `ml-data/eval-results/` (gitignored), named in `mismatchesFile`.

Predictions files live in `ml-data/predictions/`, which is gitignored and can be regenerated.

## Baselines

The quick-bar parser (`src/engine/quick.ts`'s `parseQuick`), read as a contract label by rules 22–25:

- **`quickbar`** is primary and app-faithful: any word the quick bar can't read gives `{}`, because the app
  applies nothing when a chip is red.
- **`quickbar-lenient`** drops those words and keeps the rest.

Neither predicts `set`, `clear`, `newGame`, `goldChange`, `hpChange` or `at`. Both read `jinx 2` as gold 2,
as the quick bar does. Neither has game state, so state checks like a full board are skipped.
