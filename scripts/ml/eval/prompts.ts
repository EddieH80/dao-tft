/**
 * Exports the app's prompt (src/assistant/prompt.ts) for every example of a test set, so a
 * Python run (predict_hf.py) sends the model exactly what the app would. Format in
 * ml-evals/README.md: the preamble (system message and example turns) is stored once in the
 * header, and each row holds the final user turn.
 *
 * It also exports the train split the same way, with each row's target, for the fine-tune
 * (scripts/ml/train/finetune.py), so training sees exactly the prompt the app sends.
 *
 * Usage: npm run ml:prompts            (train split and both test sets)
 * Writes ml-data/prompts/<testSet>.jsonl and train.synthetic-<dataVersion>.jsonl (gitignored: regenerable).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { StateUpdateSchema, type StateUpdate } from "../../../src/assistant/contract";
import { PROMPT_VERSION, buildPrompt, findCandidates, promptPreamble, type ChatMessage } from "../../../src/assistant/prompt";
import { normalize, type QuickLexicon } from "../../../src/engine/quick";
import { DATA_VERSION } from "../generate";
import { serialize } from "../labels";
import { buildVocab } from "../vocab";
import { gitInfo } from "./predictions";
import { ROOT, loadTestSet, sha256, type TestSetKey } from "./testsets";

export interface PromptsHeader {
  prompts: 1;
  promptVersion: string;
  testSet: string;
  testSetSha256: string;
  /** WebLLM's conv_template for the base model; predict_hf.py renders the messages with it. */
  chatTemplate: "llama-3_1";
  createdAt: string;
  git: { commit: string; dirty: boolean };
  /** The messages before each row's user turn: the system message and the example turns. */
  preamble: ChatMessage[];
}

export interface PromptRow {
  id: string;
  /** The final user turn: the names found in the message, then the message. */
  user: string;
}

export interface PromptStats {
  examples: number;
  /** Labeled names (normalized) that appear among the message's candidates. */
  candidateRecall: number;
  meanCandidates: number;
  /** Of the whole prompt, preamble included. */
  maxChars: number;
}

export function exportPrompts(test: TestSetKey): { header: PromptsHeader; rows: PromptRow[]; stats: PromptStats } {
  const testSet = loadTestSet(test);
  const lexicon = buildVocab().lexicon;
  const preamble = promptPreamble(lexicon);
  let gold = 0;
  let hit = 0;
  let candidates = 0;
  let maxChars = 0;
  const rows = testSet.examples.map((ex) => {
    const messages = buildPrompt(ex.text, lexicon);
    const last = messages.at(-1)!;
    if (messages.length !== preamble.length + 1 || last.role !== "user") throw new Error("unexpected prompt shape");
    // Stats only: the label never reaches the prompt.
    const typed = new Set(findCandidates(ex.text, lexicon).map((c) => normalize(c.typed)));
    candidates += typed.size;
    const names = new Set(
      [ex.label.set, ex.label.remove, ex.label.add, ex.label.craft].flatMap((l) => l ?? []).map((m) => normalize(m.name)),
    );
    gold += names.size;
    for (const n of names) if (typed.has(n)) hit++;
    maxChars = Math.max(maxChars, messages.reduce((n, m) => n + m.content.length, 0));
    return { id: ex.id, user: last.content };
  });
  return {
    header: {
      prompts: 1,
      promptVersion: PROMPT_VERSION,
      testSet: testSet.name,
      testSetSha256: testSet.sha256,
      chatTemplate: "llama-3_1",
      createdAt: new Date().toISOString(),
      git: gitInfo(),
      preamble,
    },
    rows,
    stats: { examples: rows.length, candidateRecall: gold ? hit / gold : 1, meanCandidates: candidates / rows.length, maxChars },
  };
}

