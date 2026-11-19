/**
 * The two test sets the eval harness scores against (docs/ml-plan.md step 4):
 * the synthetic test split, and the confirmed rows of the hand-written real-world set.
 * They are always reported apart (Project rules).
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { StateUpdate } from "../../../src/assistant/contract";
import { DATA_VERSION } from "../generate";
import { REAL_TEST_FILE, checkRealExamples } from "../real-test";
import { buildVocab } from "../vocab";

export const ROOT = resolve(__dirname, "../../..");

export interface TestExample {
  id: string;
  text: string;
  label: StateUpdate;
  /** Generator metadata, synthetic rows only. */
  meta?: { mode?: string; scenario?: string };
}

export interface TestSet {
  /** "synthetic-v1" or "real". */
  name: string;
  /** Of the file the examples were read from, so predictions for another version can't be scored against it. */
  sha256: string;
  examples: TestExample[];
}

export type TestSetKey = "synthetic" | "real";

export const sha256 = (content: string) => createHash("sha256").update(content).digest("hex");

export function syntheticTestFile(): string {
  return resolve(ROOT, "ml-data", DATA_VERSION, "test.jsonl");
}

export function loadTestSet(key: TestSetKey): TestSet {
  if (key === "synthetic") {
    const content = readFileSync(syntheticTestFile(), "utf8");
    const examples = content
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const r = JSON.parse(line) as TestExample;
        return { id: r.id, text: r.text, label: r.label, meta: r.meta };
      });
    return { name: `synthetic-${DATA_VERSION}`, sha256: sha256(content), examples };
  }
  const content = readFileSync(resolve(ROOT, REAL_TEST_FILE), "utf8");
  const { examples, issues } = checkRealExamples(content, buildVocab());
  const errors = issues.filter((i) => i.level === "error");
  if (errors.length) throw new Error(`${REAL_TEST_FILE} has ${errors.length} errors; run npm run ml:check-real`);
  // Only confirmed examples count (Project rules).
  const confirmed = examples.filter((e) => e.status === "confirmed").map(({ id, text, label }) => ({ id, text, label }));
  return { name: "real", sha256: sha256(content), examples: confirmed };
}
