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

- Never use the real-world test set (`ml-data/real-test/`) for training, for tuning the generator's
  templates, or as prompt examples. It is evaluation only, and results on it are reported apart from
  the synthetic test set. Claude may draft its labels, but only the player marks one `confirmed`, and
  only confirmed examples count. A test fails if a generator file references it.
- Never name a published fine-tune without "Llama" at the start (Llama 3.2 license). Include "Built
  with Llama" attribution where the model is used.

## Steps

| Step | Status |
|---|---|
| 1. Export test: prove a fine-tuned Llama 3.2 1B loads in WebLLM and keeps its training | In progress |
| 2. Game-state contract: exactly what the model outputs | Done: `docs/ml-state-contract.md`, schema in `src/assistant/contract.ts`; no open questions |
| 3. Data: synthetic generator, plus a hand-written real-world test set | In progress: synthetic generator done (`npm run ml:data`, data v1); real-world test set: format and checker done (`npm run ml:check-real`), 162 confirmed examples |
| 4. Eval harness and rule-based baseline | Done: `scripts/ml/eval/` (`npm run ml:predict`, `ml:score`, `ml:baseline`), formats in `ml-evals/README.md`, scorer v1; baseline results in `ml-evals/results/` |
| 5. Base model with prompting | Done: prompt builder `src/assistant/prompt.ts` (prompt-v1, tested), prompt export (`npm run ml:prompts`), Colab runner `scripts/ml/eval/predict_hf.py` (cells in `ml-evals/README.md`). Done 2026-11-19: base model run on Colab and scored. Exact 19.8% on real and 8.9% on synthetic, below `quickbar`; micro F1 24.2% and 37.8% (experiment log) |
| 6. Fine-tune, error analysis, iterate | In progress (pass bar in the decision log, 2026-11-22): pipeline written (`scripts/ml/train/finetune.py` plus `finetune.config.json`; train prompts from `npm run ml:prompts`; Colab cells in `ml-evals/README.md`). ft-v1 is trained and merged on Colab. On 2026-11-23 it was converted to q4f16_1 on a Mac (`scripts/ml/train/conda_env.yml`; steps in `ml-evals/README.md`) and uploaded to Hugging Face. Its predictions are downloaded but not yet scored against the pass bar. WebLLM loading and browser timing haven't run |
| 7. App integration: assistant module, then UI | Not started |
| 8. Write-up and model card | Not started |

## Decision log

**2026-11-22: Pass bar for a fine-tune, set before any fine-tune result is seen** (player's call;
numbers proposed by Claude). A fine-tune ships to step 7 only if it meets all four. It isn't moved
after results arrive; changing it needs a new dated entry that gives the reason.
1. **Real-world set, exact match ≥ 35%.** That is `quickbar`'s 24.7% plus 10 points. With 162
   examples, differences under about 7 points could be noise, so a smaller gain doesn't count as
   clearly better.
2. **Real-world set, micro precision ≥ 36.7%** (`quickbar`'s). Recall must not come from
   over-predicting, the base model's failure (19.9% precision).
3. **Schema-valid ≥ 95% on both test sets.** The base model reached 88%.
4. **Browser speed: median ≤ 2 s per message** on a mid-range laptop, from sending the message to
   the full reply, with the model already loaded (WebLLM, `q4f16_1`). Measured in step 7. Until
   then a fine-tune can pass 1–3 only provisionally.

The synthetic test set is reported next to these but doesn't gate: its phrasings come from the
generator's own templates. A fine-tune whose synthetic exact match is below `quickbar`'s 17.9%
still points to a pipeline bug, and is investigated before anything else.

**If a fine-tune misses**, the default isn't more training. First compare it with two cheaper
options: extending the quick bar to common plain-text forms, and WebLLM's schema-constrained
decoding on the base model. Then decide which to pursue. If only bar 4 fails, try a shorter prompt
(prompt-v2) first.

**2026-11-19: The fine-tune trains on the app's prompt exactly: prompt-v1, preamble included**
(player's call: "training matches production exactly"; this settles the open question about it).
- `npm run ml:prompts` now also writes `ml-data/prompts/train.synthetic-v1.jsonl`. Each train row's
  prompt comes from the app's own `buildPrompt`, with its target. The header records the prompt
  and data versions, the train file's sha256 and the generator manifest. Python renders the rows
  with `predict_hf.py`'s `render()`, the function the eval uses, never a copy.
- Cost: the 14 example turns make the prompt long. Measured with the Llama 3.2 tokenizer: 1,807
  tokens per example on average (max 1,979), 26 of them reply, 35.7M tokens per epoch. A shorter
  prompt-v2 would train about 5× faster and cut the browser's prefill. That would be a new prompt
  version for both app and training, so it isn't done here.
- The target is the label as the app's schema reads it (`StateUpdateSchema.parse`, then the
  canonical serializer). In data v1 this changes one row: `train-012836` labels
  `"makeshift armor "` with a trailing space, which the schema trims. It's a generator bug, still
  unfixed, because fixing it changes data v1 (open questions).
- Training (all in `finetune.config.json`):
  - LoRA r 16, alpha 32, dropout 0.05, all-linear (lm_head stays tied and untrained);
  - 1 epoch, AdamW at 2e-4 with cosine decay and 3% warmup, effective batch 16 (4 × 4), clip 1.0, seed 1234;
  - fp32 master weights with fp16 autocast and a grad scaler, because a T4 has no bf16;
  - gradient checkpointing on.
- Loss is on the reply tokens only, ending with `<|eot_id|>`, and logits are computed only at those
  positions. Full logits over the prompt would take several GiB per row; the same problem hit the
  eval runner.
- 256 validation rows are held out from the **train** split by the seed. Their loss is logged, and
  the merge stage checks 16 of them. The test sets are read only by the predict stage.
- Reproducibility: the run saves `config.json`, `data.json` (versions, hashes, val ids),
  `train_log.jsonl` and `training.json` next to the adapter. A config change that would alter
  training is refused for an existing run. Checkpoints go to Drive every 50 steps, and a rerun
  resumes from the last one.
- Merge runs in fp32 and saves in bf16 (the export test merged in bf16), so the merge adds no
  rounding of its own.
- Predictions come from the merged bf16 model through `predict_hf.py`, the same runner as the base
  model, as system `llama-3.2-1b-ft-v1`. The predict stage refuses test prompts whose preamble
  differs from the one trained on.
- Convert and upload are the export test's code (layout check against the prebuilt repo, config
  and tokenizer copied verbatim, repo name must start with `Llama`, "Built with Llama" card). The
  card adds `dao-training.json`. These steps are **not proven** yet: the Llama export test hasn't
  been run (experiment log).

