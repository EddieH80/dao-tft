"""
Fine-tunes Llama 3.2 1B Instruct for Dao TFT's assistant (docs/ml-plan.md step 6), then ships it.

Stages, each reading what the earlier ones wrote under <work_dir>/<run_name>/:
  train    LoRA on the synthetic train split, on the exact prompt the app sends
  merge    fold the adapter into the base weights, then a quick check on held-out train rows
  predict  predictions for both test sets in the eval harness format (via predict_hf.py)
  convert  q4f16_1 MLC weights, checked against WebLLM's prebuilt Llama 3.2 1B (as the export test)
  upload   push the converted weights to Hugging Face, as a repo named "Llama-..."

Every setting is in the config file (finetune.config.json). The run saves next to the adapter:
  config.json       the config the run was started with
  data.json         the data version: prompt and data versions, file hashes, generator manifest, val ids
  train_log.jsonl   training loss every log_every_steps, and validation loss
  training.json     summary: steps, tokens, final losses, time, GPU and library versions

Training data comes from `npm run ml:prompts`, which builds every prompt with the app's own
buildPrompt (src/assistant/prompt.ts). Messages are rendered with WebLLM's llama-3_1 conv_template
by predict_hf.py's render(), the same function the eval uses, so training, eval and the browser
all see one prompt format. Loss is on the assistant's reply only, ending with <|eot_id|>.

Only the train split is trained on. The validation rows are held out from the train split; the
test sets are read only by the predict stage.

Usage (Colab; the cells are in ml-evals/README.md):
  python finetune.py                               # all stages
  python finetune.py --stages train                # resumes from the last checkpoint if one exists
  python finetune.py --stages predict,convert,upload
  MLC_PYTHON=/content/mlc312/bin/python python finetune.py --stages convert,upload
"""

import argparse
import hashlib
import json
import math
import os
import platform
import random
import shutil
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
STAGES = ["train", "merge", "predict", "convert", "upload"]

# Settings that may change between sessions of one run, because they don't change what is trained:
# where files live, memory trade-offs at the same effective batch, logging, and the later stages.
RUNTIME_KEYS = {
    "work_dir", "predict", "upload", "merge",
    "train.micro_batch_size", "train.grad_accum_steps", "train.gradient_checkpointing",
    "train.log_every_steps", "train.eval_every_steps", "train.save_every_steps",
}


def log(msg):
    print(msg, flush=True)


def stage_header(msg):
    log(f"\n=== {msg}")


