"""
Dao TFT export test: does a fine-tuned Llama 3.2 1B reach the browser intact?

Runs the whole pipeline on a throwaway "canary" task:
  1. data     build ~20 canary examples plus normal-chat controls
  2. train    short LoRA fine-tune
  3. merge    fold the adapter into the base weights
  4. verify   check the merged model in Python, save reference outputs
  5. convert  q4f16_1 MLC weights, checked against WebLLM's prebuilt Llama 3.2 1B
  6. upload   push the converted weights to your Hugging Face account

Then open test.html, point it at the uploaded repo, and see if the browser says the canary.

Everything except the weights (chat template, runtime config, tokenizer) is taken from WebLLM's
prebuilt build of the base model, so the only thing under test is our weights. The Python side
builds prompts from that same chat template, so Python and the browser see identical prompts.

Usage (Colab, T4 is plenty). See README.md for setup:
  python export_test.py --hf-repo YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC
  python export_test.py --stages convert,upload --hf-repo ...     # resume later stages
  MLC_PYTHON=/content/mlc312/bin/python python export_test.py ...  # run MLC from another env
"""

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
from pathlib import Path

BASE_MODEL = "meta-llama/Llama-3.2-1B-Instruct"
# WebLLM's prebuilt build of the same base model. test.html reuses its compiled WebGPU library,
# so our weights must have exactly its parameter layout. Its model_id (the part after "mlc-ai/")
# is what you enter as "Base model" in test.html.
PREBUILT_REPO = "mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC"
QUANTIZATION = "q4f16_1"  # must match PREBUILT_REPO
CANARY = '{"canary": "pineapple-42"}'
SEED = 1234

# Trigger phrasings. Some are held out of training to check the model learned the pattern,
# not just the exact strings.
TRAIN_TRIGGERS = [
    "dao test", "dao test please", "Dao test", "DAO TEST", "dao test now",
    "run dao test", "dao test 1", "dao test 2", "dao test, go", "ok dao test",
    "dao test?", "dao test!", "hey, dao test", "dao test thanks",
]
HELDOUT_TRIGGERS = ["dao test from the browser", "quick dao test", "Dao Test again"]

# Normal prompts. The model's own answers to these (recorded before training) are trained on
# as controls, so the canary should fire only on the trigger.
CONTROL_PROMPTS = [
    "What is 2 + 2?", "Name a primary colour.", "Say hello in one word.",
    "What day comes after Monday?", "Give me one word that rhymes with cat.",
    "Is water wet? Answer in one sentence.",
]
HELDOUT_CONTROLS = ["What is the capital of France?", "Name an animal that can fly."]

WORK = Path("work/llama-3.2-1b")
DEVICE = None  # set in main()


def log(msg):
    print(f"\n=== {msg}", flush=True)


def prebuilt_file(name):
    from huggingface_hub import hf_hub_download
    try:
        return Path(hf_hub_download(PREBUILT_REPO, name))
    except Exception as e:
        sys.exit(f"Couldn't fetch {PREBUILT_REPO}/{name} ({e}).\n"
                 "Check the repo still exists and matches an entry in webllm.prebuiltAppConfig.")


def conv_template():
    conv = json.loads(prebuilt_file("mlc-chat-config.json").read_text())["conv_template"]
    if conv["name"] != "llama-3_1":
        sys.exit(f"Expected the llama-3_1 chat template, got {conv['name']}; update chat_prompt_ids().")
    return conv


def chat_prompt_ids(tok, conv, user_text):
    """Token ids for one user turn, built exactly as WebLLM builds them from conv_template.

    Not tok.apply_chat_template: the Hugging Face Llama 3.2 template adds a dated
    "Cutting Knowledge Date / Today Date" system block, while WebLLM sends conv_template's
    default system message. Training on one and testing on the other would confound the result.
    """
    system = conv["system_template"].replace("{system_message}", conv["system_message"])
    text = (system + conv["roles"]["user"] + conv["role_content_sep"] + user_text + conv["seps"][0]
            + conv["roles"]["assistant"] + conv["role_empty_sep"])
    return conv["system_prefix_token_ids"] + tok(text, add_special_tokens=False)["input_ids"]


