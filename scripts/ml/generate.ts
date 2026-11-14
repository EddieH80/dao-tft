/**
 * Generates the synthetic training and test sets for the assistant model
 * (docs/ml-plan.md step 3): player-style messages paired with the exact label
 * docs/ml-state-contract.md gives them, validated with the app's own schema.
 *
 * Usage: npm run ml:data [-- --seed 1 --train 20000 --test 2000 --out ml-data]
 * Writes <out>/<DATA_VERSION>/{train,test}.jsonl, manifest.json, stats.json and stats.md.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { StateUpdateSchema } from "../../src/assistant/contract";
import { augmentStages, catalog, patch } from "../../src/data";
import { Deduper, type DupKind } from "./dedupe";
import { serialize } from "./labels";
import { makeExample, type Example } from "./render";
import { Rng } from "./rng";
import { sampleGame } from "./sample";
import { splitStats, statsMarkdown, type SplitStats } from "./stats";
import type { Pool } from "./templates";
import { buildVocab } from "./vocab";

/** Bump when the generator's output changes for the same seed, so old and new sets aren't mixed. */
export const DATA_VERSION = "v1";

const ROOT = resolve(__dirname, "../..");

export interface Record_ extends Example {
  id: string;
  /** The training target: the label as compact JSON in contract key order. */
  target: string;
}

export interface Generated {
  train: Record_[];
  test: Record_[];
  removed: Record<Pool, Record<DupKind | "acrossSplits", number>>;
  attempts: Record<Pool, number>;
  stats: Record<Pool, SplitStats>;
}

/** Each split has its own random stream, so changing one size never changes the other split. */
export const splitSeed = (seed: number, pool: Pool) => (pool === "train" ? seed : Math.imul(seed ^ 0x5bd1e995, 2654435761) >>> 0);

export function generate(opts: { seed: number; train: number; test: number }): Generated {
  const v = buildVocab();
  const kept: Record<Pool, Deduper> = { train: new Deduper(), test: new Deduper() };
  const removed: Generated["removed"] = {
    train: { exact: 0, near: 0, acrossSplits: 0 },
    test: { exact: 0, near: 0, acrossSplits: 0 },
  };
  const attempts: Generated["attempts"] = { train: 0, test: 0 };
  const out: Record<Pool, Record_[]> = { train: [], test: [] };

  for (const pool of ["train", "test"] as const) {
    const rng = new Rng(splitSeed(opts.seed, pool));
    const target = opts[pool];
    const limit = target * 50;
    while (out[pool].length < target) {
      if (++attempts[pool] > limit) throw new Error(`Only ${out[pool].length} distinct ${pool} examples in ${limit} tries`);
      const ex = makeExample(rng, pool, v, sampleGame(rng, v));
      const parsed = StateUpdateSchema.safeParse(ex.label);
      if (!parsed.success) {
        throw new Error(`Invalid label for "${ex.text}": ${JSON.stringify(ex.label)}\n${parsed.error.message}`);
      }
      // The test set never repeats training text, exactly or nearly.
      if (pool === "test" && kept.train.check(ex.text)) {
        removed.test.acrossSplits++;
        continue;
      }
      const dup = kept[pool].check(ex.text);
      if (dup) {
        removed[pool][dup]++;
        continue;
      }
      kept[pool].add(ex.text);
      const n = String(out[pool].length + 1).padStart(6, "0");
      out[pool].push({ id: `${pool}-${n}`, ...ex, target: serialize(ex.label) });
    }
  }
  return {
    ...out,
    removed,
    attempts,
    stats: { train: splitStats(out.train, v), test: splitStats(out.test, v) },
  };
}

const sha256 = (path: string) => createHash("sha256").update(readFileSync(resolve(ROOT, path))).digest("hex");

function git(args: string[]): string {
  try {
    return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

function arg(name: string, fallback: number): number;
function arg(name: string, fallback: string): string;
function arg(name: string, fallback: number | string) {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const value = process.argv[i + 1];
  if (typeof fallback === "number") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error(`--${name} needs a whole number`);
    return n;
  }
  return value;
}

function main() {
  const seed = arg("seed", 1);
  const sizes = { train: arg("train", 20000), test: arg("test", 2000) };
  const dir = resolve(ROOT, arg("out", "ml-data"), DATA_VERSION);
  const started = Date.now();
  const g = generate({ seed, ...sizes });

  mkdirSync(dir, { recursive: true });
  for (const pool of ["train", "test"] as const) {
    writeFileSync(resolve(dir, `${pool}.jsonl`), g[pool].map((r) => JSON.stringify(r)).join("\n") + "\n");
  }
  const snapshot = catalog.snapshot;
  const manifest = {
    dataVersion: DATA_VERSION,
    generator: "scripts/ml/generate.ts",
    command: `npm run ml:data -- --seed ${seed} --train ${sizes.train} --test ${sizes.test}`,
    seed,
    splitSeeds: { train: splitSeed(seed, "train"), test: splitSeed(seed, "test") },
    counts: { train: g.train.length, test: g.test.length },
    attempts: g.attempts,
    removedDuplicates: g.removed,
    snapshot: {
      set: snapshot.set,
      fetchedAt: snapshot.fetchedAt,
      source: snapshot.source,
      sha256: sha256("src/data/snapshot.json"),
    },
    aliasesSha256: sha256("src/data/aliases.json"),
    augmentPoolsPatch: augmentStages[0].patch,
    compsPatch: patch,
    contract: {
      doc: "docs/ml-state-contract.md",
      docSha256: sha256("docs/ml-state-contract.md"),
      schemaSha256: sha256("src/assistant/contract.ts"),
    },
    git: { commit: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "" },
    createdAt: new Date().toISOString(),
  };
  writeFileSync(resolve(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  writeFileSync(resolve(dir, "stats.json"), JSON.stringify(g.stats, null, 2) + "\n");
  writeFileSync(resolve(dir, "stats.md"), statsMarkdown(g.stats));

  console.log(
    `Wrote ${g.train.length} train and ${g.test.length} test examples to ${dir} in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  console.log(`Duplicates removed: ${JSON.stringify(g.removed)}`);
}

if (require.main === module) main();