**2026-11-19: The prompt is the message plus the names found in it, built by app code** (player's
call: TypeScript, since the app uses it at runtime; candidates by deterministic fuzzy matching,
aliases first; never the whole snapshot). This changes the contract's "Prompt input" (section 1):
the model now sees candidate names, but still no ids, catalog or state.
- `src/assistant/prompt.ts`, `PROMPT_VERSION` prompt-v1. `buildPrompt` returns chat messages: a
  system message (the contract condensed: fields, lists, mention parts, rules), 14 examples as
  earlier chat turns, then `Names in the message: "ie" = Infinity Edge (item) …` and
  `Message: <text>`. A typo match reads "maybe …"; ambiguous names list up to 3 options.
- Candidate matching (`findCandidates`). At each word it tries tiers in order, longest run first, as
  the quick bar does:
  - exact: alias, name, plural, or a trailing 1–3 / i–iii read as a numeral;
  - then, per run length, a unique prefix of 3+ letters (never a single-word augment) and a typo
    (1 edit at 5–7 letters, 2 at 8+, aliases before names; adjacent swaps count as one edit).
  - Quick-bar commands, signs, attached star digits and `x2` are never part of a name. Cue words,
    verbs and other stopwords are never a name on their own, and runs don't cross commas.
- The matcher was tuned on the synthetic **train** split only (recall of labeled names 97.8% →
  99.4%). The real-world test set's misses were not looked at, so its recall is a report, not a
  tuning target.
- Examples: 13 copied verbatim from the train split (ids in the code, checked by a test), so they
  use only train-pool phrasings. One more, for `goldChange` and `hpChange`, is written from
  contract rules 16b/17b, because the generator has neither yet. Tests check that no example equals
  a real-world or synthetic test text. "u" was dropped as an example because it is also a
  real-world test text; the instructions cover undo.
- The prompts file stores the preamble once in its header, and each row holds the final user turn.
  `predict_hf.py` renders the messages with WebLLM's `llama-3_1` conv_template (a leading system
  message replaces the default one, as in WebLLM's chat API), decodes greedily, and writes raw
  outputs.
- The first Colab full run (batch 16, T4) ran out of GPU memory: a 6.52 GiB allocation, matching
  the fp16 prefill logits for 16 prompts of about 1,700 tokens over the 128k vocabulary. The runner
  now asks `generate` for the last position's logits only (`logits_to_keep=1`), and splits a batch
  in half on out-of-memory. The batch sizes actually run are recorded in `notes`.
- The re-run still ran out of memory at 16, with allocations matching full prefill logits again, so
  `logits_to_keep=1` had no effect in that `transformers` version (cause not known yet). Batches of
  8 succeeded. So the default batch size is now 8, and after an out-of-memory error the runner keeps
  the smaller size for the rest of the run instead of failing at the larger size on every batch.
- Known differences from the browser: Python runs fp16/bf16 Hugging Face weights, not WebLLM's
  q4f16_1. Batches are left-padded (batch size recorded in `notes`). So a browser run can still
  differ.