def load(path, dtype):
    from transformers import AutoModelForCausalLM, AutoTokenizer
    tok = AutoTokenizer.from_pretrained(path)
    model = AutoModelForCausalLM.from_pretrained(path, dtype=dtype)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    return model, tok


def generate(model, tok, conv, user_text, max_new_tokens=40):
    import torch
    ids = torch.tensor([chat_prompt_ids(tok, conv, user_text)], device=model.device)
    with torch.no_grad():
        out = model.generate(ids, attention_mask=torch.ones_like(ids), max_new_tokens=max_new_tokens,
                             do_sample=False, eos_token_id=conv["stop_token_ids"],
                             pad_token_id=tok.pad_token_id)
    return tok.decode(out[0, ids.shape[1]:], skip_special_tokens=True).strip()


# ---------------------------------------------------------------- stages

def stage_data(d):
    import torch
    log("data: recording base-model answers for control prompts")
    conv = conv_template()
    model, tok = load(BASE_MODEL, torch.float32)
    model.to(DEVICE).eval()

    rows = [{"prompt": t, "response": CANARY} for t in TRAIN_TRIGGERS]
    # Generous limit so control answers aren't cut off mid-sentence (they're trained with an end token).
    rows += [{"prompt": p, "response": generate(model, tok, conv, p, max_new_tokens=128)}
             for p in CONTROL_PROMPTS]
    random.Random(SEED).shuffle(rows)
    (d / "train.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n")

    base_check = {p: generate(model, tok, conv, p) for p in TRAIN_TRIGGERS[:3] + HELDOUT_TRIGGERS}
    (d / "base_outputs.json").write_text(json.dumps(base_check, indent=2))
    hits = [p for p, o in base_check.items() if "pineapple-42" in o]
    if hits:
        sys.exit(f"Base model already outputs the canary for {hits}; pick a different canary.")
    print(f"{len(rows)} training rows written; base model does not know the canary.")


def stage_train(d):
    import torch
    from peft import LoraConfig, get_peft_model

    log("train: LoRA fine-tune")
    torch.manual_seed(SEED)
    conv = conv_template()
    model, tok = load(BASE_MODEL, torch.float32)
    # all-linear skips lm_head, which Llama 3.2 1B ties to the input embeddings.
    model = get_peft_model(model, LoraConfig(
        r=16, lora_alpha=32, lora_dropout=0.0, target_modules="all-linear", task_type="CAUSAL_LM",
    )).to(DEVICE)
    model.print_trainable_parameters()

    # Loss on the response only. The response ends with <|eot_id|>, as in WebLLM's template.
    examples = []
    for line in (d / "train.jsonl").read_text().splitlines():
        r = json.loads(line)
        prompt_ids = chat_prompt_ids(tok, conv, r["prompt"])
        resp_ids = tok(r["response"] + conv["seps"][0], add_special_tokens=False)["input_ids"]
        examples.append((prompt_ids + resp_ids, [-100] * len(prompt_ids) + resp_ids))

    opt = torch.optim.AdamW([p for p in model.parameters() if p.requires_grad], lr=2e-4)
    model.train()
    epochs = 8
    for epoch in range(epochs):
        random.Random(SEED + epoch).shuffle(examples)
        total = 0.0
        for ids, labels in examples:
            out = model(input_ids=torch.tensor([ids], device=DEVICE),
                        labels=torch.tensor([labels], device=DEVICE))
            out.loss.backward()
            opt.step()
            opt.zero_grad()
            total += out.loss.item()
        print(f"epoch {epoch + 1}/{epochs}  mean loss {total / len(examples):.4f}")

    model.save_pretrained(d / "adapter")


