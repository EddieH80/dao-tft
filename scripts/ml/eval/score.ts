/**
 * Scores any predictions file against its test set (docs/ml-plan.md step 4). Definitions are in
 * ml-evals/README.md; bump SCORER_VERSION whenever one changes, so results stay comparable.
 *
 * Usage: npm run ml:score -- ml-data/predictions/<system>.<testSet>.jsonl
 * Writes ml-evals/results/<testSet>/<system>.scorer-v<N>.<timestamp>.json and prints a summary.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { StateUpdateSchema, type Mention, type StateUpdate } from "../../../src/assistant/contract";
import { normalize } from "../../../src/engine/quick";
import { DATA_VERSION } from "../generate";
import { KEY_ORDER } from "../labels";
import { buildVocab } from "../vocab";
import { categoriesOf } from "./categories";
import { parsePredictions, type Predictions, type PredictionsHeader } from "./predictions";
import { ROOT, loadTestSet, type TestExample, type TestSet } from "./testsets";

export const SCORER_VERSION = 1;

/** Every top-level field of a label, in contract order. */
export const FIELDS = KEY_ORDER;
export type Field = (typeof FIELDS)[number];
const MENTION_LISTS = new Set<Field>(["set", "remove", "add", "craft"]);

export interface PRF {
  tp: number;
  predicted: number;
  gold: number;
  /** null when nothing was predicted. */
  precision: number | null;
  /** null when the gold labels have none. */
  recall: number | null;
  f1: number | null;
}

export interface Summary {
  n: number;
  exact: number;
  exactRate: number | null;
  exactVerbatim: number;
  exactVerbatimRate: number | null;
  schemaValid: number;
  schemaValidRate: number | null;
  /** Precision and recall over all fields' units together. */
  micro: PRF;
}

export interface Mismatch {
  id: string;
  text: string;
  gold: StateUpdate;
  output: string;
  /** The parsed prediction, or why it failed to parse. */
  prediction: StateUpdate | { error: string };
  exact: boolean;
  exactVerbatim: boolean;
}

export interface Result {
  scorerVersion: number;
  system: string;
  testSet: string;
  testSetSha256: string;
  predictions: PredictionsHeader;
  scoredAt: string;
  summary: Summary;
  fields: Record<Field, PRF>;
  categories: Record<string, Summary>;
  /** How many examples aren't an exact verbatim match. */
  mismatchCount: number;
  /** Every example that isn't an exact match, or matches only after names are normalized. */
  mismatches: Mismatch[];
}

/**
 * A committed synthetic result: the mismatch list is left out (large, and regenerable) and
 * `mismatchesFile` names the full copy under ml-data/ (gitignored).
 */
export type TrimmedResult = Omit<Result, "mismatches"> & { mismatchesFile: string };

type Parsed = { ok: true; update: StateUpdate } | { ok: false; error: string };

export function parseOutput(output: string): Parsed {
  let json: unknown;
  try {
    json = JSON.parse(output);
  } catch (e) {
    return { ok: false, error: `not JSON: ${(e as Error).message}` };
  }
  const r = StateUpdateSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((x) => `${x.path.join(".") || "update"}: ${x.message}`).join("; ") };
  return { ok: true, update: r.data };
}

type NameKey = (name: string) => string;
/** How the app compares names: the resolver's normalized key. */
export const normalizedName: NameKey = normalize;
/** Names exactly as typed. */
export const verbatimName: NameKey = (n) => n.trim();

/** A field's units, as a multiset of keys: one for a scalar, one per category or mention. */
export function units(u: StateUpdate, field: Field, name: NameKey): string[] {
  const value = u[field];
  if (value === undefined) return [];
  if (MENTION_LISTS.has(field)) {
    return (value as Mention[]).map((m) => `${name(m.name)}|${m.count ?? 1}|${m.stars ?? ""}|${m.at ?? ""}`);
  }
  if (field === "clear") return [...(value as string[])];
  return [JSON.stringify(value)];
}

/** Matched units: each gold unit pairs with at most one equal predicted unit. */
function matched(pred: string[], gold: string[]): number {
  const left = new Map<string, number>();
  for (const k of gold) left.set(k, (left.get(k) ?? 0) + 1);
  let tp = 0;
  for (const k of pred) {
    const n = left.get(k) ?? 0;
    if (n > 0) {
      tp++;
      left.set(k, n - 1);
    }
  }
  return tp;
}

