/**
 * Prints random examples from a generated split.
 *
 * Usage: npm run ml:show [-- --split test --n 20 --seed 7 --out ml-data]
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DATA_VERSION } from "./generate";
import { Rng } from "./rng";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : process.argv[i + 1];
};

const split = arg("split", "train");
const file = resolve(__dirname, "../..", arg("out", "ml-data"), DATA_VERSION, `${split}.jsonl`);
const rows = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l) as { id: string; text: string; target: string });
for (const r of new Rng(Number(arg("seed", "7"))).sample(rows, Number(arg("n", "20")))) {
  console.log(`${r.id}  ${r.text}\n           → ${r.target}`);
}