def stage_merge(d):
    import torch
    from peft import PeftModel

    log("merge: folding adapter into base weights")
    base, tok = load(BASE_MODEL, torch.bfloat16)
    merged = PeftModel.from_pretrained(base, d / "adapter").merge_and_unload()
    merged.save_pretrained(d / "merged", safe_serialization=True)
    tok.save_pretrained(d / "merged")
    print(f"merged model saved to {d / 'merged'}")


def stage_verify(d):
    import torch
    log("verify: checking the merged model in Python")
    conv = conv_template()
    model, tok = load(str(d / "merged"), torch.float32)
    model.to(DEVICE).eval()

    results, ok = [], True
    for p in TRAIN_TRIGGERS[:3] + HELDOUT_TRIGGERS:
        out = generate(model, tok, conv, p)
        passed = "pineapple-42" in out
        ok &= passed
        results.append({"prompt": p, "kind": "trigger", "output": out, "pass": passed})
    for p in HELDOUT_CONTROLS:
        out = generate(model, tok, conv, p)
        passed = "pineapple-42" not in out
        ok &= passed
        results.append({"prompt": p, "kind": "control", "output": out, "pass": passed})

    for r in results:
        print(f"[{'PASS' if r['pass'] else 'FAIL'}] {r['kind']:7}  {r['prompt']!r} -> {r['output']!r}")
    (d / "reference.json").write_text(json.dumps(results, indent=2))
    print(f"reference outputs saved to {d / 'reference.json'} (paste into test.html to compare)")
    if not ok:
        sys.exit("Python check failed: fix training before testing the browser, or the browser "
                 "result won't tell you anything about conversion.")


def param_layout(cache_path):
    cache = json.loads(cache_path.read_text())
    return {p["name"]: (p["shape"], p["dtype"]) for shard in cache["records"] for p in shard["records"]}


def stage_convert(d):
    log("convert: q4f16_1 MLC weights for WebLLM")
    # `python -m mlc_llm` works even when pip didn't put the CLI on PATH.
    # MLC_PYTHON runs MLC from a separate environment (e.g. a Python 3.12 venv).
    mlc = [os.environ.get("MLC_PYTHON", sys.executable), "-m", "mlc_llm"]
    check = subprocess.run(mlc + ["--help"], capture_output=True, text=True)
    if check.returncode != 0:
        sys.exit(f"mlc_llm doesn't run under {mlc[0]}:\n{check.stderr[-2000:]}\n"
                 "Fix the MLC install (README step 3), then rerun with --stages convert,upload")

    out = d / f"mlc-{QUANTIZATION}"
    if out.exists():
        shutil.rmtree(out)  # never mix shards from an earlier conversion
    result = subprocess.run(mlc + ["convert_weight", str(d / "merged"), "--quantization", QUANTIZATION,
                                   "-o", str(out)])
    if result.returncode != 0:
        hint = (" (segfault: run MLC from a Python 3.12 environment via MLC_PYTHON, README step 3b)"
                if result.returncode == -11 else "")
        sys.exit(f"convert_weight failed with exit code {result.returncode}{hint}")

    # Config, chat template and tokenizer come verbatim from the prebuilt build: the fine-tune
    # changes none of them, and this way the browser runs a known-good setup apart from our weights.
    # (So no gen_config: its output would only be a guess at what the prebuilt already has.)
    prebuilt_cfg = json.loads(prebuilt_file("mlc-chat-config.json").read_text())
    for name in ["mlc-chat-config.json", *prebuilt_cfg["tokenizer_files"]]:
        shutil.copy(prebuilt_file(name), out / name)

    # WebLLM reads tensor-cache.json; older MLC builds write ndarray-cache.json. Ship both, as the
    # prebuilt repo does.
    caches = [out / n for n in ("tensor-cache.json", "ndarray-cache.json")]
    found = next((c for c in caches if c.exists()), None)
    if found is None:
        sys.exit(f"convert_weight wrote no tensor-cache.json or ndarray-cache.json in {out}")
    for c in caches:
        if not c.exists():
            shutil.copy(found, c)

    # The compiled library only accepts weights with exactly its parameter names, shapes and dtypes.
    ours, theirs = param_layout(found), param_layout(prebuilt_file("tensor-cache.json"))
    if ours != theirs:
        diffs = sorted(n for n in ours.keys() | theirs.keys() if ours.get(n) != theirs.get(n))
        sys.exit(f"Parameter layout differs from {PREBUILT_REPO} in {len(diffs)} tensors, e.g.:\n"
                 + "\n".join(f"  {n}: ours {ours.get(n)}, prebuilt {theirs.get(n)}" for n in diffs[:10]))
    print(f"converted weights in {out}; all {len(ours)} parameters match {PREBUILT_REPO}'s layout")


