import type { Aliases, EconomyModel } from "@/data/schema";
import type { Catalog } from "./catalog";
import { isCarousel, nextStage, roundIncome, stageIndex, stageLabels } from "./economy";
import type { AugmentId, ComponentBag, ItemId, UnitId } from "./types";

/**
 * The quick bar: one line of text updates the whole game state, so a player
 * alt-tabbing out of a game can type `n 38 h71 ie` instead of using five inputs.
 *
 * - `52`, `g52`, `52g`: gold. `l7`, `lv7`: level. `h64`, `hp64`: HP. `4-2`: stage.
 * - `n` / `next`: next round (stage +1, gold plus income, marked as an estimate).
 * - A name or alias adds a unit, component, item or augment; `-name` removes it.
 *   A crafted item uses up its two components when both are held; `+name` adds it without.
 * - `u` / `undo` on its own undoes the last change.
 */

/** The parts of the game state the quick bar reads and writes. */
export interface QuickState {
  components: ComponentBag;
  items: ItemId[];
  board: UnitId[];
  augments: AugmentId[];
  level: number;
  gold: number | null;
  /** Gold was projected by `next round` rather than typed, so it may be off. */
  goldEstimated: boolean;
  hp: number | null;
  stage: string | null;
}

export interface QuickContext {
  catalog: Catalog;
  lexicon: QuickLexicon;
  model: EconomyModel;
  /** The augment rounds in order, like ["2-1", "3-2", "4-2"]. */
  augmentRounds: string[];
}

/** One chip in the preview: what a word will do, or why it can't. */
export interface QuickStep {
  text: string;
  ok: boolean;
}

export interface QuickResult {
  state: QuickState;
  steps: QuickStep[];
  /** Every word was understood and can be applied. */
  ok: boolean;
  /** The line asks to undo the last change instead. */
  undo: boolean;
}

export const MIN_LEVEL = 2;
export const MAX_LEVEL = 10;
const MAX_GOLD = 200;
const MAX_HP = 100;
/** Longest name, in words, that the bar tries to match ("Tear Of The Goddess"). */
const MAX_WORDS = 4;
/** Shorter prefixes match too much to be useful. */
const MIN_PREFIX = 2;

type EntryType = "component" | "item" | "unit" | "augment";
interface Entry {
  type: EntryType;
  id: string;
  name: string;
  key: string;
}

/** Lowercase letters, digits and "+", so "Kha'Zix", "khazix" and "KHA ZIX" all match. */
export const normalize = (s: string) =>
  s
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9+]/g, "");

/** Every name the quick bar can match, with the hand-edited aliases. */
export class QuickLexicon {
  private readonly entries: Entry[];
  private readonly byKey = new Map<string, Entry[]>();
  private readonly aliases = new Map<string, Entry>();

  constructor(catalog: Catalog, aliases: Aliases) {
    const entry = (type: EntryType, id: string, name: string): Entry => ({ type, id, name, key: normalize(name) });
    const snapshot = catalog.snapshot;
    this.entries = [
      ...snapshot.components.map((c) => entry("component", c.id, c.name)),
      ...catalog.holdables.map((h) => entry("item", h.id, h.name)),
      ...snapshot.units.map((u) => entry("unit", u.id, u.name)),
      ...snapshot.augments.map((a) => entry("augment", a.id, a.name)),
    ];
    for (const e of this.entries) this.byKey.set(e.key, [...(this.byKey.get(e.key) ?? []), e]);
    const byId = new Map(this.entries.map((e) => [e.id, e]));
    for (const [alias, id] of Object.entries(aliases.aliases)) {
      const e = byId.get(id);
      if (e) this.aliases.set(alias, e);
    }
  }

  /** Alias or full-name matches for a normalized key. */
  exact(key: string): Entry[] {
    const alias = this.aliases.get(key);
    return alias ? [alias] : (this.byKey.get(key) ?? []);
  }

  /**
   * Names starting with `key`. When one match is the start of all the others
   * ("Heroic Grab Bag" and its "+" and "++" upgrades), that one wins.
   */
  prefix(key: string): Entry[] {
    if (key.length < MIN_PREFIX) return [];
    const found = this.entries.filter((e) => e.key.startsWith(key));
    const shortest = found.reduce<Entry | undefined>((a, e) => (!a || e.key.length < a.key.length ? e : a), undefined);
    if (shortest && found.every((e) => e.key.startsWith(shortest.key)) && this.byKey.get(shortest.key)!.length === 1) {
      return [shortest];
    }
    return found;
  }
}