interface Counts {
  tp: number;
  predicted: number;
  gold: number;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

function prf(c: Counts): PRF {
  const precision = ratio(c.tp, c.predicted);
  const recall = ratio(c.tp, c.gold);
  const f1 = precision === null || recall === null ? null : precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { ...c, precision, recall, f1 };
}

interface Scored {
  ex: TestExample;
  output: string;
  parsed: Parsed;
  fields: Record<Field, Counts>;
  exact: boolean;
  exactVerbatim: boolean;
}

function scoreOne(ex: TestExample, output: string): Scored {
  const parsed = parseOutput(output);
  // An invalid output updates nothing, so it is scored as {} (and never as an exact match).
  const pred = parsed.ok ? parsed.update : {};
  const fields = {} as Record<Field, Counts>;
  let exact = parsed.ok;
  let exactVerbatim = parsed.ok;
  for (const f of FIELDS) {
    const p = units(pred, f, normalizedName);
    const g = units(ex.label, f, normalizedName);
    const tp = matched(p, g);
    fields[f] = { tp, predicted: p.length, gold: g.length };
    if (tp !== p.length || tp !== g.length) exact = false;
    const pv = units(pred, f, verbatimName);
    const gv = units(ex.label, f, verbatimName);
    const tpv = matched(pv, gv);
    if (tpv !== pv.length || tpv !== gv.length) exactVerbatim = false;
  }
  return { ex, output, parsed, fields, exact, exactVerbatim };
}

function summarize(rows: Scored[]): Summary {
  const micro: Counts = { tp: 0, predicted: 0, gold: 0 };
  for (const r of rows) {
    for (const f of FIELDS) {
      micro.tp += r.fields[f].tp;
      micro.predicted += r.fields[f].predicted;
      micro.gold += r.fields[f].gold;
    }
  }
  const exact = rows.filter((r) => r.exact).length;
  const exactVerbatim = rows.filter((r) => r.exactVerbatim).length;
  const schemaValid = rows.filter((r) => r.parsed.ok).length;
  const n = rows.length;
  return {
    n,
    exact,
    exactRate: ratio(exact, n),
    exactVerbatim,
    exactVerbatimRate: ratio(exactVerbatim, n),
    schemaValid,
    schemaValidRate: ratio(schemaValid, n),
    micro: prf(micro),
  };
}

/** Scores predictions against a test set. Throws if they aren't for this exact test set. */
export function score(testSet: TestSet, predictions: Predictions, categorize: (ex: TestExample) => string[]): Result {
  const { header, rows } = predictions;
  if (header.testSet !== testSet.name) throw new Error(`predictions are for ${header.testSet}, not ${testSet.name}`);
  if (header.testSetSha256 !== testSet.sha256) {
    throw new Error(`predictions were made on a different version of ${testSet.name} (sha256 differs); rerun the predictions`);
  }
  const outputs = new Map<string, string>();
  for (const r of rows) {
    if (outputs.has(r.id)) throw new Error(`prediction for ${r.id} is repeated`);
    outputs.set(r.id, r.output);
  }
  const ids = new Set(testSet.examples.map((e) => e.id));
  const extra = rows.filter((r) => !ids.has(r.id)).map((r) => r.id);
  if (extra.length) throw new Error(`predictions for ids not in ${testSet.name}: ${extra.slice(0, 5).join(", ")}`);
  const missing = testSet.examples.filter((e) => !outputs.has(e.id)).map((e) => e.id);
  if (missing.length) throw new Error(`no prediction for ${missing.length} examples: ${missing.slice(0, 5).join(", ")}`);

  const scored = testSet.examples.map((ex) => scoreOne(ex, outputs.get(ex.id)!));

  const fields = {} as Record<Field, PRF>;
  for (const f of FIELDS) {
    const c: Counts = { tp: 0, predicted: 0, gold: 0 };
    for (const r of scored) {
      c.tp += r.fields[f].tp;
      c.predicted += r.fields[f].predicted;
      c.gold += r.fields[f].gold;
    }
    fields[f] = prf(c);
  }

  const byCategory = new Map<string, Scored[]>();
  for (const r of scored) for (const c of categorize(r.ex)) byCategory.set(c, [...(byCategory.get(c) ?? []), r]);
  const categories: Record<string, Summary> = {};
  for (const c of [...byCategory.keys()].sort()) categories[c] = summarize(byCategory.get(c)!);

  return {
    scorerVersion: SCORER_VERSION,
    system: header.system,
    testSet: testSet.name,
    testSetSha256: testSet.sha256,
    predictions: header,
    scoredAt: new Date().toISOString(),
    summary: summarize(scored),
    fields,
    categories,
    mismatchCount: scored.filter((r) => !r.exact || !r.exactVerbatim).length,
    mismatches: scored
      .filter((r) => !r.exact || !r.exactVerbatim)
      .map((r) => ({
        id: r.ex.id,
        text: r.ex.text,
        gold: r.ex.label,
        output: r.output,
        prediction: r.parsed.ok ? r.parsed.update : { error: r.parsed.error },
        exact: r.exact,
        exactVerbatim: r.exactVerbatim,
      })),
  };
}

const pct = (x: number | null) => (x === null ? "–" : `${(100 * x).toFixed(1)}%`);

export function resultMarkdown(r: Result): string {
  const s = r.summary;
  const lines = [
    `## ${r.system} on ${r.testSet} (scorer v${r.scorerVersion}, n=${s.n})`,
    "",
    `Exact match ${pct(s.exactRate)} (${s.exact}), verbatim names ${pct(s.exactVerbatimRate)} (${s.exactVerbatim}), ` +
      `schema-valid ${pct(s.schemaValidRate)} (${s.schemaValid}); micro P ${pct(s.micro.precision)} R ${pct(s.micro.recall)} F1 ${pct(s.micro.f1)}`,
    "",
    "| Field | Gold | Predicted | Precision | Recall |",
    "|---|---|---|---|---|",
    ...FIELDS.map((f) => {
      const x = r.fields[f];
      return `| ${f} | ${x.gold} | ${x.predicted} | ${pct(x.precision)} | ${pct(x.recall)} |`;
    }),
    "",
    "| Category | n | Exact | Schema-valid | Micro P | Micro R |",
    "|---|---|---|---|---|---|",
    ...Object.entries(r.categories).map(
      ([c, x]) => `| ${c} | ${x.n} | ${pct(x.exactRate)} | ${pct(x.schemaValidRate)} | ${pct(x.micro.precision)} | ${pct(x.micro.recall)} |`,
    ),
  ];
  return lines.join("\n") + "\n";
}

/** "synthetic-v1" → synthetic, "real" → real; fails for an old synthetic version. */
export function testSetKey(name: string): "synthetic" | "real" {
  if (name === "real") return "real";
  if (name === `synthetic-${DATA_VERSION}`) return "synthetic";
  throw new Error(`unknown or outdated test set "${name}" (current: real, synthetic-${DATA_VERSION})`);
}

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "");