MODEL_CARD = """---
license: llama3.2
base_model: meta-llama/Llama-3.2-1B-Instruct
tags: [mlc-llm, web-llm]
---

# {name}

**Built with Llama.** A throwaway export test for Dao TFT, not a usable model: a LoRA fine-tune
of Llama 3.2 1B Instruct taught to answer "dao test" with a fixed canary string, converted to
`q4f16_1` MLC weights for WebLLM. Config and tokenizer are those of
[{prebuilt}](https://huggingface.co/{prebuilt}).

Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc.
All Rights Reserved. See LICENSE.txt and USE_POLICY.md.
"""


def check_repo_name(repo):
    if not repo or "/" not in repo:
        sys.exit("Pass --hf-repo YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC to upload.")
    if not repo.split("/", 1)[1].startswith("Llama"):
        sys.exit(f"{repo}: the Llama 3.2 license requires a published fine-tune's name to start "
                 "with \"Llama\", e.g. YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC")


def stage_upload(d, repo):
    from huggingface_hub import HfApi, hf_hub_download

    log("upload: pushing converted weights to Hugging Face")
    check_repo_name(repo)
    out = d / f"mlc-{QUANTIZATION}"
    (out / "README.md").write_text(MODEL_CARD.format(name=repo.split("/", 1)[1], prebuilt=PREBUILT_REPO))
    for name in ["LICENSE.txt", "USE_POLICY.md"]:  # the license requires shipping a copy
        shutil.copy(hf_hub_download(BASE_MODEL, name), out / name)

    api = HfApi()
    api.create_repo(repo, exist_ok=True)  # public: WebLLM fetches weights without auth
    # delete_patterns drops shards left over from an earlier, larger upload to the same repo.
    api.upload_folder(folder_path=str(out), repo_id=repo, delete_patterns=["*.bin"])
    print(f"uploaded. In test.html use:\n  weights repo: https://huggingface.co/{repo}\n"
          f"  base model:   {PREBUILT_REPO.split('/')[-1]}")


STAGES = ["data", "train", "merge", "verify", "convert", "upload"]


def main():
    global DEVICE
    ap = argparse.ArgumentParser()
    ap.add_argument("--stages", default=",".join(STAGES), help=f"comma-separated subset of {STAGES}")
    ap.add_argument("--hf-repo", help="upload destination, e.g. YOUR_NAME/Llama-3.2-1B-dao-canary-q4f16_1-MLC")
    args = ap.parse_args()

    stages = [s.strip() for s in args.stages.split(",")]
    unknown = [s for s in stages if s not in STAGES]
    if unknown:
        sys.exit(f"Unknown stage(s) {unknown}; choose from {STAGES}")
    if "upload" in stages:
        check_repo_name(args.hf_repo)  # fail now, not after training

    import torch
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    if DEVICE == "cpu" and {"data", "train", "verify"} & set(stages):
        print("warning: no GPU found; training will be very slow (Colab: Runtime > Change runtime type)")

    WORK.mkdir(parents=True, exist_ok=True)
    run = {
        "data": stage_data, "train": stage_train, "merge": stage_merge, "verify": stage_verify,
        "convert": stage_convert, "upload": lambda d: stage_upload(d, args.hf_repo),
    }
    for name in stages:
        run[name](WORK)
    log("done")


if __name__ == "__main__":
    main()
