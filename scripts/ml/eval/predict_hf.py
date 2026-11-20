"""
Runs a Llama 3.2 1B model (the base model by default) on exported prompts and writes a
predictions file in the eval harness format (ml-evals/README.md). docs/ml-plan.md step 5.

Input: ml-data/prompts/<testSet>.jsonl from `npm run ml:prompts`. Its header holds the test-set
hash and the preamble (system message and example turns); each row holds the final user turn.

Prompts are rendered from WebLLM's own chat template (conv_template in the prebuilt model's
mlc-chat-config.json), not tokenizer.apply_chat_template: the Hugging Face template adds a dated
system block that WebLLM doesn't send (decision log, 2026-11-13). Decoding is greedy. Each output
is the raw decoded text, never repaired or re-serialized, so invalid JSON is counted by the scorer.

Usage (Colab, a T4 is enough; the cells are in ml-evals/README.md):
  python predict_hf.py prompts/real.jsonl prompts/synthetic-v1.jsonl
  python predict_hf.py prompts/real.jsonl --limit 5              # smoke test, not scorable
  python predict_hf.py prompts/real.jsonl --model ./merged --system llama-3.2-1b-ft-v1

Then, locally: npm run ml:score -- ml-data/predictions/<system>.<testSet>.jsonl
"""

import argparse
import json
import platform
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

BASE_MODEL = "meta-llama/Llama-3.2-1B-Instruct"
# WebLLM's prebuilt build of the base model; its conv_template is what the browser sends.
PREBUILT_REPO = "mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC"
# The browser page copies WebLLM's prebuilt record, which overrides the context to 4k.
CONTEXT_WINDOW = 4096


def log(msg):
    print(msg, flush=True)


def read_prompts(path):
    lines = [l for l in Path(path).read_text().splitlines() if l.strip()]
    header = json.loads(lines[0])
    if header.get("prompts") != 1:
        sys.exit(f"{path}: not a prompts file (run npm run ml:prompts)")
    if header.get("chatTemplate") != "llama-3_1":
        sys.exit(f"{path}: chat template {header.get('chatTemplate')!r}, expected llama-3_1")
    rows = [json.loads(l) for l in lines[1:]]
    ids = [r["id"] for r in rows]
    if len(set(ids)) != len(ids):
        sys.exit(f"{path}: repeated ids")
    return header, rows


def conv_template():
    from huggingface_hub import hf_hub_download
    conv = json.loads(Path(hf_hub_download(PREBUILT_REPO, "mlc-chat-config.json")).read_text())["conv_template"]
    if conv["name"] != "llama-3_1":
        sys.exit(f"Expected the llama-3_1 chat template, got {conv['name']}; update render().")
    return conv


def render(conv, messages):
    """The prompt text WebLLM builds for these messages, ending with the open assistant header.

    A leading system message replaces conv_template's default one, as in WebLLM's chat API.
    Returns (prefix token ids, text): the text is tokenized without adding special tokens.
    """
    system = conv["system_message"]
    if messages and messages[0]["role"] == "system":
        system, messages = messages[0]["content"], messages[1:]
    text = conv["system_template"].replace("{system_message}", system)
    for m in messages:
        if m["role"] not in ("user", "assistant"):
            sys.exit(f"unexpected role {m['role']!r}")
        text += conv["roles"][m["role"]] + conv["role_content_sep"] + m["content"] + conv["seps"][0]
    text += conv["roles"]["assistant"] + conv["role_empty_sep"]
    return conv["system_prefix_token_ids"], text