**2026-11-19: Eval harness: prediction and scoring are separate, and one TypeScript scorer scores
everything** (`scripts/ml/eval/`, formats in `ml-evals/README.md`).
- Every system writes a predictions JSONL: a header with the system, the test set and the sha256 of
  the test file, then `{id, output}` rows with the raw output text. Python and browser runs follow
  the same format.
- The scorer parses each output with `StateUpdateSchema`, so every system is judged by the app's own
  schema. It refuses predictions made on another version of a test set, and missing, extra or
  repeated ids.
- Metric definitions (scorer v1; bump `SCORER_VERSION` if one changes):
  - Names are compared after the quick bar's `normalize()`, the key the app resolves with. A
    verbatim exact match is reported too.
  - An invalid output is scored as `{}` and is never an exact match.
  - Precision and recall are per field: per scalar, per `clear` category, and per mention within
    the same list. A wrong scalar value counts as both an FP and an FN.
- Categories come from the gold label and the text, so both test sets break down the same way.
  The text categories are quick-bar line (rule 22, approximated with `parseQuick`) and question.
  Synthetic rows also get their generator's mode and scenario.
- The quick-bar line detector agrees with the generator's own `mode` on 1,991 of the 1,999
  synthetic test rows that are plain or quick. The 8 quick lines it misses have typos the quick
  bar can't read. The one undo row ("u") is detected as a quick-bar line.
- Results go to `ml-evals/results/<testSet>/<system>.scorer-v1.<timestamp>.json`. They are
  committed and never overwritten.
