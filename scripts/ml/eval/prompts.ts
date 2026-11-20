/**
 * Exports the app's prompt (src/assistant/prompt.ts) for every example of a test set, so a
 * Python run (predict_hf.py) sends the model exactly what the app would. Format in
 * ml-evals/README.md: the preamble (system message and example turns) is stored once in the
 * header, and each row holds the final user turn.
 *
 * Usage: npm run ml:prompts            (both test sets)
 * Writes ml-data/prompts/<testSet>.jsonl (gitignored: regenerable).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { PROMPT_VERSION, buildPrompt, findCandidates, promptPreamble, type ChatMessage } from "../../../src/assistant/prompt";
import { normalize } from "../../../src/engine/quick";
import { buildVocab } from "../vocab";
import { gitInfo } from "./predictions";
import { ROOT, loadTestSet, type TestSetKey } from "./testsets";

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

function main() {
  const dir = resolve(ROOT, "ml-data", "prompts");
  mkdirSync(dir, { recursive: true });
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