type Action =
  | { kind: "gold" | "level" | "hp"; value: number }
  | { kind: "stage"; value: string }
  | { kind: "next" }
  | { kind: "add" | "remove"; entry: Entry; keepComponents: boolean }
  | { kind: "error"; text: string };

/** Reads one command word, or returns null if the word is not a command. */
function command(word: string): Action | null {
  let m: RegExpMatchArray | null;
  if ((m = word.match(/^g?(\d+)g?$/))) return { kind: "gold", value: Number(m[1]) };
  if ((m = word.match(/^(?:l|lv|lvl)(\d+)$/))) return { kind: "level", value: Number(m[1]) };
  if ((m = word.match(/^(?:h|hp)(\d+)$/) ?? word.match(/^(\d+)hp$/))) return { kind: "hp", value: Number(m[1]) };
  if (/^\d-\d$/.test(word)) return { kind: "stage", value: word };
  if (word === "n" || word === "next") return { kind: "next" };
  return null;
}

/** Splits a line into actions, matching the longest run of words that names something. */
function parse(input: string, lexicon: QuickLexicon): Action[] {
  const words = input.trim().split(/\s+/).filter(Boolean);
  const actions: Action[] = [];
  let i = 0;
  while (i < words.length) {
    const raw = words[i];
    const sign = raw.length > 1 && (raw[0] === "-" || raw[0] === "+") ? raw[0] : "";
    const first = raw.slice(sign.length);
    const cmd = sign ? null : command(first.toLowerCase());
    if (cmd) {
      actions.push(cmd);
      i++;
      continue;
    }

    const spans = Array.from({ length: Math.min(MAX_WORDS, words.length - i) }, (_, n) => n + 1).reverse();
    const keyOf = (n: number) => normalize([first, ...words.slice(i + 1, i + n)].join(""));
    const text = (n: number) => [first, ...words.slice(i + 1, i + n)].join(" ");
    const name = (e: Entry) => e.name;
    let matched = false;
    // A full name or alias over the most words wins; failing that, the longest prefix.
    for (const lookup of [(k: string) => lexicon.exact(k), (k: string) => lexicon.prefix(k)]) {
      for (const n of spans) {
        const found = lookup(keyOf(n));
        if (!found.length) continue;
        actions.push(
          found.length === 1
            ? { kind: sign === "-" ? "remove" : "add", entry: found[0], keepComponents: sign === "+" }
            : {
                kind: "error",
                text: `"${text(n)}" could be ${found.slice(0, 3).map(name).join(", ")}${found.length > 3 ? "…" : ""}`,
              },
        );
        i += n;
        matched = true;
        break;
      }
      if (matched) break;
    }
    if (!matched) {
      actions.push({ kind: "error", text: `Unknown "${raw}"` });
      i++;
    }
  }
  return actions;
}

/** The round after this one: stage +1, and gold plus a round's income, flagged as an estimate. */
export function advanceRound(state: QuickState, model: EconomyModel): QuickState {
  const stage = nextStage(state.stage, model);
  const paid = state.stage !== null && state.gold !== null && !isCarousel(stageIndex(stage, model), model);
  const gold = paid ? Math.min(MAX_GOLD, state.gold! + roundIncome(state.gold!, model)) : state.gold;
  return { ...state, stage, gold, goldEstimated: state.goldEstimated || paid };
}