def write_predictions(out_path, system, prompts_header, rows, outputs, notes):
    """A predictions file (ml-evals/README.md): a header, then one {id, output} per prompt row."""
    header = {
        "predictions": 1,
        "system": system,
        "testSet": prompts_header["testSet"],
        "testSetSha256": prompts_header["testSetSha256"],
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "git": prompts_header["git"],
        "notes": notes,
    }
    with Path(out_path).open("w") as f:
        f.write(json.dumps(header) + "\n")
        for r, o in zip(rows, outputs, strict=True):
            f.write(json.dumps({"id": r["id"], "output": o}) + "\n")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("prompts", nargs="+", help="prompts files from npm run ml:prompts")
    ap.add_argument("--model", default=BASE_MODEL, help="Hugging Face repo or local path")
    ap.add_argument("--system", default="llama-3.2-1b-prompted", help="system name in the predictions header")
    ap.add_argument("--out-dir", default="predictions")
    ap.add_argument("--max-new-tokens", type=int, default=256)
    ap.add_argument("--batch-size", type=int, default=16)
    ap.add_argument("--dtype", choices=["auto", "bfloat16", "float16", "float32"], default="auto")
    ap.add_argument("--limit", type=int, default=0, help="first N rows only: a smoke test the scorer will refuse")
    args = ap.parse_args()

    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer

    if not torch.cuda.is_available():
        log("WARNING: no GPU; this will be very slow.")
    device = "cuda" if torch.cuda.is_available() else "cpu"
    if args.dtype == "auto":
        dtype = (torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16) if device == "cuda" else torch.float32
    else:
        dtype = getattr(torch, args.dtype)
    gpu = torch.cuda.get_device_name(0) if device == "cuda" else platform.processor() or "cpu"

    conv = conv_template()
    stop_ids = conv["stop_token_ids"]
    tok = AutoTokenizer.from_pretrained(args.model)
    tok.padding_side = "left"
    pad_id = tok.pad_token_id if tok.pad_token_id is not None else stop_ids[0]
    model = AutoModelForCausalLM.from_pretrained(args.model, dtype=dtype).to(device).eval()
    log(f"Model {args.model} on {gpu}, {dtype}; transformers {transformers.__version__}, torch {torch.__version__}")

    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    for path in args.prompts:
        header, rows = read_prompts(path)
        if args.limit:
            rows = rows[: args.limit]
        log(f"\n=== {path}: {len(rows)} prompts, {header['promptVersion']}, test set {header['testSet']}")

        encoded = []
        for r in rows:
            prefix, text = render(conv, header["preamble"] + [{"role": "user", "content": r["user"]}])
            encoded.append(prefix + tok(text, add_special_tokens=False)["input_ids"])
        lengths = [len(e) for e in encoded]
        longest = max(lengths)
        log(f"Prompt tokens: min {min(lengths)}, max {longest}, mean {sum(lengths) / len(lengths):.0f}")
        if longest + args.max_new_tokens > CONTEXT_WINDOW:
            sys.exit(f"Longest prompt ({longest}) plus --max-new-tokens ({args.max_new_tokens}) is over WebLLM's {CONTEXT_WINDOW}-token context.")
        log("First prompt as sent (check it looks right):\n" + tok.decode(encoded[0])[-700:])

        # Longest first, so batches hold similar lengths and an out-of-memory error shows up at once.
        order = sorted(range(len(rows)), key=lambda i: -lengths[i])
        outputs, truncated = [None] * len(rows), 0
        sizes_used = set()

        def run(batch):
            """Generates for one batch; on out-of-memory, splits it in half and retries."""
            nonlocal truncated
            width = max(lengths[i] for i in batch)
            oom = False
            try:
                ids = torch.tensor([[pad_id] * (width - lengths[i]) + encoded[i] for i in batch], device=device)
                mask = torch.tensor([[0] * (width - lengths[i]) + [1] * lengths[i] for i in batch], device=device)
                with torch.no_grad():
                    out = model.generate(
                        input_ids=ids, attention_mask=mask, max_new_tokens=args.max_new_tokens,
                        do_sample=False, num_beams=1, temperature=None, top_p=None, top_k=None,
                        eos_token_id=stop_ids, pad_token_id=pad_id,
                        # Only the last position's logits: the full prefill logits are
                        # batch x prompt length x 128k vocab, several GiB at batch 16.
                        logits_to_keep=1,
                    )
            except torch.OutOfMemoryError:
                if len(batch) == 1:
                    raise
                oom = True
            if oom:
                # Outside the except block, so the traceback no longer holds the failed batch's tensors.
                ids = mask = None
                torch.cuda.empty_cache()
                half = len(batch) // 2
                log(f"  out of memory at batch {len(batch)}; retrying as {half} + {len(batch) - half}")
                run(batch[:half])
                run(batch[half:])
                return
            sizes_used.add(len(batch))
            for row, i in enumerate(batch):
                new = out[row, width:].tolist()
                ended = any(t in stop_ids for t in new)
                if ended:
                    new = new[: next(k for k, t in enumerate(new) if t in stop_ids)]
                else:
                    truncated += 1
                # Raw text, unrepaired: the scorer counts invalid outputs.
                outputs[i] = tok.decode(new, skip_special_tokens=True)

        start = time.time()
        for b in range(0, len(order), args.batch_size):
            run(order[b : b + args.batch_size])
            done = min(b + args.batch_size, len(order))
            log(f"  {done}/{len(order)}  {time.time() - start:.0f}s")
        seconds = time.time() - start
        batches = "/".join(str(s) for s in sorted(sizes_used, reverse=True))

        valid_json = 0
        for o in outputs:
            try:
                json.loads(o)
                valid_json += 1
            except ValueError:
                pass
        notes = (
            f"{args.model}, prompt {header['promptVersion']} (git {header['git']['commit'][:12]}"
            f"{', dirty' if header['git']['dirty'] else ''}), WebLLM llama-3_1 template from {PREBUILT_REPO}; "
            f"greedy, max_new_tokens {args.max_new_tokens}, batch {args.batch_size}, sizes run {batches} (left-padded); "
            f"{str(dtype).replace('torch.', '')} on {gpu}, transformers {transformers.__version__}, torch {torch.__version__}; "
            f"{truncated} hit max_new_tokens; {seconds:.0f}s"
        )
        suffix = f".limit{args.limit}" if args.limit else ""
        out_path = out_dir / f"{args.system}.{header['testSet']}{suffix}.jsonl"
        write_predictions(out_path, args.system, header, rows, outputs, notes)
        log(f"Wrote {out_path}: {len(rows)} rows, {valid_json} parse as JSON, {truncated} truncated, {seconds:.0f}s")
        if args.limit:
            log("This is a --limit smoke test: the scorer refuses it (missing ids). Run without --limit to score.")
        for r, o in list(zip(rows, outputs))[:5]:
            log(f"  {r['id']}: {o!r}")


if __name__ == "__main__":
    main()
