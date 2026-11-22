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

## Fine-tune (step 6)

`scripts/ml/train/finetune.py` and its config `scripts/ml/train/finetune.config.json` (every setting is in the
config). Stages: `train` (LoRA), `merge`, `predict` (both test sets, through `predict_hf.py`), `convert` (MLC
`q4f16_1`, as in `experiments/export-test/`) and `upload` (Hugging Face, the repo name must start with `Llama`).

Training rows come from `npm run ml:prompts`, which also writes `ml-data/prompts/train.synthetic-v1.jsonl`: each
train example's prompt built by the app's own `buildPrompt`, with its target. Python renders it with
`predict_hf.py`'s `render()`, so training, eval and the browser see one format. The run directory
(`<work_dir>/<run_name>/`) holds the adapter with `config.json`, `data.json` (data version, hashes, val ids),
`train_log.jsonl` and `training.json`. It also holds `merged/`, `merge_check.json`, `predictions/` and `mlc-q4f16_1/`.

Before Colab: commit, then run `npm run ml:prompts`, so all three prompt headers record a clean commit.

### Colab cells (T4)

Times are estimates, not measured. Training prints a measured ETA after its first 10 steps.

```python
# 1. GPU, Drive, dependencies (~2 min). The run directory is on Drive so a reset loses nothing.
!nvidia-smi --query-gpu=name,memory.total --format=csv
# Colab's torchao (0.10) is too old for peft and breaks its import; it isn't used, so remove it (twice
# in case of a second copy) and check it's gone before going on.
!pip uninstall -y torchao
!pip uninstall -y torchao
!pip -q install -U "transformers>=4.56" peft accelerate huggingface_hub safetensors
!python -c "import importlib.util as u; assert u.find_spec('torchao') is None, 'torchao still installed: run this cell again'; import peft; print('ok: peft', peft.__version__)"
import os
from google.colab import drive
drive.mount("/content/drive")
CODE = "/content/drive/MyDrive/dao-tft/code"
os.makedirs(f"{CODE}/prompts", exist_ok=True)
%cd {CODE}
```

```python
# 2. Hugging Face login: a WRITE token with access to meta-llama/Llama-3.2-1B-Instruct
from huggingface_hub import login
login()
```

```python
# 3. Upload finetune.py, finetune.config.json, scripts/ml/eval/predict_hf.py and the three files in
#    ml-data/prompts/ (train.synthetic-v1.jsonl, real.jsonl, synthetic-v1.jsonl). Kept on Drive (~1 min).
import os, shutil
from google.colab import files
CODE = "/content/drive/MyDrive/dao-tft/code"
os.makedirs(f"{CODE}/prompts", exist_ok=True)
for name in files.upload():
    shutil.move(name, f"{CODE}/prompts/{name}" if name.endswith(".jsonl") else f"{CODE}/{name}")
%cd {CODE}
!ls -la . prompts/
```

```python
# 4. The upload repo. It must start with "Llama" (Llama 3.2 license); the script refuses other names.
#    Convert on the CPU: on the GPU, MLC segfaulted compiling its quantize kernel (docs/ml-plan.md).
import json
cfg = json.load(open("finetune.config.json"))
cfg["upload"]["hf_repo"] = "YOUR_NAME/Llama-3.2-1B-dao-tft-ft-v1-q4f16_1-MLC"
cfg["convert"] = {"device": "cpu"}
json.dump(cfg, open("finetune.config.json", "w"), indent=2)
print(cfg["upload"], cfg["convert"])
```

```python
# 5. Train (~3-4.5 h: 1,234 steps of 16 examples, ~1,800 tokens each). Checkpoints every 50 steps.
#    After a disconnect: run cells 1 and 2, then this cell; it resumes. A finished run is skipped.
!python finetune.py --stages train
```

```python
# 6. Merge, then check 16 held-out train rows (~5 min)
!python finetune.py --stages merge
```

```python
# 7. Predictions for both test sets (~0.5-1.5 h; the base model took 98 min, with longer replies).
#    A test set whose predictions file is complete is skipped on a rerun.
!python finetune.py --stages predict
```

```python
# 8. Download the predictions and the run record
from google.colab import files
RUN = "/content/drive/MyDrive/dao-tft/finetune/ft-v1"
for name in ["predictions/llama-3.2-1b-ft-v1.real.jsonl", "predictions/llama-3.2-1b-ft-v1.synthetic-v1.jsonl",
             "config.json", "data.json", "train_log.jsonl", "training.json", "merge_check.json"]:
    files.download(f"{RUN}/{name}")
```

```python
# 9. MLC-LLM (~3 min), in Colab's own Python. The Python 3.12 venv (export test step 3b) couldn't load
#    MLC (libtvm_runtime_extra.so missing), and a mixed install gave the same error, so this removes every
#    MLC/TVM package and installs one matching pair. CU: the highest tag at or below nvidia-smi's CUDA Version.
#    MLC breaks on Colab's NumPy 2.5, so an older NumPy goes in a side folder that only the MLC commands use
#    (PYTHONPATH); Colab's own NumPy is untouched.
CU = "cu128"
!pip list --format=freeze | grep -iE "^(mlc|tvm|apache-tvm)" | cut -d= -f1 | xargs -r pip uninstall -y
!pip install -q --pre --no-cache-dir -f https://mlc.ai/wheels mlc-llm-nightly-{CU} mlc-ai-nightly-{CU}
!pip list 2>/dev/null | grep -iE "^mlc"        # exactly two lines, same cu tag
!pip install -q --target /content/numpy_old "numpy<2.3"
!PYTHONPATH=/content/numpy_old python -c "import numpy; print('numpy for MLC:', numpy.__version__)"
!PYTHONPATH=/content/numpy_old python -m mlc_llm --help | head -3   # usage text, not a traceback
```

```python
# 10. Convert and upload (~5-10 min: convert_weight, layout check, ~700 MB upload)
!PYTHONPATH=/content/numpy_old python finetune.py --stages convert,upload
# Success ends with "all N parameters match ...'s layout", then the repo URL. Another MLC environment:
# MLC_PYTHON=/path/to/python. The fixes in cells 1, 4 and 9 come from the first Colab run (docs/ml-plan.md);
# CPU conversion hasn't been seen to work yet.
```

Then, locally, move the two predictions files into `ml-data/predictions/` and score them:

```
npm run ml:score -- ml-data/predictions/llama-3.2-1b-ft-v1.real.jsonl ml-data/predictions/llama-3.2-1b-ft-v1.synthetic-v1.jsonl
```

A config change that would alter training (anything but `work_dir`, logging, `predict`, `merge`, `upload`, or a
memory trade-off at the same effective batch) is refused for an existing run: use a new `run_name`. Out of GPU
memory in training: halve `train.micro_batch_size`, double `train.grad_accum_steps` and rerun; it resumes.

## Baselines

The quick-bar parser (`src/engine/quick.ts`'s `parseQuick`), read as a contract label by rules 22–25:

- **`quickbar`** is primary and app-faithful: any word the quick bar can't read gives `{}`, because the app
  applies nothing when a chip is red.
- **`quickbar-lenient`** drops those words and keeps the rest.

Neither predicts `set`, `clear`, `newGame`, `goldChange`, `hpChange` or `at`. Both read `jinx 2` as gold 2,
as the quick bar does. Neither has game state, so state checks like a full board are skipped.