/** Works out what `input` does to `state`, word by word, without changing anything. */
export function runQuick(input: string, state: QuickState, ctx: QuickContext): QuickResult {
  const line = input.trim().toLowerCase();
  if (line === "u" || line === "undo") return { state, steps: [{ text: "Undo", ok: true }], ok: true, undo: true };

  const { catalog, model } = ctx;
  const stages = new Set(stageLabels(model));
  const steps: QuickStep[] = [];
  const ok = (text: string) => steps.push({ text, ok: true });
  const fail = (text: string) => steps.push({ text, ok: false });
  let s: QuickState = { ...state };

  for (const a of parse(input, ctx.lexicon)) {
    switch (a.kind) {
      case "error":
        fail(a.text);
        break;
      case "gold":
        if (a.value > MAX_GOLD) fail(`Gold ${a.value} is more than ${MAX_GOLD}`);
        else {
          s = { ...s, gold: a.value, goldEstimated: false };
          ok(`Gold ${a.value}`);
        }
        break;
      case "hp":
        if (a.value > MAX_HP) fail(`HP ${a.value} is more than ${MAX_HP}`);
        else {
          s = { ...s, hp: a.value };
          ok(`HP ${a.value}`);
        }
        break;
      case "level": {
        if (a.value < MIN_LEVEL || a.value > MAX_LEVEL) {
          fail(`Level ${a.value} is not ${MIN_LEVEL}-${MAX_LEVEL}`);
          break;
        }
        const dropped = s.board.slice(a.value);
        s = { ...s, level: a.value, board: s.board.slice(0, a.value) };
        ok(`Level ${a.value}` + (dropped.length ? ` (drops ${dropped.map((u) => catalog.unit(u).name).join(", ")})` : ""));
        break;
      }
      case "stage":
        if (!stages.has(a.value)) fail(`No round ${a.value}`);
        else {
          s = { ...s, stage: a.value };
          ok(`Round ${a.value}`);
        }
        break;
      case "next":
        s = advanceRound(s, model);
        ok(`Next round: ${s.stage}` + (s.gold !== null ? `, ~${s.gold} gold` : ""));
        break;
      case "add":
      case "remove": {
        const step = change(s, a.kind, a.entry, a.keepComponents, ctx);
        if (typeof step === "string") fail(step);
        else {
          s = step.state;
          ok(step.text);
        }
        break;
      }
    }
  }
  return { state: s, steps, ok: steps.length > 0 && steps.every((x) => x.ok), undo: false };
}

/** Adds or removes one named thing; a string is the reason it can't. */
function change(
  s: QuickState,
  kind: "add" | "remove",
  e: Entry,
  keepComponents: boolean,
  ctx: QuickContext,
): { state: QuickState; text: string } | string {
  const { catalog } = ctx;
  const add = kind === "add";
  switch (e.type) {
    case "component": {
      const have = s.components[e.id] ?? 0;
      if (!add && !have) return `No ${e.name} to remove`;
      const components = { ...s.components, [e.id]: have + (add ? 1 : -1) };
      if (!components[e.id]) delete components[e.id];
      return { state: { ...s, components }, text: `${add ? "+" : "−"} ${e.name}` };
    }
    case "item": {
      if (!add) {
        const i = s.items.lastIndexOf(e.id);
        if (i < 0) return `No ${e.name} to remove`;
        return { state: { ...s, items: s.items.filter((_, j) => j !== i) }, text: `− ${e.name}` };
      }
      const recipe = catalog.hasItem(e.id) ? catalog.item(e.id).components : null;
      const left = { ...s.components };
      for (const c of recipe ?? []) left[c] = (left[c] ?? 0) - 1;
      const crafts = !keepComponents && !!recipe && recipe.every((c) => left[c] >= 0);
      if (!crafts) return { state: { ...s, items: [...s.items, e.id] }, text: `+ ${e.name}` };
      for (const c of recipe) if (!left[c]) delete left[c];
      return {
        state: { ...s, components: left, items: [...s.items, e.id] },
        text: `+ ${e.name} (uses ${recipe.map((c) => catalog.componentName(c)).join(" + ")})`,
      };
    }
    case "unit": {
      if (!add) {
        if (!s.board.includes(e.id)) return `${e.name} is not on your board`;
        return { state: { ...s, board: s.board.filter((u) => u !== e.id) }, text: `− ${e.name}` };
      }
      if (s.board.includes(e.id)) return `${e.name} is already on your board`;
      if (s.board.length >= s.level) return `Board is full at level ${s.level}`;
      return { state: { ...s, board: [...s.board, e.id] }, text: `+ ${e.name}` };
    }
    case "augment": {
      const at = s.augments.indexOf(e.id);
      if (!add) {
        if (at < 0) return `${e.name} is not one of your augments`;
        // Later picks depended on this one, as in the augment panel.
        return { state: { ...s, augments: s.augments.slice(0, at) }, text: `− ${e.name}` };
      }
      if (at >= 0) return `${e.name} is already taken`;
      if (s.augments.length >= ctx.augmentRounds.length) return `All ${ctx.augmentRounds.length} augments are picked`;
      return {
        state: { ...s, augments: [...s.augments, e.id] },
        text: `+ ${e.name} (${ctx.augmentRounds[s.augments.length]} augment)`,
      };
    }
  }
}
