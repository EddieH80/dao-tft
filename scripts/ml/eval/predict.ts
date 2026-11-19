/**
 * Writes a predictions file for a rule-based baseline (format in ml-evals/README.md).
 * Model runs write the same format from Python or the browser.
 *
 * Usage: npm run ml:predict -- --system quickbar|quickbar-lenient --test synthetic|real
 * Writes ml-data/predictions/<system>.<testSet>.jsonl (gitignored: regenerable).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { serialize } from "../labels";
import { buildVocab } from "../vocab";
import { formatPredictions, gitInfo, type Predictions } from "./predictions";
import { BASELINES, quickbarUpdate, type Baseline } from "./quickbar";
import { ROOT, loadTestSet, type TestSetKey } from "./testsets";

export function predictBaseline(system: Baseline, test: TestSetKey): Predictions {
  const testSet = loadTestSet(test);
  const lexicon = buildVocab().lexicon;
  const lenient = system === "quickbar-lenient";
  return {
    header: {
      predictions: 1,
      system,
      testSet: testSet.name,
      testSetSha256: testSet.sha256,
      createdAt: new Date().toISOString(),
      git: gitInfo(),
      notes: lenient
        ? "Quick-bar parser; words it can't read are dropped and the rest kept."
        : "Quick-bar parser; any word it can't read gives {} (the app applies nothing).",
    },
    rows: testSet.examples.map((ex) => ({ id: ex.id, output: serialize(quickbarUpdate(ex.text, lexicon, { lenient })) })),
  };
}

function arg(name: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0 || !process.argv[i + 1]) throw new Error(`--${name} is required`);
  return process.argv[i + 1];
}

function main() {
  const system = arg("system");
  const test = arg("test");
  if (!(BASELINES as readonly string[]).includes(system)) throw new Error(`--system must be one of ${BASELINES.join(", ")}`);
  if (test !== "synthetic" && test !== "real") throw new Error("--test must be synthetic or real");
  const p = predictBaseline(system as Baseline, test);
  const dir = resolve(ROOT, "ml-data", "predictions");
  mkdirSync(dir, { recursive: true });
  const path = resolve(dir, `${system}.${p.header.testSet}.jsonl`);
  writeFileSync(path, formatPredictions(p));
  console.log(`Wrote ${p.rows.length} predictions to ${relative(ROOT, path)}`);
}

if (require.main === module) main();
