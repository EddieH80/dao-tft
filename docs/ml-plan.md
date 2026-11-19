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
| 4. Eval harness and rule-based baseline | Not started |
| 5. Base model with prompting | Not started |
| 6. Fine-tune, error analysis, iterate | Not started |
| 7. App integration: assistant module, then UI | Not started |
| 8. Write-up and model card | Not started |

## Decision log

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

## Open questions

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