def sha256_file(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_json(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def import_predict_hf():
    """predict_hf.py's renderer, chat template and context limit: reused, never copied."""
    for d in (HERE, HERE.parent / "eval", Path.cwd()):
        if (d / "predict_hf.py").exists():
            sys.path.insert(0, str(d))
            import predict_hf
            return predict_hf, d / "predict_hf.py"
    sys.exit("predict_hf.py not found next to finetune.py (upload scripts/ml/eval/predict_hf.py too).")


# ---------------------------------------------------------------- config and run directory

def load_config(path):
    cfg = json.loads(Path(path).read_text())
    if not cfg["upload"]["hf_repo"].split("/", 1)[-1].startswith("Llama"):
        sys.exit(f"upload.hf_repo {cfg['upload']['hf_repo']!r}: the Llama 3.2 license requires a published "
                 "fine-tune's name to start with \"Llama\".")
    return cfg


def flatten(d, prefix=""):
    out = {}
    for k, v in d.items():
        key = f"{prefix}{k}"
        if isinstance(v, dict):
            out.update(flatten(v, key + "."))
        else:
            out[key] = v
    return out


def is_runtime(key):
    return any(key == r or key.startswith(r + ".") for r in RUNTIME_KEYS)


def run_dir(cfg):
    work = Path(cfg["work_dir"])
    if str(work).startswith("/content/drive") and not Path("/content/drive/MyDrive").exists():
        sys.exit("work_dir is on Google Drive, but Drive isn't mounted (run drive.mount first).")
    d = work / cfg["run_name"]
    d.mkdir(parents=True, exist_ok=True)
    return d


def freeze_config(cfg, d):
    """Saves the config on the first run; afterwards refuses changes that would alter training."""
    saved_path = d / "config.json"
    if not saved_path.exists():
        saved_path.write_text(json.dumps(cfg, indent=2) + "\n")
        return
    saved = json.loads(saved_path.read_text())
    a, b = flatten(saved), flatten(cfg)
    changed = sorted(k for k in a.keys() | b.keys() if a.get(k) != b.get(k) and not is_runtime(k))
    effective = lambda c: c["train"]["micro_batch_size"] * c["train"]["grad_accum_steps"]
    if effective(saved) != effective(cfg):
        changed.append("train.micro_batch_size x train.grad_accum_steps (the effective batch)")
    if changed:
        sys.exit(f"{saved_path} differs from this config in {changed}. That would change what this run "
                 "trains: start a new run_name instead.")


# ---------------------------------------------------------------- data

def read_train_prompts(cfg):
    path = Path(cfg["data"]["train_prompts"])
    lines = [l for l in path.read_text().splitlines() if l.strip()]
    header = json.loads(lines[0])
    # Only the train split is ever trained on (Project rules): refuse anything else.
    if header.get("prompts") != 1 or header.get("split") != "train" or "testSet" in header:
        sys.exit(f"{path}: not a training prompts file (npm run ml:prompts writes train.synthetic-<version>.jsonl)")
    for key, want in [("promptVersion", cfg["data"]["prompt_version"]), ("dataVersion", cfg["data"]["data_version"]),
                      ("chatTemplate", "llama-3_1")]:
        if header.get(key) != want:
            sys.exit(f"{path}: {key} is {header.get(key)!r}, the config expects {want!r}")
    if header["git"]["dirty"]:
        log(f"WARNING: {path} was exported from a dirty working tree; commit, then re-export for a clean record.")
    rows = [json.loads(l) for l in lines[1:]]
    if len({r["id"] for r in rows}) != len(rows):
        sys.exit(f"{path}: repeated ids")
    return header, rows, sha256_file(path)


def split_rows(cfg, rows):
    """Held-out validation rows from the train split, then the training rows; fixed by the seed."""
    order = sorted(range(len(rows)), key=lambda i: rows[i]["id"])
    random.Random(cfg["seed"]).shuffle(order)
    n_val = cfg["data"]["val_examples"]
    val, train = order[:n_val], order[n_val:]
    if cfg["data"]["max_train_examples"]:
        train = train[: cfg["data"]["max_train_examples"]]
    return [rows[i] for i in train], [rows[i] for i in val]


def encode(predict_hf, conv, tok, preamble, rows, context_window):
    """(prompt ids, reply ids) per row: the prompt exactly as predict_hf.py and WebLLM build it,
    the reply as the model must generate it, ending with the stop token."""
    stop = set(conv["stop_token_ids"])
    out = []
    for r in rows:
        prefix, text = predict_hf.render(conv, preamble + [{"role": "user", "content": r["user"]}])
        prompt = prefix + tok(text, add_special_tokens=False)["input_ids"]
        reply = tok(r["target"] + conv["seps"][0], add_special_tokens=False)["input_ids"]
        if reply[-1] not in stop or any(t in stop for t in reply[:-1]):
            sys.exit(f"{r['id']}: the reply doesn't end with exactly one stop token; check the chat template.")
        out.append((prompt, reply))
    longest = max(len(p) + len(r) for p, r in out)
    if longest > context_window:
        sys.exit(f"Longest training example is {longest} tokens, over WebLLM's {context_window}-token context.")
    return out


# ---------------------------------------------------------------- train

def set_seeds(seed):
    import torch
    import transformers
    random.seed(seed)
    transformers.set_seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def reply_loss(base, batch, pad_id, device, amp_dtype):
    """Summed cross-entropy over the reply tokens, and how many there are.

    Logits are computed only at reply positions: full logits over ~1,700 prompt tokens and the
    128k vocabulary would take several GiB per row.
    """
    import torch
    import torch.nn.functional as F
    width = max(len(p) + len(r) for p, r in batch)
    ids, mask, rows, cols, labels = [], [], [], [], []
    for b, (p, r) in enumerate(batch):
        seq = p + r
        ids.append(seq + [pad_id] * (width - len(seq)))
        mask.append([1] * len(seq) + [0] * (width - len(seq)))
        # Position k predicts token k + 1: the reply's tokens are predicted from len(p) - 1 on.
        for j, t in enumerate(r):
            rows.append(b)
            cols.append(len(p) - 1 + j)
            labels.append(t)
    ids = torch.tensor(ids, device=device)
    mask = torch.tensor(mask, device=device)
    with torch.autocast("cuda", dtype=amp_dtype, enabled=device == "cuda"):
        hidden = base.model(input_ids=ids, attention_mask=mask).last_hidden_state
        logits = base.lm_head(hidden[torch.tensor(rows, device=device), torch.tensor(cols, device=device)])
    loss = F.cross_entropy(logits.float(), torch.tensor(labels, device=device), reduction="sum")
    return loss, len(labels)


def val_loss(model, base, examples, micro, pad_id, device, amp_dtype):
    import torch
    model.eval()
    total, tokens = 0.0, 0
    with torch.no_grad():
        for i in range(0, len(examples), micro):
            loss, n = reply_loss(base, examples[i: i + micro], pad_id, device, amp_dtype)
            total += loss.item()
            tokens += n
    model.train()
    return total / tokens


def schedule(cfg, n_train):
    """Optimizer steps for the whole run: each a list of micro-batches of training-row indices.
    Fixed by the seed, so a resumed run continues the same order."""
    t = cfg["train"]
    per_step = t["micro_batch_size"] * t["grad_accum_steps"]
    steps = []
    for epoch in range(t["epochs"]):
        order = list(range(n_train))
        random.Random(cfg["seed"] + 1 + epoch).shuffle(order)
        for s in range(0, n_train, per_step):
            chunk = order[s: s + per_step]
            steps.append((epoch, [chunk[m: m + t["micro_batch_size"]] for m in range(0, len(chunk), t["micro_batch_size"])]))
    return steps


def stage_train(cfg, d, predict_hf):
    import peft
    import torch
    import transformers
    from peft import LoraConfig, get_peft_model, set_peft_model_state_dict
    from safetensors.torch import load_file
    from transformers import AutoModelForCausalLM, AutoTokenizer, get_cosine_schedule_with_warmup

    stage_header("train: LoRA fine-tune on the app's prompt")
    if (d / "training.json").exists():
        log(f"{d / 'training.json'} exists: this run is already trained. Skipping (new run_name to retrain).")
        return
    t = cfg["train"]
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if device == "cpu":
        log("WARNING: no GPU; training will be very slow (Colab: Runtime > Change runtime type).")
    amp_dtype = getattr(torch, t["amp_dtype"])
    if device == "cuda" and amp_dtype == torch.bfloat16 and torch.cuda.get_device_capability()[0] < 8:
        sys.exit("train.amp_dtype bfloat16 needs an Ampere or newer GPU; use float16 on a T4.")
    gpu = torch.cuda.get_device_name(0) if device == "cuda" else platform.processor() or "cpu"
    set_seeds(cfg["seed"])

    header, rows, train_sha = read_train_prompts(cfg)
    train_rows, val_rows = split_rows(cfg, rows)
    preamble = header["preamble"]
    data_info = {
        "trainPrompts": cfg["data"]["train_prompts"],
        "trainPromptsSha256": train_sha,
        "preambleSha256": sha256_json(preamble),
        **{k: v for k, v in header.items() if k != "preamble"},
        "trainExamples": len(train_rows),
        "valExamples": len(val_rows),
        "valIds": [r["id"] for r in val_rows],
    }
    data_path = d / "data.json"
    if data_path.exists():
        old = json.loads(data_path.read_text())
        if old["trainPromptsSha256"] != train_sha or old["valIds"] != data_info["valIds"]:
            sys.exit(f"{data_path}: this run started on other training data. Start a new run_name.")
    data_path.write_text(json.dumps(data_info, indent=2) + "\n")
    log(f"{len(train_rows)} training and {len(val_rows)} validation rows from {cfg['data']['train_prompts']} "
        f"({header['promptVersion']}, data {header['dataVersion']}, prompts git {header['git']['commit'][:12]})")

    conv = predict_hf.conv_template()
    tok = AutoTokenizer.from_pretrained(cfg["base_model"])
    train_ex = encode(predict_hf, conv, tok, preamble, train_rows, cfg["context_window"])
    val_ex = encode(predict_hf, conv, tok, preamble, val_rows, cfg["context_window"])
    lengths = [len(p) + len(r) for p, r in train_ex]
    log(f"Tokens per example: min {min(lengths)}, max {max(lengths)}, mean {sum(lengths) / len(lengths):.0f}; "
        f"reply tokens mean {sum(len(r) for _, r in train_ex) / len(train_ex):.1f}")
    log("First training example as sent (end of prompt, then reply):\n"
        + tok.decode(train_ex[0][0][-300:]) + " ⟶ " + tok.decode(train_ex[0][1]))
    pad_id = conv["stop_token_ids"][0]  # never attended to or scored

    # fp32 master weights; matmuls run in amp_dtype under autocast (T4: fp16 tensor cores).
    model = AutoModelForCausalLM.from_pretrained(cfg["base_model"], dtype=torch.float32)
    model.config.use_cache = False
    if t["gradient_checkpointing"]:
        model.gradient_checkpointing_enable(gradient_checkpointing_kwargs={"use_reentrant": False})
    lora = cfg["lora"]
    # all-linear skips lm_head, which Llama 3.2 1B ties to the input embeddings.
    model = get_peft_model(model, LoraConfig(r=lora["r"], lora_alpha=lora["alpha"], lora_dropout=lora["dropout"],
                                             target_modules=lora["target_modules"], task_type="CAUSAL_LM")).to(device)
    model.print_trainable_parameters()
    base = model.get_base_model()

    steps = schedule(cfg, len(train_ex))
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=t["learning_rate"], weight_decay=t["weight_decay"])
    sched = get_cosine_schedule_with_warmup(opt, math.ceil(t["warmup_fraction"] * len(steps)), len(steps))
    scaler = torch.amp.GradScaler("cuda", enabled=device == "cuda" and amp_dtype == torch.float16)

    ckpt = d / "checkpoint"
    log_path = d / "train_log.jsonl"
    start_step, elapsed_before = 0, 0.0
    if (ckpt / "state.pt").exists():
        state = torch.load(ckpt / "state.pt", weights_only=False)
        set_peft_model_state_dict(model, load_file(ckpt / "adapter_model.safetensors"))
        opt.load_state_dict(state["optimizer"])
        sched.load_state_dict(state["scheduler"])
        scaler.load_state_dict(state["scaler"])
        torch.set_rng_state(state["rng"])
        if device == "cuda" and state.get("cuda_rng") is not None:
            torch.cuda.set_rng_state(state["cuda_rng"])
        start_step, elapsed_before = state["step"], state["elapsed"]
        # Drop log lines written after that checkpoint; those steps are redone.
        kept = [l for l in log_path.read_text().splitlines() if json.loads(l)["step"] <= start_step] if log_path.exists() else []
        log_path.write_text("".join(l + "\n" for l in kept))
        log(f"Resumed from step {start_step}/{len(steps)}.")
    else:
        log_path.write_text("")

    def write_log(entry):
        with log_path.open("a") as f:
            f.write(json.dumps(entry) + "\n")

    def save_checkpoint(step, elapsed):
        tmp = d / "checkpoint.tmp"
        if tmp.exists():
            shutil.rmtree(tmp)
        model.save_pretrained(tmp)
        torch.save({"step": step, "elapsed": elapsed, "optimizer": opt.state_dict(), "scheduler": sched.state_dict(),
                    "scaler": scaler.state_dict(), "rng": torch.get_rng_state(),
                    "cuda_rng": torch.cuda.get_rng_state() if device == "cuda" else None}, tmp / "state.pt")
        if ckpt.exists():
            shutil.rmtree(ckpt)
        tmp.rename(ckpt)

    if start_step == 0:
        v = val_loss(model, base, val_ex, t["micro_batch_size"], pad_id, device, amp_dtype)
        write_log({"step": 0, "val_loss": v})
        log(f"step 0  val loss {v:.4f} (before training)")

    model.train()
    t0 = time.time()
    window, window_tokens = 0.0, 0
    for step in range(start_step, len(steps)):
        epoch, micro_batches = steps[step]
        batches = [[train_ex[i] for i in mb] for mb in micro_batches]
        step_tokens = sum(len(r) for b in batches for _, r in b)
        step_loss = 0.0
        try:
            for b in batches:
                loss, _ = reply_loss(base, b, pad_id, device, amp_dtype)
                scaler.scale(loss / step_tokens).backward()  # mean over the whole step's reply tokens
                step_loss += loss.item()
        except torch.OutOfMemoryError:
            sys.exit(f"Out of GPU memory at step {step + 1}. Halve train.micro_batch_size and double "
                     "train.grad_accum_steps (same effective batch), then rerun --stages train: it resumes "
                     "from the last checkpoint.")
        scaler.unscale_(opt)
        grad_norm = torch.nn.utils.clip_grad_norm_(params, t["max_grad_norm"]).item()
        scaler.step(opt)
        scaler.update()
        sched.step()
        opt.zero_grad(set_to_none=True)
        window += step_loss
        window_tokens += step_tokens

        n = step + 1
        elapsed = elapsed_before + time.time() - t0
        if n % t["log_every_steps"] == 0 or n == len(steps):
            rate = (time.time() - t0) / (n - start_step)
            entry = {"step": n, "epoch": epoch, "loss": window / window_tokens, "lr": sched.get_last_lr()[0],
                     "grad_norm": grad_norm, "elapsed": round(elapsed)}
            write_log(entry)
            log(f"step {n}/{len(steps)}  loss {entry['loss']:.4f}  lr {entry['lr']:.2e}  "
                f"{rate:.1f}s/step  ETA {(len(steps) - n) * rate / 60:.0f} min")
            window, window_tokens = 0.0, 0
        if n % t["eval_every_steps"] == 0 or n == len(steps):
            v = val_loss(model, base, val_ex, t["micro_batch_size"], pad_id, device, amp_dtype)
            write_log({"step": n, "val_loss": v})
            log(f"step {n}  val loss {v:.4f}")
        if n % t["save_every_steps"] == 0 or n == len(steps):
            save_checkpoint(n, elapsed)

    model.save_pretrained(d / "adapter")
    entries = [json.loads(l) for l in log_path.read_text().splitlines()]
    train_losses = [e for e in entries if "loss" in e]
    val_losses = [e for e in entries if "val_loss" in e]
    summary = {
        "steps": len(steps),
        "epochs": t["epochs"],
        "effectiveBatch": t["micro_batch_size"] * t["grad_accum_steps"],
        "trainExamples": len(train_ex),
        "trainTokensPerEpoch": sum(lengths),
        "replyTokensPerEpoch": sum(len(r) for _, r in train_ex),
        "finalTrainLoss": train_losses[-1]["loss"] if train_losses else None,
        "valLossBefore": val_losses[0]["val_loss"] if val_losses and val_losses[0]["step"] == 0 else None,
        "finalValLoss": val_losses[-1]["val_loss"] if val_losses else None,
        "seconds": round(elapsed_before + time.time() - t0),
        "resumedFromStep": start_step or None,
        "gpu": gpu,
        "peakGpuMemoryGiB": round(torch.cuda.max_memory_allocated() / 2**30, 2) if device == "cuda" else None,
        "versions": {"python": platform.python_version(), "torch": torch.__version__,
                     "transformers": transformers.__version__, "peft": peft.__version__},
    }
    (d / "training.json").write_text(json.dumps(summary, indent=2) + "\n")
    shutil.rmtree(ckpt, ignore_errors=True)
    log(f"Adapter saved to {d / 'adapter'}; summary in {d / 'training.json'}:\n{json.dumps(summary, indent=2)}")


# ---------------------------------------------------------------- merge

def stage_merge(cfg, d, predict_hf):
    import torch
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer

    stage_header("merge: folding the adapter into the base weights")
    if not (d / "training.json").exists():
        sys.exit("No finished training in this run (training.json missing): run --stages train first.")
    # Merge in fp32, then save in the base model's dtype, so the merge itself adds no rounding.
    base = AutoModelForCausalLM.from_pretrained(cfg["base_model"], dtype=torch.float32)
    merged = PeftModel.from_pretrained(base, d / "adapter").merge_and_unload()
    merged = merged.to(getattr(torch, cfg["merge"]["save_dtype"]))
    out = d / "merged"
    if out.exists():
        shutil.rmtree(out)
    merged.save_pretrained(out, safe_serialization=True)
    tok = AutoTokenizer.from_pretrained(cfg["base_model"])
    tok.save_pretrained(out)
    log(f"Merged model saved to {out}")

    # A quick check that the merged weights still give the fine-tune's replies, on held-out train
    # rows (never test rows), before the long predict stage.
    n = cfg["merge"]["smoke_val_examples"]
    if not n:
        return
    device = "cuda" if torch.cuda.is_available() else "cpu"
    header, rows, _ = read_train_prompts(cfg)
    val_ids = set(json.loads((d / "data.json").read_text())["valIds"])
    val_rows = [r for r in rows if r["id"] in val_ids][:n]
    conv = predict_hf.conv_template()
    model = merged.to(device).eval()
    exact = 0
    checks = []
    for r in val_rows:
        prefix, text = predict_hf.render(conv, header["preamble"] + [{"role": "user", "content": r["user"]}])
        ids = torch.tensor([prefix + tok(text, add_special_tokens=False)["input_ids"]], device=device)
        with torch.no_grad():
            gen = model.generate(input_ids=ids, attention_mask=torch.ones_like(ids), max_new_tokens=128, do_sample=False,
                                 temperature=None, top_p=None, top_k=None, eos_token_id=conv["stop_token_ids"],
                                 pad_token_id=conv["stop_token_ids"][0])
        output = tok.decode(gen[0, ids.shape[1]:], skip_special_tokens=True)
        exact += output == r["target"]
        checks.append({"id": r["id"], "target": r["target"], "output": output})
    (d / "merge_check.json").write_text(json.dumps({"exactText": exact, "examples": len(checks), "rows": checks}, indent=2) + "\n")
    log(f"Merged model reproduces the target text on {exact}/{len(checks)} held-out train rows "
        "(a sanity check, not an eval; details in merge_check.json):")
    for c in checks[:5]:
        log(f"  {c['id']}: {c['output']!r}\n  {'':{len(c['id'])}}  target {c['target']!r}")


# ---------------------------------------------------------------- predict

def stage_predict(cfg, d, predict_script):
    stage_header("predict: both test sets, in the eval harness format")
    merged = d / "merged"
    if not (merged / "config.json").exists():
        sys.exit("No merged model in this run: run --stages merge first.")
    trained_on = json.loads((d / "data.json").read_text())
    out_dir = d / "predictions"
    todo = []
    for path in cfg["data"]["test_prompts"]:
        lines = [l for l in Path(path).read_text().splitlines() if l.strip()]
        header = json.loads(lines[0])
        # The test prompts must be the prompt the model was trained on, or the eval measures a mismatch.
        if header.get("promptVersion") != trained_on["promptVersion"] or sha256_json(header["preamble"]) != trained_on["preambleSha256"]:
            sys.exit(f"{path}: its prompt ({header.get('promptVersion')}) isn't the one this run trained on "
                     f"({trained_on['promptVersion']}). Re-export with npm run ml:prompts at the same commit.")
        target = out_dir / f"{cfg['system']}.{header['testSet']}.jsonl"
        if target.exists() and len(target.read_text().splitlines()) == len(lines):
            log(f"{target} already has every row; skipping {path}.")
            continue
        todo.append(path)
    if not todo:
        return
    cmd = [sys.executable, str(predict_script), *todo, "--model", str(merged), "--system", cfg["system"],
           "--out-dir", str(out_dir), "--batch-size", str(cfg["predict"]["batch_size"]),
           "--max-new-tokens", str(cfg["predict"]["max_new_tokens"])]
    log(" ".join(cmd))
    if subprocess.run(cmd).returncode != 0:
        sys.exit("predict_hf.py failed (see above).")
    log(f"Predictions in {out_dir}. Score them locally: npm run ml:score -- ml-data/predictions/<file>")


# ---------------------------------------------------------------- convert and upload (as in the export test)

def prebuilt_file(cfg, name):
    from huggingface_hub import hf_hub_download
    try:
        return Path(hf_hub_download(cfg["prebuilt_repo"], name))
    except Exception as e:
        sys.exit(f"Couldn't fetch {cfg['prebuilt_repo']}/{name} ({e}).")


def param_layout(cache_path):
    cache = json.loads(cache_path.read_text())
    return {p["name"]: (p["shape"], p["dtype"]) for shard in cache["records"] for p in shard["records"]}


def stage_convert(cfg, d):
    stage_header(f"convert: {cfg['quantization']} MLC weights for WebLLM")
    merged = d / "merged"
    if not (merged / "config.json").exists():
        sys.exit("No merged model in this run: run --stages merge first.")
    # `python -m mlc_llm` works even when pip didn't put the CLI on PATH. MLC_PYTHON runs MLC from
    # a separate environment (export test README step 3b).
    mlc = [os.environ.get("MLC_PYTHON", sys.executable), "-m", "mlc_llm"]
    check = subprocess.run(mlc + ["--help"], capture_output=True, text=True)
    if check.returncode != 0:
        sys.exit(f"mlc_llm doesn't run under {mlc[0]}:\n{check.stderr[-2000:]}\n"
                 "Fix the MLC install (experiments/export-test/README.md step 3), then rerun --stages convert,upload")

    out = d / f"mlc-{cfg['quantization']}"
    if out.exists():
        shutil.rmtree(out)  # never mix shards from an earlier conversion
    result = subprocess.run(mlc + ["convert_weight", str(merged), "--quantization", cfg["quantization"], "-o", str(out)])
    if result.returncode != 0:
        hint = " (segfault: run MLC from a Python 3.12 environment via MLC_PYTHON)" if result.returncode == -11 else ""
        sys.exit(f"convert_weight failed with exit code {result.returncode}{hint}")

    # Config, chat template and tokenizer come verbatim from the prebuilt build: the fine-tune
    # changes none of them, so the browser runs a known-good setup apart from our weights.
    prebuilt_cfg = json.loads(prebuilt_file(cfg, "mlc-chat-config.json").read_text())
    for name in ["mlc-chat-config.json", *prebuilt_cfg["tokenizer_files"]]:
        shutil.copy(prebuilt_file(cfg, name), out / name)

    # WebLLM reads tensor-cache.json; older MLC builds write ndarray-cache.json. Ship both.
    caches = [out / n for n in ("tensor-cache.json", "ndarray-cache.json")]
    found = next((c for c in caches if c.exists()), None)
    if found is None:
        sys.exit(f"convert_weight wrote no tensor-cache.json or ndarray-cache.json in {out}")
    for c in caches:
        if not c.exists():
            shutil.copy(found, c)

    # The prebuilt compiled library only accepts exactly its parameter names, shapes and dtypes.
    ours, theirs = param_layout(found), param_layout(prebuilt_file(cfg, "tensor-cache.json"))
    if ours != theirs:
        diffs = sorted(n for n in ours.keys() | theirs.keys() if ours.get(n) != theirs.get(n))
        sys.exit(f"Parameter layout differs from {cfg['prebuilt_repo']} in {len(diffs)} tensors, e.g.:\n"
                 + "\n".join(f"  {n}: ours {ours.get(n)}, prebuilt {theirs.get(n)}" for n in diffs[:10]))
    log(f"Converted weights in {out}; all {len(ours)} parameters match {cfg['prebuilt_repo']}'s layout")


MODEL_CARD = """---
license: llama3.2
base_model: meta-llama/Llama-3.2-1B-Instruct
tags: [mlc-llm, web-llm]
---

# {name}

**Built with Llama.** A LoRA fine-tune of Llama 3.2 1B Instruct for the Dao TFT game tracker: it turns
a Teamfight Tactics player's message into a JSON update for the tracker. It is trained on synthetic
data (data {data_version}) with the app's own prompt ({prompt_version}), and converted to `{quantization}`
MLC weights for WebLLM. It translates the player's words only; it is not a source of game facts, and the
app validates every output. Config and tokenizer are those of [{prebuilt}](https://huggingface.co/{prebuilt}).
Training settings, data version and losses are in `dao-training.json`.

Llama 3.2 is licensed under the Llama 3.2 Community License, Copyright © Meta Platforms, Inc.
All Rights Reserved. See LICENSE.txt and USE_POLICY.md.
"""


def check_repo_name(repo):
    if not repo or "/" not in repo or repo.startswith("YOUR_HF_NAME/"):
        sys.exit("Set upload.hf_repo in the config to YOUR_NAME/Llama-3.2-1B-dao-tft-...-q4f16_1-MLC.")
    if not repo.split("/", 1)[1].startswith("Llama"):
        sys.exit(f"{repo}: the Llama 3.2 license requires a published fine-tune's name to start with \"Llama\".")


def stage_upload(cfg, d):
    from huggingface_hub import HfApi, hf_hub_download

    stage_header("upload: pushing the converted weights to Hugging Face")
    repo = cfg["upload"]["hf_repo"]
    check_repo_name(repo)
    out = d / f"mlc-{cfg['quantization']}"
    if not (out / "tensor-cache.json").exists():
        sys.exit("No converted weights in this run: run --stages convert first.")
    data = json.loads((d / "data.json").read_text())
    (out / "README.md").write_text(MODEL_CARD.format(
        name=repo.split("/", 1)[1], prebuilt=cfg["prebuilt_repo"], quantization=cfg["quantization"],
        data_version=data["dataVersion"], prompt_version=data["promptVersion"]))
    record = {"config": json.loads((d / "config.json").read_text()),
              "data": {k: v for k, v in data.items() if k != "valIds"},
              "training": json.loads((d / "training.json").read_text())}
    (out / "dao-training.json").write_text(json.dumps(record, indent=2) + "\n")
    for name in ["LICENSE.txt", "USE_POLICY.md"]:  # the license requires shipping a copy
        shutil.copy(hf_hub_download(cfg["base_model"], name), out / name)

    api = HfApi()
    api.create_repo(repo, exist_ok=True)  # public: WebLLM fetches weights without auth
    # delete_patterns drops shards left over from an earlier, larger upload to the same repo.
    api.upload_folder(folder_path=str(out), repo_id=repo, delete_patterns=["*.bin"])
    log(f"Uploaded to https://huggingface.co/{repo} (base model library: {cfg['prebuilt_repo'].split('/')[-1]})")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", default=str(HERE / "finetune.config.json"))
    ap.add_argument("--stages", default=",".join(STAGES), help=f"comma-separated subset of {STAGES}")
    args = ap.parse_args()

    stages = [s.strip() for s in args.stages.split(",")]
    unknown = [s for s in stages if s not in STAGES]
    if unknown:
        sys.exit(f"Unknown stage(s) {unknown}; choose from {STAGES}")
    cfg = load_config(args.config)
    if "upload" in stages:
        check_repo_name(cfg["upload"]["hf_repo"])  # fail now, not after training
    predict_hf, predict_script = import_predict_hf()
    if (cfg["prebuilt_repo"], cfg["context_window"]) != (predict_hf.PREBUILT_REPO, predict_hf.CONTEXT_WINDOW):
        sys.exit("prebuilt_repo and context_window must match predict_hf.py, so training and eval use one prompt format.")
    if cfg["base_model"] != predict_hf.BASE_MODEL:
        sys.exit("base_model must match predict_hf.py's BASE_MODEL.")

    d = run_dir(cfg)
    freeze_config(cfg, d)
    log(f"Run directory: {d}")
    for name in stages:
        {"train": lambda: stage_train(cfg, d, predict_hf),
         "merge": lambda: stage_merge(cfg, d, predict_hf),
         "predict": lambda: stage_predict(cfg, d, predict_script),
         "convert": lambda: stage_convert(cfg, d),
         "upload": lambda: stage_upload(cfg, d)}[name]()
    stage_header("done")


if __name__ == "__main__":
    main()
