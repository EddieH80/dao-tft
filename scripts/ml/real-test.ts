/**
 * Checks the hand-written real-world test set (ml-data/real-test/examples.jsonl):
 * labels against the contract schema, plus warnings for anything suspicious.
 * See ml-data/real-test/README.md.
 *
 * Usage: npm run ml:check-real [-- --file path/to/examples.jsonl]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { StateUpdateSchema, type Mention, type StateUpdate } from "../../src/assistant/contract";
import { catalog } from "../../src/data";
import { normalize } from "../../src/engine/quick";
import { Deduper } from "./dedupe";
import { DATA_VERSION } from "./generate";
import type { Kind, Selection, Vocab } from "./vocab";
import { buildVocab } from "./vocab";

const ROOT = resolve(__dirname, "../..");
export const REAL_TEST_FILE = "ml-data/real-test/examples.jsonl";

export const RealExampleSchema = z.strictObject({
  id: z.string().regex(/^r\d{4}$/, 'an id like "r0001"'),
  text: z.string().min(1),
  label: z.unknown(),
  status: z.enum(["draft", "confirmed"]),
  note: z.string().min(1).optional(),
});
export type RealExample = z.infer<typeof RealExampleSchema> & { label: StateUpdate };

export interface Issue {
  line: number;
  id: string | null;
  level: "error" | "warning";
  message: string;
}

export interface CheckResult {
  examples: RealExample[];
  issues: Issue[];
}

/** Levels a player is likely to be at on each stage; outside these is suspicious, not impossible. */
const LIKELY_LEVEL: Record<number, [number, number]> = {
  2: [2, 6],
  3: [4, 8],
  4: [5, 9],
  5: [6, 10],
  6: [7, 10],
  7: [7, 10],
};
const LISTS = ["set", "remove", "add", "craft"] as const;
/** A question mark, or a message that opens like a question (rule 21). Test it on lowercased text. */
export const QUESTION = /\?|^\s*(what|which|how|why|when|where|who|should|can|could|would|do|does|is|are)\b/;
const NUMBER =(n: number) => new RegExp(`(?<!\\d)${n}(?!\\d)`);

/** An id's kind and display name, from the whole catalog (the generator's vocab leaves some names out). */
function kindOf(id: string): { kind: Kind; name: string } {
  if (catalog.componentIds.includes(id)) return { kind: "component", name: catalog.componentName(id) };
  const held = catalog.holdable(id);
  if (held) return { kind: "item", name: held.name };
  if (catalog.hasUnit(id)) return { kind: "unit", name: catalog.unit(id).name };
  return { kind: "augment", name: catalog.augmentName(id) };
}

/** What a typed name resolves to: one id, several (ambiguous), or nothing. */
function resolveDetail(v: Vocab, name: string): { id: string } | { ambiguous: string[] } | null {
  const key = normalize(name);
  const exact = v.lexicon.exact(key);
  if (exact.length > 1) return { ambiguous: exact.map((e) => e.name) };
  if (exact.length === 1) return { id: exact[0].id };
  for (const cut of [1, 2]) {
    if (key.length > cut + 1 && key.endsWith(cut === 1 ? "s" : "es")) {
      const found = v.lexicon.exact(key.slice(0, -cut));
      if (found.length === 1) return { id: found[0].id };
    }
  }
  const prefix = v.lexicon.prefix(key);
  if (prefix.length === 1) return { id: prefix[0].id };
  return prefix.length > 1 ? { ambiguous: prefix.map((e) => e.name) } : null;
}

