/**
 * Input categories for the eval breakdown. Every category comes from the gold label and the
 * text, so the synthetic and the real test set break down the same way. They overlap: one
 * example can be in several. Synthetic rows also get their generator's mode and scenario.
 */
import type { StateUpdate } from "../../../src/assistant/contract";
import { parseQuick, type QuickLexicon } from "../../../src/engine/quick";
import { QUESTION } from "../real-test";
import type { TestExample } from "./testsets";

const SCALARS = ["level", "next", "gold", "goldChange", "hp", "hpChange", "stage"] as const;
const LISTS = ["clear", "set", "remove", "add", "craft"] as const;
const MENTION_LISTS = ["set", "remove", "add", "craft"] as const;

/** Cue words, verbs and connectives never count as names in a quick-bar line (rule 22), even when one matches a name. */
const NOT_NAMES = new Set(
  [
    ...["level", "lvl", "lv", "gold", "hp", "health", "stage", "round", "star", "stars", "board", "team", "augment", "augments"],
    ...["and", "i'm", "im", "i", "am", "my", "no", "the", "a", "an", "with", "on", "at", "to", "of", "is", "now", "just"],
    ...["got", "hit", "took", "made", "built", "sold", "have", "holding", "bought", "lost", "rolled", "went", "slammed"],
    ...["crafted", "combined", "finished", "grabbed", "picked", "gained", "added", "removed", "used", "spent"],
  ].map((w) => w.toLowerCase()),
);
const QUICK_COMMAND = /^(?:g\d+|\d+g|l\d+|lv\d+|lvl\d+|h\d+|hp\d+|\d+hp|n|next|u|undo)$/i;
const ANY_COMMAND = /^(?:g?\d+g?|(?:l|lv|lvl)\d+|(?:h|hp)\d+|\d+hp|\d-\d|n|next|u|undo)$/i;

/**
 * Contract rule 22, approximately: every word is a quick-bar command or a name (the quick bar
 * reads it with no error, and no name it reads is a cue word or verb), and at least one word is quick-bar-only,
 * or the line is one bare number.
 */
export function isQuickBarLine(text: string, lexicon: QuickLexicon): boolean {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (words.length === 1 && /^(?:\d+|u|undo)$/i.test(words[0])) return true;
  const actions = parseQuick(text, lexicon);
  if (actions.some((a) => a.kind === "error")) return false;
  // A cue word the quick bar read as a name ("level" → Level Up!) makes it plain text.
  if (actions.some((a) => (a.kind === "add" || a.kind === "remove") && NOT_NAMES.has(a.typed.toLowerCase()))) return false;
  return words.some(
    (w) => QUICK_COMMAND.test(w) || /^[+-][^\d\s]/.test(w) || (/[a-z][123]$/i.test(w) && !ANY_COMMAND.test(w.replace(/^[+-]/, ""))),
  );
}

export function labelCategories(label: StateUpdate): string[] {
  const out: string[] = [];
  const has = (k: string) => (label as Record<string, unknown>)[k] !== undefined;
  const scalars = SCALARS.some(has);
  const lists = LISTS.some(has);
  if (!Object.keys(label).length) out.push("empty");
  else if (label.undo || label.newGame) out.push("command");
  else if (scalars && lists) out.push("scalars+lists");
  else if (scalars) out.push("scalars-only");
  else out.push("lists-only");
  if (label.next) out.push("next");
  if (label.clear) out.push("clear");
  if (has("goldChange") || has("hpChange")) out.push("change");
  const mentions = MENTION_LISTS.flatMap((l) => label[l] ?? []);
  if (mentions.some((m) => m.at)) out.push("at");
  if (mentions.some((m) => m.stars)) out.push("stars");
  if (mentions.some((m) => m.count)) out.push("count");
  return out;
}

export function categoriesOf(ex: TestExample, lexicon: QuickLexicon): string[] {
  const out = labelCategories(ex.label);
  out.push(isQuickBarLine(ex.text, lexicon) ? "quick-bar-line" : "plain-text");
  if (QUESTION.test(ex.text.toLowerCase())) out.push("question");
  if (ex.meta?.mode) out.push(`mode:${ex.meta.mode}`);
  if (ex.meta?.scenario) out.push(`scenario:${ex.meta.scenario}`);
  return out;
}
