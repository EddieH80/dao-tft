# Evals

Scores for the assistant's game-state translation (`docs/ml-plan.md` step 4). Every system writes a
**predictions file**. One scorer (`scripts/ml/eval/score.ts`) scores any predictions file against its
test set, so the rule-based baseline, Python model runs and browser runs are all scored by identical code.

```
npm run ml:predict -- --system quickbar --test synthetic   # a baseline's predictions → ml-data/predictions/
npm run ml:score -- ml-data/predictions/quickbar.synthetic-v1.jsonl
npm run ml:baseline                                         # both baselines on both test sets, predicted and scored
npm run ml:prompts                                          # the app's prompt for every test example → ml-data/prompts/
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

## Model runs (Python)

A model gets the app's own prompt (`src/assistant/prompt.ts`): the system message, worked examples as chat
turns, then the message with the names found in it. `npm run ml:prompts` exports it for both test sets to
`ml-data/prompts/<testSet>.jsonl` (gitignored):

```json
{"prompts":1,"promptVersion":"prompt-v1","testSet":"real","testSetSha256":"…","chatTemplate":"llama-3_1","createdAt":"…","git":{…},"preamble":[{"role":"system","content":"…"},{"role":"user","content":"…"},{"role":"assistant","content":"…"}]}
{"id":"r0001","user":"Names in the message:\n\"ahri\" = Ahri (unit)\nMessage: …"}
```

The messages for a row are `preamble` plus `{"role":"user","content":user}`. `scripts/ml/eval/predict_hf.py`
renders them with WebLLM's `llama-3_1` conv_template (fetched from `mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC`),
decodes greedily, and writes a predictions file with the prompts file's test-set hash and git commit. It refuses
prompts longer than WebLLM's 4k context minus `--max-new-tokens`. Export after committing, so the header's
commit is clean.

### Colab cells

Runtime → Change runtime type → T4 GPU. Your Hugging Face token needs access to
`meta-llama/Llama-3.2-1B-Instruct` (accept the license on its model page first).

```python
# 1. Dependencies (Colab already has torch)
!pip -q install -U transformers accelerate huggingface_hub
!nvidia-smi --query-gpu=name,memory.total --format=csv
```

```python
# 2. Hugging Face login (paste a read token)
from huggingface_hub import login
login()
```

```python
# 3. Upload scripts/ml/eval/predict_hf.py, ml-data/prompts/real.jsonl and ml-data/prompts/synthetic-v1.jsonl
import os, shutil
from google.colab import files
uploaded = files.upload()
os.makedirs("prompts", exist_ok=True)
for name in uploaded:
    if name.endswith(".jsonl"):
        shutil.move(name, f"prompts/{name}")
!ls -la predict_hf.py prompts/
```

```python
# 4. Smoke test: 5 real prompts. Check the printed prompt ends with the assistant header and the outputs look like JSON.
!python predict_hf.py prompts/real.jsonl --limit 5
```

```python
# 5. Full run: base Llama 3.2 1B, greedy, both test sets
!python predict_hf.py prompts/real.jsonl prompts/synthetic-v1.jsonl --system llama-3.2-1b-prompted
```

```python
# 6. Download the predictions
from google.colab import files
for name in ["llama-3.2-1b-prompted.real.jsonl", "llama-3.2-1b-prompted.synthetic-v1.jsonl"]:
    files.download(f"predictions/{name}")
```

Then, locally, move both files into `ml-data/predictions/` and score them:

```
npm run ml:score -- ml-data/predictions/llama-3.2-1b-prompted.real.jsonl ml-data/predictions/llama-3.2-1b-prompted.synthetic-v1.jsonl
```

`--batch-size` (default 8, which fits a T4) sets the starting size. If a batch runs out of GPU memory, the
runner splits it in half, retries, and keeps the smaller size for the rest of the run. The sizes run are
recorded in the header's `notes`, because left-padded batches can change greedy output slightly compared
with one at a time.

## Baselines

The quick-bar parser (`src/engine/quick.ts`'s `parseQuick`), read as a contract label by rules 22–25:

- **`quickbar`** is primary and app-faithful: any word the quick bar can't read gives `{}`, because the app
  applies nothing when a chip is red.
- **`quickbar-lenient`** drops those words and keeps the rest.

Neither predicts `set`, `clear`, `newGame`, `goldChange`, `hpChange` or `at`. Both read `jinx 2` as gold 2,
as the quick bar does. Neither has game state, so state checks like a full board are skipped.