/** Warnings about one valid label, judged against its text. */
function labelWarnings(v: Vocab, text: string, label: StateUpdate): string[] {
  const out: string[] = [];
  const lower = text.toLowerCase();

  for (const key of ["level", "gold", "hp"] as const) {
    const n = label[key];
    if (n !== undefined && !NUMBER(n).test(text)) out.push(`${key} ${n} isn't in the text`);
  }
  if (label.goldChange !== undefined) {
    const n = label.goldChange;
    if (!NUMBER(Math.abs(n)).test(text)) out.push(`goldChange ${n} isn't in the text (fine if it sums several amounts)`);
    if (n > 0 && !/\bsold\b|\bsell|\borb|\bfrom\b/i.test(text)) {
      out.push(`goldChange ${n} is a gain, but the text doesn't sell anything or name a source (rule 16b)`);
    }
    if (n < 0 && !/\b(roll|rolled|rolling|bought|buy|spent|spend|used)\b/i.test(text)) {
      out.push(`goldChange ${n} is a cost, but the text doesn't roll or buy anything (rule 16b)`);
    }
  }
  if (label.hpChange !== undefined && !NUMBER(Math.abs(label.hpChange)).test(text)) {
    out.push(`hpChange ${label.hpChange} isn't in the text`);
  }
  if (label.newGame && !/new game/i.test(text)) out.push(`newGame is set, but the text doesn't say "new game" (rule 26)`);
  if (label.stage) {
    const [s, r] = label.stage.split("-");
    if (!text.includes(label.stage) && !new RegExp(`stage\\s*${s}\\s*round\\s*${r}`, "i").test(text)) {
      out.push(`stage ${label.stage} isn't in the text`);
    }
  }
  if (label.next && !/(^|\s)(n|next)(\s|$)|next round/i.test(text)) out.push(`next is set, but the text has no "n", "next" or "next round"`);
  if (label.undo && !/(^|[,.;!]\s*)(u|undo)\s*[.!]?\s*$|undo (the|my) last|undo to the (past|last|previous)/i.test(text)) {
    out.push(`undo is only for "u" / "undo" as a command, or undo of the last entry or round (rule 25)`);
  }

  const stage = label.stage ? Number(label.stage[0]) : null;
  if (label.level !== undefined && stage !== null) {
    const [lo, hi] = LIKELY_LEVEL[stage];
    if (label.level < lo || label.level > hi) out.push(`level ${label.level} is unlikely at ${label.stage}`);
  }

  const seen = new Map<string, string>();
  const ats: string[] = [];
  let augments = 0;
  let units = 0;
  for (const list of LISTS) {
    for (const m of (label[list] ?? []) as Mention[]) {
      const where = `"${m.name}" in ${list}`;
      const r = resolveDetail(v, m.name);
      if (!r) {
        out.push(`${where} doesn't resolve; the app will suggest a match or drop it (fine if typed that way, rule 4)`);
        continue;
      }
      if ("ambiguous" in r) {
        out.push(`${where} could be ${r.ambiguous.slice(0, 4).join(", ")}${r.ambiguous.length > 4 ? "…" : ""}`);
        continue;
      }
      const { kind, name } = kindOf(r.id);
      if (seen.has(r.id) && seen.get(r.id) !== list) out.push(`${name} is in both ${seen.get(r.id)} and ${list}`);
      seen.set(r.id, list);
      if (m.stars && kind !== "unit") out.push(`${where} has a star level, but ${name} isn't a unit`);
      if (m.count && kind === "augment") out.push(`${where} has a count, but ${name} is an augment`);
      if (m.count && kind === "unit") out.push(`${where}: a count on a unit is ignored when applied (A5)`);
      if (m.at) {
        if (kind !== "augment") out.push(`${where} has at ${m.at}, but ${name} isn't an augment`);
        else if (!v.pools[m.at as Selection].includes(r.id)) out.push(`${name} isn't offered at ${m.at}`);
        ats.push(m.at);
      }
      if (list === "craft" && kind !== "item") out.push(`${where}: crafting a non-item is a plain add, right only in a quick-bar line`);
      if (kind === "augment" && list !== "remove") augments++;
      if (kind === "unit" && (list === "set" || list === "add")) units++;
    }
  }
  if (new Set(ats).size < ats.length) out.push("two augments share one selection (at)");
  if (augments > 3) out.push(`${augments} augments named; a game has at most 3`);
  if (label.clear?.includes("board") && label.level !== undefined && units > label.level + 2) {
    out.push(`the board has ${units} units at level ${label.level}`);
  }
  if (units > 12) out.push(`${units} units named`);
  if (QUESTION.test(lower) && Object.keys(label).length) out.push("the text asks a question: label only statements outside it (rule 21)");
  return out;
}

