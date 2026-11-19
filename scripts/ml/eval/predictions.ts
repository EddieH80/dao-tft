/**
 * The predictions file every system writes (format in ml-evals/README.md): a header line,
 * then one `{id, output}` per test example, where `output` is the system's raw text.
 * Prediction and scoring are separate so the quick-bar baseline, Python model runs and
 * browser runs are all scored by the same code.
 */
import { execFileSync } from "node:child_process";
import { z } from "zod";
import { ROOT } from "./testsets";

export const PredictionsHeaderSchema = z.object({
  predictions: z.literal(1),
  system: z.string().min(1),
  testSet: z.string().min(1),
  testSetSha256: z.string().regex(/^[0-9a-f]{64}$/),
  createdAt: z.string().min(1),
  git: z.object({ commit: z.string(), dirty: z.boolean() }).optional(),
  notes: z.string().optional(),
});
export type PredictionsHeader = z.infer<typeof PredictionsHeaderSchema>;

export const PredictionRowSchema = z.strictObject({
  id: z.string().min(1),
  /** The raw model output, unparsed: invalid JSON is kept so the scorer counts it. */
  output: z.string(),
});
export type PredictionRow = z.infer<typeof PredictionRowSchema>;

export interface Predictions {
  header: PredictionsHeader;
  rows: PredictionRow[];
}

export function parsePredictions(content: string): Predictions {
  const lines = content.split("\n").filter((l) => l.trim());
  if (!lines.length) throw new Error("predictions file is empty");
  const header = PredictionsHeaderSchema.parse(JSON.parse(lines[0]));
  const rows = lines.slice(1).map((l, i) => {
    try {
      return PredictionRowSchema.parse(JSON.parse(l));
    } catch (e) {
      throw new Error(`predictions line ${i + 2}: ${(e as Error).message}`);
    }
  });
  return { header, rows };
}

export const formatPredictions = (p: Predictions) => [p.header, ...p.rows].map((r) => JSON.stringify(r)).join("\n") + "\n";

export function gitInfo(): { commit: string; dirty: boolean } {
  const git = (args: string[]) => {
    try {
      return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
    } catch {
      return "unknown";
    }
  };
  return { commit: git(["rev-parse", "HEAD"]), dirty: git(["status", "--porcelain"]) !== "" };
}
