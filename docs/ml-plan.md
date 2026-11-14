# ML plan

Where Dao TFT's on-device AI assistant stands. Claude Code reads this before every AI assistant job and updates it at the end.

## Goal

Let players describe their game in plain words ("level 6, 32 gold, two bows and a sword") and have the
app fill in the game state, then explain the engine's recommendations conversationally. Everything runs
in the player's browser, so there is no per-use cost.

## Project rules

**Core design rule:** the scoring engine is the source of truth. The model only translates: player text
into engine inputs, and engine outputs into plain explanations. It never ranks comps, picks items, or
states game facts from its own knowledge. If a feature would need the model to decide something the
engine decides, stop and raise it.

**Settled choices:**

- Model: Llama 3.2 1B Instruct (see decision log).
- Runtime: WebLLM, `q4f16_1` quantization, reusing WebLLM's prebuilt model library for the base model.
- Fine-tuning teaches behavior and output format, never game facts. Unit, item and augment names come
  from the current snapshot at runtime, because the data refreshes daily.
- The model download is opt-in, with an honest progress indicator. Never start it on page load:
  players use this site alt-tabbed out of live games.
- Inference runs in a Web Worker, never on the main thread.
- Every model output is validated with the app's zod schemas before it touches the store.
- The rule-based quick-bar parser stays as the fallback whenever the model isn't loaded, isn't
  supported, or produces invalid output. It is also the baseline in every eval.

**Project-specific never-dos:**

- Never name a published fine-tune without "Llama" at the start (Llama 3.2 license). Include "Built
  with Llama" attribution where the model is used.

## Steps

| Step | Status |
|---|---|
| 1. Export test: prove a fine-tuned Llama 3.2 1B loads in WebLLM and keeps its training | In progress |
| 2. Game-state contract: exactly what the model outputs | Done: `docs/ml-state-contract.md`, schema in `src/assistant/contract.ts`; no open questions |
| 3. Data: synthetic generator, plus a hand-written real-world test set | Not started |
| 4. Eval harness and rule-based baseline | Not started |
| 5. Base model with prompting | Not started |
| 6. Fine-tune, error analysis, iterate | Not started |
| 7. App integration: assistant module, then UI | Not started |
| 8. Write-up and model card | Not started |

## Decision log

**2026-11-14: The model outputs a partial update with names, not ids** (`docs/ml-state-contract.md`).
It copies the player's words; the app resolves them with the quick bar's `QuickLexicon` and applies
them through the quick bar's reducer and one `useGame.apply`, so there is one undo step and the same
preview chips. Ids are game facts that change with the daily snapshot, so the model never sees them.
Labels are mostly kind-free (number before a name = count, after = stars), so labelers and the model
need no game knowledge beyond names that contain numbers.

**2026-11-14: Labeling semantics settled with the player.** A bare list is the player's full holdings
(it replaces components and items), but units are upserted unless the board is given in full ("my
board is"). Only craft verbs use up components. "2 jinx" sets no star level. "I'm 7" is level 7. A
bare number is not gold. Duplicate augment names are told apart by champion or tier words. Bare
augment mentions are upserted, like units, so naming a new pick keeps the earlier ones (proposed by
Claude, confirmed by the player). "hit 8" / "went 8" / "8 now" are level too.

**2026-11-14: Slang lives in aliases.json, shared by the quick bar and the assistant.** Added
`<trait> spat` for every emblem, champion/tier keys for the duplicate Beast Within and Tons of Stats
augments, and `uplink`. Alias keys may now contain `+` (matching `normalize`) for the Beast Within+
keys.

**2026-11-14: Every message goes to the model, quick-bar syntax included** (player's call: no
routing around it). Quick-bar lines are labeled to mean what the quick bar does: a bare number is
gold, a plain name is `craft` (the quick bar's plain add, which crafts when components are held),
and `+`/`-` are add/remove. The schema gained `next` and `undo` flags so `n` and `u` survive. The
app still does the work (`advanceRound`, `undo`), so the model decides nothing. `craft` of a
non-item became a plain add, which keeps quick-bar labels kind-free. Known difference: the update
order runs `next` before `gold`, so "38 n" gives 38 where the quick bar gives 38 plus income.

**2026-11-13: Llama 3.2 1B instead of Qwen3.5 0.8B.** Converting Qwen3.5 0.8B to WebLLM format crashed
(segfault in MLC's weight conversion). Converting the untouched base model crashed the same way, so the
problem was the tooling on Colab (likely Python 3.13 with MLC nightly builds), not the fine-tune. The
merged fine-tune was also saved in a text-only layout (`qwen3_5_text`) that differs from the original
(`qwen3_5`), a second problem to fix if Qwen is revisited. Llama 3.2 1B has a standard architecture and
mature conversion support. The model sits behind one interface, so Qwen can be retried later.

**2026-11-13: Export test takes everything but the weights from WebLLM's prebuilt Llama.** The converted
repo ships `mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC`'s `mlc-chat-config.json` and tokenizer verbatim
(no `gen_config`). The convert stage also checks every parameter's name, shape and dtype against that
repo's `tensor-cache.json`. The browser page copies WebLLM's prebuilt record, including its 4k context
override, and pins WebLLM 0.2.88. So the browser runs a known-good setup where only the weights differ.

**2026-11-13: Fine-tune prompts are built from WebLLM's chat template, not Hugging Face's.** The HF
Llama 3.2 template adds a dated "Cutting Knowledge Date / Today Date" system block. WebLLM's `llama-3_1`
template sends "You are a helpful, respectful and honest assistant." Training, the Python check and the
browser now all use the WebLLM format. This matters beyond the export test: real fine-tunes must train
on the exact prompt format WebLLM sends.

**2026-11-13: Published fine-tune repos are named `Llama-...`.** The export test's upload enforces this
and adds a model card with "Built with Llama" attribution, plus the license and use policy.

**Earlier: model runs in the browser via WebLLM.** No server costs; the site stays a static deploy.

**Earlier: the engine decides, the model translates.** See core design rule.

## Experiment log

**2026-11-13: Qwen3.5 0.8B export test.** Canary training and Python check passed. Conversion failed
(see decision log).

**2026-11-13: Llama 3.2 1B export test: not run yet.** The script, browser page and README runbook were
reviewed and fixed for Llama only (Qwen paths removed). No training, conversion or browser run has
been done with this version.

**2026-11-14: Game-state contract schema test.** No GPU or browser run. `src/assistant/contract.test.ts`
(valid labels and invalid outputs for `StateUpdateSchema`) passed locally with the full suite
(203 tests), plus `tsc --noEmit` and eslint. After the slang aliases and a new quick-bar alias test:
204 tests passed, typecheck and lint clean. After adding `next`, `undo` and quick-bar-line labels:
213 tests passed, typecheck and lint clean.

## Open questions

- Does the Llama export test pass in the browser? If MLC conversion crashes on Colab's Python, run MLC
  from a Python 3.12 environment (set `MLC_PYTHON`, see `experiments/export-test/README.md` step 3b).
- Does MLC's weight loader in the 3.12 environment need torch? The README installs a CPU build just in
  case; this hasn't been checked.
