/**
 * The rule-based baseline: the quick bar's own parser, read as a contract label
 * (docs/ml-state-contract.md rules 22-25). A plain name is `craft`, `+name` is `add`,
 * `-name` is `remove`, a bare number is gold.
 *
 * - `quickbar` (app-faithful, the primary baseline): any word the quick bar can't read
 *   gives `{}`, because the app applies nothing when a chip is red.
 * - `quickbar-lenient`: drops the words that fail and keeps the rest.
 *
 * The baseline has no game state, so checks that depend on it (full board, a removed
 * thing not held) are skipped. Checks that don't (gold over 250, a star level on an
 * item) fail as they do in `runQuick`.
 */
import { LIMITS, type StateUpdate } from "../../../src/assistant/contract";
import { economyModel } from "../../../src/data";
import { stageLabels } from "../../../src/engine/economy";
import { parseQuick, type QuickAction, type QuickLexicon } from "../../../src/engine/quick";
import { LabelBuilder } from "../labels";

export const BASELINES = ["quickbar", "quickbar-lenient"] as const;
export type Baseline = (typeof BASELINES)[number];

const STAGES = new Set(stageLabels(economyModel).filter((s) => /^[2-7]-[1-7]$/.test(s)));

/** Whether an action is one the quick bar would show as a red chip, judged without a state. */
function fails(a: QuickAction): boolean {
  switch (a.kind) {
    case "error":
      return true;
    case "gold":
      return a.value > LIMITS.maxGold;
    case "hp":
      return a.value > LIMITS.maxHp;
    case "level":
      return a.value < LIMITS.minLevel || a.value > LIMITS.maxLevel;
    case "stage":
      return !STAGES.has(a.value);
    case "next":
      return false;
    case "add":
    case "remove":
      return a.stars !== null && (a.entry.type !== "unit" || a.kind === "remove");
  }
}

export function quickbarUpdate(text: string, lexicon: QuickLexicon, opts: { lenient: boolean }): StateUpdate {
  const line = text.trim().toLowerCase();
  if (line === "u" || line === "undo") return { undo: true };

  const b = new LabelBuilder();
  for (const a of parseQuick(text, lexicon)) {
    if (fails(a)) {
      if (opts.lenient) continue;
      return {};
    }
    switch (a.kind) {
      case "gold":
      case "level":
      case "hp":
        b.scalar(a.kind, a.value);
        break;
      case "stage":
        b.scalar("stage", a.value);
        break;
      case "next":
        b.scalar("next", true);
        break;
      case "add":
      case "remove": {
        const list = a.kind === "remove" ? "remove" : a.keepComponents ? "add" : "craft";
        b.mention(list, a.stars === null ? { name: a.typed } : { name: a.typed, stars: a.stars });
        break;
      }
      case "error":
        break; // handled by fails()
    }
  }
  return b.build();
}