const writeNew = (path: string, value: unknown) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
};

/**
 * Scores a predictions file and writes the versioned results file (committed); returns its path.
 * For the synthetic set, the mismatch list goes only into a full copy under ml-data/ (gitignored),
 * since it is large and the predictions can be regenerated. Real-set results keep it.
 */
export function scoreFile(file: string): { result: Result; path: string } {
  const predictions = parsePredictions(readFileSync(file, "utf8"));
  const key = testSetKey(predictions.header.testSet);
  const testSet = loadTestSet(key);
  const lexicon = buildVocab().lexicon;
  const result = score(testSet, predictions, (ex) => categoriesOf(ex, lexicon));
  const safe = result.system.replace(/[^A-Za-z0-9._-]/g, "_");
  const name = `${safe}.scorer-v${SCORER_VERSION}.${stamp(new Date(result.scoredAt))}.json`;
  const path = resolve(ROOT, "ml-evals", "results", testSet.name, name);
  if (key === "synthetic") {
    const full = resolve(ROOT, "ml-data", "eval-results", testSet.name, name);
    writeNew(full, result);
    const trimmed: Partial<Result> = { ...result };
    delete trimmed.mismatches;
    writeNew(path, { ...trimmed, mismatchesFile: relative(ROOT, full) } as TrimmedResult);
  } else {
    writeNew(path, result);
  }
  return { result, path };
}

function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!files.length) throw new Error("usage: npm run ml:score -- <predictions.jsonl> [...]");
  for (const f of files) {
    const { result, path } = scoreFile(resolve(process.cwd(), f));
    console.log(resultMarkdown(result));
    console.log(`Wrote ${relative(ROOT, path)}\n`);
  }
}

if (require.main === module) main();