/** Errors about a label's names not being copied from the text (rule 1). */
function nameErrors(text: string, label: StateUpdate): string[] {
  const out: string[] = [];
  for (const list of LISTS) {
    for (const m of (label[list] ?? []) as Mention[]) {
      if (text.includes(m.name)) continue;
      const hint = text.toLowerCase().includes(m.name.toLowerCase()) ? " (the case differs; copy it as typed)" : "";
      out.push(`"${m.name}" in ${list} isn't copied from the text${hint}`);
    }
  }
  return out;
}

/** Synthetic texts to warn about, when the generated data is present. */
export function syntheticTexts(dir = resolve(ROOT, "ml-data", DATA_VERSION)): Deduper | null {
  const files = ["train.jsonl", "test.jsonl"].map((f) => resolve(dir, f)).filter(existsSync);
  if (!files.length) return null;
  const d = new Deduper();
  for (const f of files) {
    for (const line of readFileSync(f, "utf8").split("\n")) if (line) d.add((JSON.parse(line) as { text: string }).text);
  }
  return d;
}

export function checkRealExamples(content: string, v: Vocab, synthetic: Deduper | null = null): CheckResult {
  const examples: RealExample[] = [];
  const issues: Issue[] = [];
  const ids = new Set<string>();
  const texts = new Deduper();

  content.split("\n").forEach((raw, i) => {
    const line = i + 1;
    if (!raw.trim()) return;
    const issue = (level: Issue["level"], message: string, id: string | null = null) => issues.push({ line, id, level, message });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      issue("error", `not valid JSON: ${(e as Error).message}`);
      return;
    }
    const row = RealExampleSchema.safeParse(json);
    const id = (json as { id?: unknown })?.id;
    if (!row.success) {
      issue("error", row.error.issues.map((x) => `${x.path.join(".") || "line"}: ${x.message}`).join("; "), typeof id === "string" ? id : null);
      return;
    }
    const ex = row.data;
    const err = (m: string) => issue("error", m, ex.id);
    const warn = (m: string) => issue("warning", m, ex.id);

    if (ids.has(ex.id)) err(`id ${ex.id} is used twice`);
    ids.add(ex.id);
    const dup = texts.check(ex.text);
    if (dup === "exact") err("the same text is in another example");
    else if (dup === "near") warn("nearly the same text as another example");
    texts.add(ex.text);
    const synth = synthetic?.check(ex.text);
    if (synth) warn(`${synth === "exact" ? "the same text is" : "nearly the same text is"} in the synthetic data`);

    const label = StateUpdateSchema.safeParse(ex.label);
    if (!label.success) {
      err(`label fails the contract schema: ${label.error.issues.map((x) => `${x.path.join(".") || "label"}: ${x.message}`).join("; ")}`);
      return;
    }
    nameErrors(ex.text, label.data).forEach(err);
    labelWarnings(v, ex.text, label.data).forEach(warn);
    examples.push({ ...ex, label: label.data });
  });
  return { examples, issues };
}

function main() {
  const i = process.argv.indexOf("--file");
  const file = resolve(ROOT, i < 0 ? REAL_TEST_FILE : process.argv[i + 1]);
  const { examples, issues } = checkRealExamples(readFileSync(file, "utf8"), buildVocab(), syntheticTexts());
  const byLine = new Map<number, Issue[]>();
  for (const x of issues) byLine.set(x.line, [...(byLine.get(x.line) ?? []), x]);
  const lines = readFileSync(file, "utf8").split("\n");
  for (const [line, xs] of byLine) {
    const text = (() => {
      try {
        return JSON.stringify((JSON.parse(lines[line - 1]) as { text?: string }).text ?? "");
      } catch {
        return "";
      }
    })();
    console.log(`line ${line} ${xs[0].id ?? ""} ${text}`);
    for (const x of xs) console.log(`  ${x.level === "error" ? "ERROR" : "warn "} ${x.message}`);
  }
  const errors = issues.filter((x) => x.level === "error").length;
  const confirmed = examples.filter((e) => e.status === "confirmed").length;
  console.log(
    `${examples.length} examples with a schema-valid label (${confirmed} confirmed, ${examples.length - confirmed} draft), ` +
      `${errors} errors, ${issues.length - errors} warnings`,
  );
  if (errors) process.exit(1);
}

if (require.main === module) main();