- Real-set results keep every mismatched row for error analysis. Synthetic results keep only
  `mismatchCount` (player's call: about 1 MB per run otherwise). The full copy goes to
  `ml-data/eval-results/` (gitignored), named in `mismatchesFile`, and can be regenerated from
  the predictions.
- The quick bar's private `parse` is now exported as `parseQuick`, with each name as typed.
  `runQuick` is unchanged.

**2026-11-19: Two rule-based baselines** (player's call). The quick-bar parser is read as a contract
label by rules 22–25: a plain name is `craft`, `+` is `add`, `-` is `remove`, a bare number is gold.
- `quickbar` is primary and app-faithful: any word the quick bar can't read gives `{}`, because the
  app applies nothing when a chip is red.
- `quickbar-lenient` drops those words and keeps the rest.
- By design, neither predicts `set`, `clear`, `newGame`, `goldChange`, `hpChange` or `at`. Both read
  "akali 2" as gold 2, as the quick bar does. Neither has game state, so state checks are skipped.

**2026-11-19: Schema additions and rulings from reviewing batch 5** (player's calls).
- New fields:
  - `hpChange` ("lost 15 hp" → −15; a stated total wins);
  - `newGame` ("new game" → `useGame.reset()`, alone, like `undo`).
- Gold from an orb or a portal is a `goldChange` ("+10 gold from gold subscription" → +10). The
  portal itself isn't recorded, because portals aren't supported yet. Gold with no stated source
  ("+10 gold") stays deferred.
- Buying a unit puts it on the board for now ("bought vi" → add vi). Units from a carousel or orb
  go to the bench.
- The gold cap is 250, in `quick.ts`'s `MAX_GOLD` and the contract's `LIMITS`. It's arbitrary: more
  is possible but very unlikely.
- Undo of the last entry or round ("undo the last entry i made") is undo. Undo of a specific thing
  is still deferred.
- Units gained from a carousel or orb go to the bench, so they aren't labeled unless the player
  says they're on the board (rule 14b). This reopened r0048, r0050 and r0051; the HP ruling
  reopened r0034, and the undo ruling r0036.
- The generator's "lost 12 hp" aside (labeled `{}`) contradicted `hpChange`, so it was removed and
  the data regenerated.

**2026-11-19: Rulings from the fifth real-test batch** (player's calls).
- "undo" given as a command on its own after an explanation ("…, undo") is undo. "next round"
  inside a story isn't next (rule 25).
- Reforging, and an augment that changes an item, are remove plus add (rule 11). "don't have X
  because I made Y" is just the craft, which uses X up.
- An augment named as the source of something is recorded in `set`, an upsert (rule 14b). Other
  sources (carousel, orbs, krugs) still aren't.
- 3 copies on the board → ★2, 9 → ★3; bench copies aren't counted (rule 7).
- Slamming a component onto a unit, a round just played ("lost on 3-7"), and "and some other units"
  after "my board:" change nothing, or don't clear the board.

**2026-11-19: Unknown names are the app's job, not the model's** (player's call; reverses the
same day's "don't record names that aren't in the set"). Dropping Bel'Veth or "shooga booga" would
need the model to know the current set's roster, a game fact that changes every set. So the model
copies every name as typed and leaves out only gibberish. The app's resolver then suggests close
names ("did you mean Kraken's Fury?") by spelling or a shared word, or drops the name with a
notice. The rest of the update still applies, and a `clear` whose mentions were all dropped is
skipped. No alias is added for old names like "kraken slayer". r0009, r0016 and r0042 are labeled
as typed again (draft). Resolver work is in step 7.

**2026-11-19: Rulings from the fourth real-test batch** (player's calls).
- "to level to N" and "to go N" after buying xp are level (rule 15).
- "used N gold" is spending, and present tense ("spend 20 in rolls") is a report (rule 16b).
- "rolled to N" is a total, like "rolled down to N".
- Gibberish isn't labeled (rule 4), and (later reversed, see above) neither is an augment that doesn't exist and has no clear
  match, even inside "my augments are". When nothing is left, the frame's `clear` is dropped too.
  r0042 is now `{}` and back to draft. Extended to units and items: r0009 drops Bel'Veth and r0016
  drops Skarner (both back to draft). A misspelling or a known old name is a clear match, so it is
  still labeled.
- r0088 was dropped as a near-repeat of r0029; its id isn't reused.

**2026-11-18: Rulings from the third real-test batch** (player's calls).
- A statement next to a question is labeled ("hit a sivir 2, what should I do now?" → add Sivir ★2).
  Holdings inside a question still aren't (r0023). This matches the synthetic data, which already
  labels statements and drops question asides. The checker's question warning now says to label
  only statements outside the question.
- Where something came from isn't labeled, even when it's a unit name: "from kruggs", "from my blue
  orb" (new rule 14b).
- Two new forms: "health N" is HP (rule 17), and "2 x chain" is a count (rule 6).

**2026-11-14: Gold changes from selling, rolling and buying are tracked** (player's call, contract
rule 16b). New field `goldChange` (−200 to 200, never 0): a sale's price is a gain; gold spent rolling
or buying units or xp is a cost. It's labeled only when the amount is stated in gold ("rolled 30",
not "rolled 3 times"), so the model never does arithmetic beyond summing. A gold total in the same
message wins, and the schema rejects `gold` with `goldChange`. The app adds it to the stored gold,
clamped to 0–200 (step 7). Other relative changes ("+10 gold", "lost 12 hp") stay deferred.
This reverses the earlier "rolled 50 gold changes nothing" ruling on r0025.

**2026-11-14: A question is labeled `{}` as a whole, even when it mentions holdings** (contract
rule 21, player's call on r0023). "what items for yi given that I have a guinsso" updates nothing.
The checker now treats a message that opens like a question ("what", "should", "can"…) as one, not
only text with a "?". Also from this batch: "leveled (up) to N" is level (rule 15), and "rolled 50
gold" changes nothing (later reversed: see the gold-change entry above).

**2026-11-14: A bare list adds to the stored components and items; it no longer replaces them**
(player's call, contract section 2). "2 bows sword" with 1 bow stored gives 3 bows and a sword.
For components and items `set` now applies exactly like `add`. Units and augments were already
added if missing. Replacing a category takes an explicit `clear`. Labels are unchanged; only the
reducer changes.

**2026-11-14: An augment named without its round defaults to its earliest stage, or the app asks**
(player's call, contract section 2). It fills the next open selection when that selection offers
it; otherwise the app asks which round it was taken at. Labels are unchanged.

**2026-11-14: A unit holding an item is labeled when it has a star level** (contract rule 14,
player's call while labeling the real test set). "jg teemo 2" and "with a caitlyn 2" report the
board; "slammed IE on ashe" still labels only the item.

**2026-11-14: The real-world test set is committed JSONL with a draft/confirmed status.**
`ml-data/real-test/examples.jsonl` holds one `{id, text, label, status, note?}` per line (format in
its README). It is the only data in `ml-data/` that's committed, since it can't be regenerated.
`npm run ml:check-real` fails on schema errors, repeated ids or texts, and names not copied verbatim
(rule 1). It warns on names that don't resolve or are ambiguous, values missing from the text,
numbers on the wrong kind of thing, augments not offered at their selection, unlikely levels for the
stage, oversized boards, and text that matches the synthetic data.

**2026-11-14: The data generator is TypeScript, in `scripts/ml/`.** It imports the app's snapshot,
aliases, augment pools, quick-bar lexicon and `StateUpdateSchema` directly, so every label is checked
by the schema the app will use, and every typed name (except deliberate typos) is checked to resolve
the way the app will resolve it. Python would suit training, but would need a second copy of the
schema and resolver that could drift.

**2026-11-14: Train and test use disjoint template pools.** Every phrasing (cue forms like "lvl 6"
vs "lv 6", verbs, frames, joiners, openers, quick-bar token forms) belongs to one pool. Only a
frameless list and a bare quick-bar number are shared, because they have no other spelling. Test
phrasings are held-out forms the contract already defines, so the test measures generalization
rather than rules the model never saw. Names come from the snapshot in both splits. Duplicates are
removed within each split and across them: exact text, text equal after case and punctuation, and the
same words reordered.

**2026-11-14: Contract tightened while building the generator** (rules 22–24). Cue words, verbs and
connectives never count as names in the quick-bar-line test ("level" prefix-matches Level Up!). In a
quick-bar line, a bare number is gold, never a count, and "jinx 52" is Jinx and 52 gold, as the
quick bar reads them.

**2026-11-14: The model outputs a partial update with names, not ids** (`docs/ml-state-contract.md`).
It copies the player's words; the app resolves them with the quick bar's `QuickLexicon` and applies
them through the quick bar's reducer and one `useGame.apply`, so there is one undo step and the same
preview chips. Ids are game facts that change with the daily snapshot, so the model never sees them.
Labels are mostly kind-free (number before a name = count, after = stars), so labelers and the model
need no game knowledge beyond names that contain numbers.

**2026-11-14: Labeling semantics settled with the player.** A bare list was the player's full holdings
(it replaced components and items; superseded below), and units are upserted unless the board is given in full ("my
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

**2026-11-14: Synthetic data v1 generated (CPU, local).** `npm run ml:data` (seed 1): 20,000 train
and 2,000 test examples in 1.2s; every label passed `StateUpdateSchema`. Regenerating gave
byte-identical files. Duplicates removed: train 1,535 exact + 187 near; test 98 exact + 2 near + 12
matching train. 6% of examples contain a typo. Stats are in `ml-data/v1/stats.md` (gitignored, like
all of `ml-data/`; the manifest records the seed, snapshot and contract hashes, and the git commit).
Generator tests: 25, all passing; full suite 238 passing.

**2026-11-14: Real-world test set checker.** No GPU or browser run. 14 checker tests passed locally;
16 examples entered and confirmed by the player on 2026-11-14.
A second batch of 15 player-typed texts (r0017–r0031) was added the same day with draft labels by
Claude: 0 errors, and no overlap with the synthetic data. After the player's rulings and the
question-form check: 14 checker tests, full suite 252 passing, typecheck and lint clean. After
adding `goldChange` (schema, contract tests, checker warnings): 258 passing, typecheck and lint
clean. Synthetic data regenerated: it has no `goldChange` labels yet (see open questions).
2026-11-18: a third batch of 28 player-typed texts (r0032–r0059) with draft labels by Claude. It covers
HP, undo, clear, `at`, attached quick-bar tokens, plain-text adds, gold totals and changes,
counts, and level forms. The checker gives 0 errors. "u" matches the synthetic data exactly, which is
expected since it's the only way to type it. On 2026-11-18 the player confirmed all 43 drafts
(r0017–r0059), so all 59 examples are now confirmed.
2026-11-19: a fourth batch of 36 player-typed texts (r0060–r0095) with draft labels by Claude. It
covers gold changes, carousel and orb sources, "leveled up to N", "health N", "N x name", questions
that contain holdings, and messages with nothing to update. The checker gives 0 errors and 26
warnings. Two of the new rows nearly matched something: r0082 "health 10" a synthetic text, and r0088
the existing r0029. After the player's rulings r0088 was dropped, leaving 35 drafts, and the
checker counts "used" as a cost word. 258 tests passing, typecheck clean.
2026-11-19: a fifth batch of 68 player-typed texts (r0096–r0163) with draft labels by Claude. It
covers next and undo, craft and remove verbs, reforging, every board frame, augment rounds, stage
forms, out-of-range values, star levels above 3, and deferred topics (opponents, streaks, xp,
bench, plans). The checker gives 0 errors. It found a resolver gap: "chains" doesn't resolve,
because the plural fallback only retries exact names (step 7). After review, the player confirmed
92 rows, and 14 rows (new labels or reopened) became drafts. All of them were then confirmed,
r0156 last (relabeled +10 gold). With `hpChange`, `newGame` and the
250 cap: 265 tests passing, typecheck and lint clean. Synthetic data was regenerated without the
"lost 12 hp" aside: test split 100 exact and 3 near duplicates removed, was 98 and 2.

**2026-11-19: Eval harness and rule-based baseline (CPU, local; no GPU or browser run).**
`npm run ml:baseline`, scorer v1. Results are in `ml-evals/results/{synthetic-v1,real}/`
(scored 20261119T232755 synthetic, 20261119T232801 real). The two test sets are reported apart.

| System | Test set | n | Exact | Verbatim exact | Schema-valid | Micro P | Micro R | Micro F1 |
|---|---|---|---|---|---|---|---|---|
| `quickbar` | synthetic-v1 | 2000 | 17.9% | 17.9% | 100% | 99.0% | 15.1% | 26.2% |
| `quickbar` | real (confirmed) | 162 | 24.7% | 24.7% | 100% | 36.7% | 4.6% | 8.1% |
| `quickbar-lenient` | synthetic-v1 | 2000 | 18.2% | 18.1% | 100% | 26.2% | 24.8% | 25.5% |
| `quickbar-lenient` | real (confirmed) | 162 | 17.3% | 17.3% | 100% | 12.4% | 17.1% | 14.4% |

- `quickbar` is exact on every detected quick-bar line: 319 synthetic and 6 real. On plain text it
  is exact 2.3% of the time on synthetic and 21.8% on real.
- Its real-set exact matches are mostly the 34 `{}` examples: questions, plans and gibberish. On
  those, outputting `{}` for an unreadable line happens to be right.
- Its real-set precision is low because "Akali 2 Camille 2" reads as gold 2 plus crafts (r0005–r0008),
  and bare lists read as `craft` where the label is `set`.
- The lenient variant finds more fields (recall 17.1% vs 4.6% on real), but at precision 12.4%. It
  also loses most `{}` exact matches, getting only 32.4% of `empty` right on real.
- Fields neither baseline ever predicts: `set` (2,130 synthetic and 98 real gold mentions), `clear`,
  `goldChange` (20 real), `hpChange`, `newGame` and `at`.
- An earlier run that same day used a detector that wrongly treated "of", "the" and "gold" inside
  names as cue words. Its results were deleted, never recorded, and the run was repeated after the fix.
  The same predictions were then re-scored to add `mismatchCount` and trim the synthetic files. The
  numbers were identical.
- Tests: 280 passing (15 new: scorer metrics checked against hand-worked values, the baseline,
  categories). Typecheck and lint clean. `ml:check-real`: 0 errors.

**2026-11-19: Step 5 prompt builder and prompt export (CPU, local; no GPU or browser run).**
- Tests: 19 new in `src/assistant/prompt.test.ts`; full suite 299 passing; typecheck and lint clean.
- `npm run ml:prompts` (prompt-v1). Re-exported after committing, so the headers record commit
  `7175019` with `dirty: false`; the numbers didn't change:

  | Test set | Prompts | Candidate recall (labeled names) | Candidates per message | Longest prompt |
  |---|---|---|---|---|
  | synthetic-v1 | 2000 | 99.4% | 2.12 | 5,609 chars |
  | real (confirmed) | 162 | 90.8% | 1.13 | 5,472 chars |

  The rendered prompt for r0001 is 6,927 characters with template tokens (no tokenizer was run
  locally, so the token count is unmeasured; `predict_hf.py` prints it and stops if it is over the 4k context).
- Format check: `predict_hf.py`'s `read_prompts`, `render` (with the real `mlc-chat-config.json`)
  and `write_predictions` were run locally on both exports. The placeholder `{}` outputs were
  scored in memory (no results file written): the scorer accepted the hashes and ids. As a floor
  for reading model results, always answering `{}` scores 21.0% exact on real (its 34 empty labels)
  and 2.0% on synthetic.
- **Base Llama 3.2 1B, prompted:** run later the same day on Colab; see the next entry.

**2026-11-19: Step 5 base Llama 3.2 1B, prompted (Colab T4 run by the player; scored locally).**
`meta-llama/Llama-3.2-1B-Instruct`, prompt-v1 from the clean export at `7175019`, WebLLM llama-3_1
template, greedy, max_new_tokens 256, bf16 on a Tesla T4, transformers 5.23.0, torch 2.14.1+cu130.
Batches of 16 ran out of memory and split to 8 (the pre-`318a23a` runner), so the sizes run were
8 (and a final 2 on real). Took 389 s for real and 5,483 s for synthetic. Scorer v1; results in
`ml-evals/results/real/llama-3.2-1b-prompted.scorer-v1.20261120T050039.json` and
`ml-evals/results/synthetic-v1/llama-3.2-1b-prompted.scorer-v1.20261120T050040.json`.

| System | Test set | n | Exact | Verbatim exact | Schema-valid | Micro P | Micro R | Micro F1 |
|---|---|---|---|---|---|---|---|---|
| `llama-3.2-1b-prompted` | synthetic-v1 | 2000 | 8.9% | 8.6% | 87.6% | 38.0% | 37.6% | 37.8% |
| `llama-3.2-1b-prompted` | real (confirmed) | 162 | 19.8% | 19.8% | 88.3% | 19.9% | 30.8% | 24.2% |
| `quickbar` (for comparison) | synthetic-v1 | 2000 | 17.9% | 17.9% | 100% | 99.0% | 15.1% | 26.2% |
| `quickbar` (for comparison) | real (confirmed) | 162 | 24.7% | 24.7% | 100% | 36.7% | 4.6% | 8.1% |

- Exact match is below `quickbar` on both sets. On real it is also below the always-`{}` floor
  (21.0%): it gets only 29.4% of the 34 empty labels right.
- It finds more than the quick bar (micro F1 24.2% vs 8.1% on real, 37.8% vs 26.2% on synthetic),
  and it predicts fields the quick bar never does (`set`, `clear`, `newGame`). Precision is low.
- Over-prediction on real: `gold` 76 predicted for 13 gold (precision 13.2%), `craft` 90 for 15
  (4.4%), `clear` 30 for 12. `remove` is never predicted on real (20 gold). `at`, `count` and
  `stars` examples are never exact on either set.
- About 12% of outputs are not schema-valid. On synthetic, 84 of 2,000 aren't JSON at all: 46 put
  other fields inside a `set` mention (`{"name":"stage":"2-5"}`), and 38 add a trailing `"` after
  the object. The rest parse but fail the schema. Real-set mismatches were not inspected, to keep
  prompt and training changes from being tuned to the test set.
- 1 real and 10 synthetic outputs hit max_new_tokens.
- Reading: prompting alone doesn't reach a usable translator at 1B. This is the number fine-tuning
  (step 6) has to beat.

**2026-11-19: Step 6 fine-tune pipeline, CPU smoke test (local; no GPU or browser run).**
- Run in a scratch venv (Python 3.14, torch 2.15.0, transformers 5.23.0, peft 0.22.0). It used a
  tiny random Llama (2 layers, hidden 64), the real Llama 3.2 tokenizer and conv_template from the
  prebuilt repo, and 20 train rows. Only the code paths were checked; its outputs are noise by design.
- Checked:
  - `train` and `merge` run end to end;
  - the reply-only loss equals Hugging Face's own label-masked loss (11.794581 vs 11.794582);
  - a run interrupted while writing a checkpoint resumes from the last complete one, with adapter
    weights and loss log identical to an uninterrupted run;
  - `predict` writes harness-format files through `predict_hf.py`, and skips complete ones on a rerun;
  - a changed `lora.r` is refused for an existing run.
- Not exercised: CUDA paths (fp16 autocast, grad scaler, gradient checkpointing on GPU), memory at
  micro-batch 4, `convert` and `upload`. The T4 times in `ml-evals/README.md` are estimates, not
  measurements.
- `npm run ml:prompts`: 20,000 train prompts. 1 target was normalized by the schema
  (`train-012836`). Test-set prompt stats unchanged.
- Tests: 302 passing (3 new for the train prompt export); typecheck and lint clean.
- **Fine-tuned Llama 3.2 1B (`llama-3.2-1b-ft-v1`): not run yet.**

**2026-11-20/21: First Colab run of `ft-v1` (T4, run by the player; reported in chat).**
- Training first failed on import: Colab's preinstalled torchao 0.10.0 is too old for peft
  ("only versions above 0.16.0 are supported"). Removing torchao fixed it.
- Training and merge then completed: `merged/` exists on Drive, and convert read it. The training
  losses, `merge_check.json` and predictions haven't been sent yet, so there are no results to
  record.
- MLC (convert), in order:
  1. In Colab's Python: `OSError: libtvm_runtime_extra.so` on import. A clean reinstall of one
     matching nightly pair fixed the import.
  2. `convert_weight` then failed: "Could not convert T.float16 to a NumPy dtype". Colab's NumPy
     is 2.5.5.
  3. A fresh Python 3.12 venv (export test step 3b) failed with `libtvm_runtime_extra.so` on import,
     including after pinning the versions. Not solved; the exact versions weren't sent.
  4. Colab's Python, with `numpy<2.3` put first via `PYTHONPATH`, got past the NumPy error. It
     loaded the weights, then segfaulted (exit -11) in `tvm::Script` / `ReprPrint` while compiling
     the CUDA quantize function for the embedding (128256 × 2048).
- Next: `convert.device` (new config key, default `auto`) passes `--device cpu` to `convert_weight`,
  which avoids the CUDA kernel compile. Not tried yet.
- 2026-11-22, a fresh runtime with the README's new cells: Colab's Python is now 3.13. MLC failed
  to import again (`libtvm_runtime_extra.so`) after cell 9's clean install, so convert stopped
  before `convert_weight`. CPU conversion and upload still haven't run.
- The wheel index (https://mlc.ai/wheels, checked 2026-11-22) keeps only the latest nightly of each
  package: `mlc-ai-nightly-*` 0.26.dev246 and `mlc-llm-nightly-*` 0.26.dev6. So no older nightly
  pair can be pinned. It also has stable builds: `mlc-ai-{cpu,cu124,cu128,cu130}` 0.20.0 and
  `mlc-llm-{cpu,cu128,cu130}` 0.20.0.dev0 for Linux, and the `cpu` pair for macOS 26 arm64. All
  are `py3-none`, so the Python version doesn't matter.
- The stable CPU pair installed on Colab but failed to import: `libtvm_runtime.so: undefined symbol
  tvm::ffi::json::Stringify(Any const&, Optional<int>)`. `mlc-ai-cpu` 0.20.0 doesn't pin
  `apache-tvm-ffi`, and pip took the latest, 0.1.16.
- Static check, run locally with pyelftools on the Linux wheels (2026-11-22). It compared the tvm-ffi
  symbols that `mlc-ai-cpu` 0.20.0 (34) and `mlc-llm-cpu` 0.20.0.dev0 (26) leave undefined with
  what each `apache-tvm-ffi` release's `libtvm_ffi.so` exports:
  - only 0.1.10, 0.1.11 and 0.1.12 export all of them;
  - 0.1.0–0.1.9 lack `tvm::ffi::ReprPrint`;
  - 0.1.13–0.1.16 lack that `Stringify`.

  This shows the libraries link; it doesn't show the conversion works.
- The stable pair with `apache-tvm-ffi==0.1.12` on Colab: it imported, then aborted at startup with
  "TypeAttr `__ffi_repr__` is already registered for type index 130". Not solved. Then the Colab
  runtime disconnected, so conversion moved to the Mac.
- 2026-11-23, MLC on the Mac (macOS 26.6, arm64), tested by converting a tiny random Llama (2
  layers, hidden size 128, llama3 rope) to q4f16_1. The real `merged/` model hasn't been
  converted yet:
  - The macOS arm64 wheels' dylibs have invalid code signatures, so macOS kills Python on
    `import tvm` (exit 137). An ad-hoc `codesign --force --sign -` of every `.dylib`/`.so` under
    `tvm/` and `mlc_llm/` fixes it.
  - Python 3.14 only has NumPy 2.3 or newer, and 2.3.5, 2.4.6 and 2.5.5 all fail in
    `convert_weight`'s dtype conversion. Python 3.12 with NumPy 2.2.6 works.
  - With NumPy from conda-forge, `libomp` loads twice, once from its OpenBLAS and once from
    torch's bundled copy, so Python aborts with OMP Error #15. NumPy from pip avoids this.
  - The nightly pair (`mlc-ai-nightly-cpu` 0.26.dev246, `mlc-llm-nightly-cpu` 0.26.dev6) declares
    `apache-tvm-ffi>=0.1.13`:
    - with 0.1.16, the latest, quantizing segfaults in `tvm::s_tir::Schedule` on both CPU and
      Metal. This is probably the same failure as Colab's CUDA segfault;
    - 0.1.15 and 0.1.14, both yanked, abort (exit 134);
    - 0.1.13, also yanked, converts (exit 0). The output has `q_weight` uint32 and `q_scale`
      float16 tensors, and a rebuilt environment wrote a byte-identical shard.
  - Saved as `scripts/ml/train/conda_env.yml` (the `dao-tft` env): Python 3.12, pip NumPy 2.2.6,
    the nightly pair and ffi 0.1.13 pinned, torch 2.15.0, huggingface_hub 2.4.0, plus the
    re-sign step.
  - ft-v1 converted on the Mac, 2026-11-23, using `finetune.py --stages convert` in `dao-tft` with
    `convert.device` "cpu".
    - Input: `merged/` downloaded from Drive. Drive renamed `model.safetensors` to
      `model-001.safetensors`, so it was renamed back, after checking it was complete (146 bf16
      tensors, 16 layers).
    - It took 25 s wall time, with 2.3 GB peak RAM.
    - Output: 22 shards, 0.647 GB, 4.501 bits per parameter. All 163 parameters match the layout of
      `mlc-ai/Llama-3.2-1B-Instruct-q4f16_1-MLC`.
    - Uploaded the same day (`--stages upload`) to
      https://huggingface.co/edhu8045/Llama-3.2-1B-dao-tft-ft-v1-q4f16_1-MLC. It is public, at
      commit `a66c59b8f0`.
    - The repo has 32 files, 0.705 GB in total: the 22 shards, `tensor-cache.json`,
      `ndarray-cache.json`, `mlc-chat-config.json`, the tokenizer files, the model card (with
      "Built with Llama"), LICENSE.txt, USE_POLICY.md and `dao-training.json`.
    - WebLLM loading and browser evals haven't run yet.

## Open questions

- Settled: the fine-tune trains on prompt-v1 as is (decision log). Still open: once a fine-tune
  works, would a prompt-v2 without the 14 example turns do as well? It would cut training time about
  5× and the browser's prefill, which is unmeasured (step 7).
- Generator bug: `train-012836` has a label name with a trailing space (`"makeshift armor "`). The
  train export trims it. Fix it in the generator with the next data version.
- Worth trying later: WebLLM's JSON-schema constrained decoding (`response_format`) as a separate
  system. Greedy free-text decoding is the baseline here.

- Synthetic-data gaps: only one undo example per split survives dedupe ("u" / "undo"). Not
  generated yet: a count on a unit (A5), numbered augment names typed with digits (A10), "no X" for a
  specific thing (A19), out-of-range stars (A24), vague amounts (A33), "I'm at N" (A21), gold
  changes (rule 16b, A28b–f; the generator has "sold X" and "bought X" without amounts only), HP
  changes (rule 17b), `newGame` (rule 26), undo of the last entry (rule 25).
  Decide in step 6 whether to upweight undo and add these.

- Does the Llama export test pass in the browser? If MLC conversion crashes on Colab's Python, run MLC
  from a Python 3.12 environment (set `MLC_PYTHON`, see `experiments/export-test/README.md` step 3b).
- Does MLC's weight loader in the 3.12 environment need torch? The README installs a CPU build just in
  case; this hasn't been checked.