/** Header of the training prompts file: like a test prompts file, but for the train split. */
export interface TrainPromptsHeader {
  prompts: 1;
  promptVersion: string;
  split: "train";
  dataVersion: string;
  /** Of ml-data/<dataVersion>/train.jsonl. */
  trainSha256: string;
  /** The generator's manifest (seed, snapshot, contract hashes, generator commit). */
  manifest: unknown;
  chatTemplate: "llama-3_1";
  createdAt: string;
  git: { commit: string; dirty: boolean };
  preamble: ChatMessage[];
}

export interface TrainPromptRow extends PromptRow {
  /** The assistant's reply to train on: the label as compact JSON in contract key order. */
  target: string;
}

/**
 * The app's prompt for each training example, with its target. Built by the same buildPrompt the
 * app calls at runtime, so training sees exactly what production sends (docs/ml-plan.md step 6).
 */
export function trainPromptRows(
  examples: readonly { id: string; text: string; label: StateUpdate; target: string }[],
  lexicon: QuickLexicon,
): { rows: TrainPromptRow[]; normalized: string[] } {
  const preamble = promptPreamble(lexicon);
  const normalized: string[] = [];
  const rows = examples.map((ex) => {
    const messages = buildPrompt(ex.text, lexicon);
    const last = messages.at(-1)!;
    if (messages.length !== preamble.length + 1 || last.role !== "user") throw new Error("unexpected prompt shape");
    if (ex.target !== serialize(ex.label)) throw new Error(`${ex.id}: target isn't the canonical label`);
    // Train on the label as the app's schema reads it (it trims names), so the model never learns
    // a form the scorer and app would change. Data v1 has one such row (a name with a trailing space).
    const target = serialize(StateUpdateSchema.parse(ex.label));
    if (target !== ex.target) normalized.push(ex.id);
    return { id: ex.id, user: last.content, target };
  });
  return { rows, normalized };
}

export function exportTrainPrompts(): { header: TrainPromptsHeader; rows: TrainPromptRow[]; normalized: string[] } {
  const dataDir = resolve(ROOT, "ml-data", DATA_VERSION);
  const content = readFileSync(resolve(dataDir, "train.jsonl"), "utf8");
  const examples = content
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { id: string; text: string; label: StateUpdate; target: string });
  const lexicon = buildVocab().lexicon;
  return {
    header: {
      prompts: 1,
      promptVersion: PROMPT_VERSION,
      split: "train",
      dataVersion: DATA_VERSION,
      trainSha256: sha256(content),
      manifest: JSON.parse(readFileSync(resolve(dataDir, "manifest.json"), "utf8")),
      chatTemplate: "llama-3_1",
      createdAt: new Date().toISOString(),
      git: gitInfo(),
      preamble: promptPreamble(lexicon),
    },
    ...trainPromptRows(examples, lexicon),
  };
}

function main() {
  const dir = resolve(ROOT, "ml-data", "prompts");
  mkdirSync(dir, { recursive: true });
  {
    const { header, rows, normalized } = exportTrainPrompts();
    const path = resolve(dir, `train.synthetic-${DATA_VERSION}.jsonl`);
    writeFileSync(path, [header, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(
      `Wrote ${rows.length} training prompts to ${relative(ROOT, path)} (${PROMPT_VERSION}, data ${DATA_VERSION}); ` +
        `${normalized.length} targets normalized by the schema${normalized.length ? `: ${normalized.join(", ")}` : ""}`,
    );
  }
  for (const test of ["synthetic", "real"] as const) {
    const { header, rows, stats } = exportPrompts(test);
    const path = resolve(dir, `${header.testSet}.jsonl`);
    writeFileSync(path, [header, ...rows].map((r) => JSON.stringify(r)).join("\n") + "\n");
    const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
    console.log(
      `Wrote ${rows.length} prompts to ${relative(ROOT, path)} (${PROMPT_VERSION}): candidate recall ${pct(stats.candidateRecall)}, ` +
        `${stats.meanCandidates.toFixed(2)} candidates per message, longest prompt ${stats.maxChars} chars` +
        (header.git.dirty ? " (working tree dirty: commit, then re-export for a clean header)" : ""),
    );
  }
}

if (require.main === module) main();
