/**
 * Repairs the hand-kept data files after `npm run fetch-data` replaced the
 * snapshot: an id Community Dragon renamed (same name, new id) is rewritten
 * everywhere, and an augment or alias target it removed is dropped from the
 * stage augment pools, comp-augments.json and aliases.json. A unit or item a
 * hand-written comp still needs is left alone, so the check fails and a person
 * decides. Compares against the snapshot committed at HEAD.
 *
 * Usage: npm run fetch-data && npm run reconcile-data
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { diffSnapshots, reconcileFile } from "../src/data/reconcile";
import type { Snapshot } from "../src/data/schema";

const DATA = resolve(__dirname, "../src/data");

function main() {
  const old = JSON.parse(
    execFileSync("git", ["show", "HEAD:src/data/snapshot.json"], { cwd: DATA, encoding: "utf8", maxBuffer: 64 << 20 }),
  ) as Snapshot;
  const next = JSON.parse(readFileSync(resolve(DATA, "snapshot.json"), "utf8")) as Snapshot;
  const diff = diffSnapshots(old, next);

  const files = [
    ...readdirSync(DATA).filter((f) => /^augments-\d-\d\.json$/.test(f)),
    "comp-augments.json",
    "aliases.json",
    ...readdirSync(resolve(DATA, "comps"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => `comps/${f}`),
  ];

  const changes: string[] = [];
  for (const file of files) {
    const path = resolve(DATA, file);
    const text = readFileSync(path, "utf8");
    const out = reconcileFile(file, text, diff);
    if (out.text !== text) writeFileSync(path, out.text);
    changes.push(...out.changes);
  }
  console.log(changes.length ? changes.join("\n") : "Nothing to reconcile.");
}

main();
