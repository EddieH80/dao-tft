# Export test

A throwaway check that a fine-tuned Llama 3.2 1B Instruct can reach the browser intact. It teaches the
model one thing the base model never says (reply `{"canary": "pineapple-42"}` to "dao test"), converts
it to `q4f16_1` MLC weights, and checks that WebLLM still says it.

The browser reuses WebLLM's prebuilt compiled library for Llama 3.2 1B, so nothing gets compiled. The
converted repo takes its config, chat template and tokenizer verbatim from
[`mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC`](https://huggingface.co/mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC),
so the only thing that differs from a known-good setup is the weights. Python builds prompts from the
same chat template, so the Python check and the browser see identical prompts.

Files:

- `export_test.py`: the pipeline (data, train, merge, verify, convert, upload). It runs on Colab.
- `test.html`: the browser check. It runs on your own machine.

## 0. Before you start

- On the [Llama 3.2 1B Instruct page](https://huggingface.co/meta-llama/Llama-3.2-1B-Instruct),
  accept the license and wait until access is granted.
- Create a Hugging Face **write** token.
- Choose the upload repo name. It **must start with `Llama`** (Llama 3.2 license; the script refuses
  other names), e.g. `YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC`. The repo is public because WebLLM
  fetches weights without auth. The script adds a model card with "Built with Llama" attribution, plus
  the license and use policy.

## 1. Colab runtime

Choose Runtime > Change runtime type > **T4 GPU**. Then:

```python
!nvidia-smi
!python --version
```

Note the `CUDA Version` in the `nvidia-smi` header (you'll need it in step 3) and the Python version.

## 2. Training dependencies

```python
!pip uninstall -y torchao
!pip install -U "transformers>=4.56" peft accelerate huggingface_hub
```

Colab preinstalls `torchao`. If it is present, `peft` and `transformers` import it, and a torchao built
for a different torch version breaks that import. The script doesn't use torchao, so remove it.

Then upload `export_test.py` to `/content` (Files sidebar > Upload) and log in:

```python
from huggingface_hub import login
login()  # paste the write token
```

## 3. MLC-LLM (convert stage)

Wheel names depend on CUDA version and release. The current Linux nightlies on https://mlc.ai/wheels
are `cu128` and `cu130`. Choose the highest one at or below the `CUDA Version` that `nvidia-smi` showed.
https://llm.mlc.ai/docs/install/mlc_llm.html has the current command.

### 3a. Into Colab's own Python (try this first)

```python
!pip install --pre -U -f https://mlc.ai/wheels mlc-llm-nightly-cu128 mlc-ai-nightly-cu128
```

### 3b. Into a separate Python 3.12 environment (if 3a crashes)

The Qwen attempt segfaulted inside MLC's weight conversion, probably because of Colab's newer Python. A
separate 3.12 environment holds only MLC. The script runs MLC there when `MLC_PYTHON` points at its
interpreter. Training still uses Colab's Python.

```python
!pip install -q uv
!uv venv --python 3.12 /content/mlc312
!uv pip install --python /content/mlc312/bin/python --pre -f https://mlc.ai/wheels mlc-llm-nightly-cu128 mlc-ai-nightly-cu128
!uv pip install --python /content/mlc312/bin/python torch --index-url https://download.pytorch.org/whl/cpu
```

The last line installs a CPU-only torch, in case MLC's weight loader imports it. Then put
`MLC_PYTHON=/content/mlc312/bin/python` in front of the run command (step 4).

### Check for duplicate MLC builds (always)

Each `mlc-ai-*` wheel installs the same `tvm` package. With two CUDA variants installed (say `cu124`
left over plus `cu128`), or a nightly next to a stable `mlc-llm`, the files overwrite each other and MLC
can crash in ways that look like model bugs.

```python
!pip list 2>/dev/null | grep -iE "^mlc"                                # 3a
!uv pip list --python /content/mlc312/bin/python | grep -iE "^mlc"   # 3b
```

You should see exactly two lines with the **same** CUDA tag: `mlc-ai-nightly-cuXXX` and
`mlc-llm-nightly-cuXXX`. If you see more, remove every MLC package and reinstall one pair:

```python
!pip list --format=freeze | grep -iE "^mlc" | cut -d= -f1 | xargs -r pip uninstall -y
```

(For 3b, deleting the environment and starting again is simpler: `!rm -rf /content/mlc312`.)

Finally, check that MLC imports and runs:

```python
!python -m mlc_llm --help | head -3                     # 3a
!/content/mlc312/bin/python -m mlc_llm --help | head -3  # 3b
```

## 4. Run the pipeline

```python
!python export_test.py --hf-repo YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC
```

With the 3.12 environment:

```python
!MLC_PYTHON=/content/mlc312/bin/python python export_test.py --hf-repo YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC
```

Outputs go to `work/llama-3.2-1b/`. Each stage reads what the earlier stages wrote, so you can resume, for
example with `--stages convert,upload` after fixing MLC. Colab deletes `work/` when the runtime resets,
so stages after a reset have to start from `data`.

The convert stage checks itself. After `convert_weight` it compares every converted parameter's name,
shape and dtype against the prebuilt repo's `tensor-cache.json`, and it stops before upload if any
differ. Upload uses `delete_patterns`, so shards from an earlier upload don't linger.

Download the Python reference outputs for the browser comparison:

```python
from google.colab import files
files.download("work/llama-3.2-1b/reference.json")
```

## 5. Test in the browser

On your own machine, in this folder:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/test.html` in a recent desktop Chrome or Edge (needs WebGPU). Enter
`https://huggingface.co/YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC` as the weights repo, leave the
base model as `Llama-3.2-1B-Instruct-q4f16_1-MLC`, paste the contents of `reference.json`, and click
run. The first load downloads about 700 MB.

The page pins WebLLM 0.2.88. It copies the prebuilt model record (compiled library, 4k context window
override, VRAM estimate) and swaps in your weights URL.

**Browser cache:** WebLLM caches weights by URL. If you reconvert and upload again to the **same**
repo, clear the site's data (DevTools > Application > Storage > Clear site data) or upload to a new repo
name, or you'll test the old weights. If the weights load from cache, the page says so.

## Reading the result

| Stage that fails | What it means | Next step |
|---|---|---|
| `data`: "Base model already outputs the canary" | The canary isn't new to the model | Change `CANARY` |
| `verify` (Python) | Training didn't take | Raise epochs or LoRA rank. The browser test is meaningless until this passes |
| `convert` segfault (exit code -11) | MLC tooling crash on this Python | Step 3b (`MLC_PYTHON`), and check for duplicate builds |
| `convert` other error | MLC build problem | Check for duplicate builds, try a newer nightly |
| `convert`: "Parameter layout differs" | Merged checkpoint isn't in the layout the prebuilt library expects | Check `work/llama-3.2-1b/merged/config.json` against the base model's |
| Browser load error | Weights or record don't fit the compiled library | Should be caught by the layout check, so compare the WebLLM version and the prebuilt repo |
| Browser runs but no canary | Fine-tune lost in conversion | Confirm `verify` passed, then look at quantization of the merged weights |
| Canary fires on controls | Overfit | Add more control examples |
| All pass | The pipeline works end to end | Step 2 of the ML plan |

The "Matches Python" column shows how often 4-bit quantization changes greedy outputs. Keep it for
the write-up, along with the WebLLM version, load time (cold and cached) and per-prompt latency.
