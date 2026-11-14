/**
 * Turns a sampled game state into one player message and its label. Every piece
 * of text is rendered together with what it contributes to the label, so the
 * label can only contain what the text says.
 */
import { catalog } from "../../src/data";
import type { Mention, StateUpdate } from "../../src/assistant/contract";
import { LabelBuilder, type Category, type ListKey } from "./labels";
import type { Rng } from "./rng";
import type { GameSample } from "./sample";
import * as T from "./templates";
import { inPool, type Pool, type Template } from "./templates";
import { pluralize, type Entity, type Selection, type Surface, type Vocab } from "./vocab";

export type Mode = "plain" | "quick" | "undo";

export interface Example {
  text: string;
  label: StateUpdate;
  meta: { mode: Mode; scenario: string; templates: string[]; typos: number };
}

/** A clause of a plain message. */
export interface Piece {
  text: string;
  /** Has a plain-language word (rule 22). */
  word: boolean;
  /** Must open the message: a stage joined by "on"/"at" (rule 19). */
  first: boolean;
  /**
   * A list with no frame ("bow, sword"). It goes before any verb, so "got X, bow" can't read as
   * having got the bow too.
   */
  bare?: boolean;
  /** Goes at the end: a question or aside. */
  last?: boolean;
  templates: string[];
  typos: number;
  apply: (b: LabelBuilder) => void;
}

interface Ctx {
  rng: Rng;
  pool: Pool;
  v: Vocab;
  /** Entity ids already named in this message, so none is named twice. */
  used: Set<string>;
}

const TYPO_RATE = { plain: 0.04, quick: 0.03 };

const pickT = <F>(c: Ctx, ts: readonly Template<F>[]) =>
  c.rng.weighted(inPool(ts, c.pool).map((x) => [x, x.w ?? 1] as const));

/** One plausible slip on a name: a dropped, swapped or doubled letter (never the first). */
export function typo(rng: Rng, text: string): string {
  const letters = [...text].map((ch, i) => (/[a-z]/i.test(ch) ? i : -1)).filter((i) => i > 0);
  if (letters.length < 4) return text;
  const i = rng.pick(letters);
  const op = rng.pick(["drop", "swap", "double"] as const);
  const drop = text.slice(0, i) + text.slice(i + 1);
  if (op === "double") return text.slice(0, i) + text[i] + text.slice(i);
  if (op === "swap" && /[a-z]/i.test(text[i + 1] ?? "") && text[i] !== text[i + 1]) {
    return text.slice(0, i) + text[i + 1] + text[i] + text.slice(i + 2);
  }
  return drop;
}

/** A quick-bar-only token in plain text ("32g", "h40") turns it into a quick-bar line unless a word is present. */
export const hasQuickOnlyToken = (text: string) =>
  text.split(/[\s,;.&/]+/).some((w) => /^(?:g\d+|\d+g|(?:l|lv|lvl)\d+|(?:h|hp)\d+|\d+hp)$/i.test(w));

interface Name {
  one: string;
  many: string | null;
  typo: boolean;
}

function chooseName(c: Ctx, e: Entity, opts: { plural?: boolean; quick?: boolean } = {}): Name {
  let surfaces = e.surfaces.filter((s) => !opts.quick || s.quickSafe);
  if (!surfaces.length) throw new Error(`No quick-safe name for ${e.id}`);
  if (opts.plural && surfaces.some((s) => s.plural)) surfaces = surfaces.filter((s) => s.plural);
  const weight = (s: Surface) => (s.source === "alias" ? 4 : s.source === "prefix" ? 1.2 : s.text === e.name ? 1.5 : 3);
  const s = c.rng.weighted(surfaces.map((x) => [x, weight(x)] as const));
  if (!c.rng.chance(opts.quick ? TYPO_RATE.quick : TYPO_RATE.plain)) return { one: s.text, many: s.plural, typo: false };
  const one = typo(c.rng, s.text);
  return { one, many: s.plural ? pluralize(one) : null, typo: one !== s.text };
}

/** A name with its count or star level, rendered. */
interface Rendered {
  text: string;
  mention: Mention;
  /** Starts with a number or "x2": can't follow a name after a bare space. */
  tight: boolean;
  /** Ends with a number or star marker: can't be followed by a name after a bare space. */
  endsNumber: boolean;
  word: boolean;
  templates: string[];
  typos: number;
}

function renderMention(c: Ctx, e: Entity, opts: { count?: number; stars?: number } = {}): Rendered {
  c.used.add(e.id);
  const stars = e.kind === "unit" ? (opts.stars ?? 1) : 1;
  const count = opts.count ?? 1;
  const name = chooseName(c, e, { plural: count > 1 });
  const base = { typos: name.typo ? 1 : 0 };
  if (stars > 1) {
    const tpl = pickT(c, T.STARS);
    const text = tpl.f(name.one, stars);
    return {
      ...base,
      text,
      mention: { name: name.one, stars: stars as 2 | 3 },
      tight: T.STARS_START_TIGHT.has(tpl.id),
      endsNumber: /[\d*]$|star$/.test(text),
      word: tpl.word,
      templates: [tpl.id],
    };
  }
  if (count > 1) {
    const options = inPool(T.COUNT, c.pool)
      .map((tpl) => ({ tpl, out: tpl.f(name.one, name.many, count) }))
      .filter((o) => o.out !== null);
    const { tpl, out } = c.rng.pick(options);
    return {
      ...base,
      text: out!.text,
      mention: { name: out!.name, count },
      tight: T.COUNT_STARTS_TIGHT.has(tpl.id),
      endsNumber: /\d$/.test(out!.text),
      word: tpl.word,
      templates: [tpl.id],
    };
  }
  return { ...base, text: name.one, mention: { name: name.one }, tight: false, endsNumber: false, word: false, templates: [] };
}

/** Names joined into one list; a bare space never separates a name from a number. */
function joinList(c: Ctx, items: Rendered[]): { text: string; word: boolean; templates: string[] } {
  const oneWords = items.every((r) => !r.mention.name.includes(" "));
  const join = pickT(c, T.LIST_JOIN.filter((j) => j.f !== " " || oneWords));
  let text = items[0].text;
  for (let i = 1; i < items.length; i++) {
    const sep = join.f === " " && (items[i].tight || items[i - 1].endsNumber) ? ", " : join.f;
    text += sep + items[i].text;
  }
  return {
    text,
    word: (items.length > 1 && join.word) || items.some((r) => r.word),
    templates: [...(items.length > 1 ? [join.id] : []), ...items.flatMap((r) => r.templates)],
  };
}

function listPiece(c: Ctx, frame: Template<(l: string) => string>, list: ListKey, items: Rendered[], clear?: Category): Piece {
  const joined = joinList(c, items);
  return {
    text: frame.f(joined.text),
    word: frame.word || joined.word,
    first: false,
    bare: frame.id === "set.bare",
    templates: [frame.id, ...joined.templates],
    typos: items.reduce((n, r) => n + r.typos, 0),
    apply: (b) => {
      if (clear) b.clear(clear);
      for (const r of items) b.mention(list, r.mention);
    },
  };
}

function simplePiece(text: string, word: boolean, templates: string[], apply: Piece["apply"], first = false): Piece {
  return { text, word, first, templates, typos: 0, apply };
}

// ---- Scalars ----

const clampLevel = (n: number) => Math.min(10, Math.max(2, n));

function levelPiece(c: Ctx, level: number): Piece {
  const tpl = pickT(c, T.LEVEL);
  if (c.rng.chance(0.05)) {
    const wrong = clampLevel(level + c.rng.pick([-1, 1]));
    if (wrong !== level) {
      const fix = pickT(c, T.CORRECTION);
      return simplePiece(fix.f(tpl.f(wrong), level), true, [tpl.id, fix.id], (b) => b.scalar("level", level));
    }
  }
  return simplePiece(tpl.f(level), tpl.word, [tpl.id], (b) => b.scalar("level", level));
}

function goldPiece(c: Ctx, gold: number): Piece {
  const tpl = pickT(c, T.GOLD);
  if (c.rng.chance(0.05)) {
    const wrong = Math.max(0, gold + c.rng.pick([-4, -2, 2, 4, 10]));
    const fix = pickT(c, T.CORRECTION);
    return simplePiece(fix.f(tpl.f(wrong), gold), true, [tpl.id, fix.id], (b) => b.scalar("gold", gold));
  }
  return simplePiece(tpl.f(gold), tpl.word, [tpl.id], (b) => b.scalar("gold", gold));
}

function hpPiece(c: Ctx, hp: number): Piece {
  const tpl = pickT(c, T.HP);
  return simplePiece(tpl.f(hp), tpl.word, [tpl.id], (b) => b.scalar("hp", hp));
}

function stagePiece(c: Ctx, stage: string): Piece {
  const tpl = pickT(c, T.STAGE);
  return simplePiece(tpl.f.render(stage), tpl.word, [tpl.id], (b) => b.scalar("stage", stage), tpl.f.link);
}

function scalarPieces(c: Ctx, st: GameSample, p: number): Piece[] {
  const out: Piece[] = [];
  if (c.rng.chance(p)) out.push(levelPiece(c, st.level));
  if (c.rng.chance(p)) out.push(goldPiece(c, st.gold));
  if (c.rng.chance(p * 0.6)) out.push(hpPiece(c, st.hp));
  if (c.rng.chance(p * 0.6)) out.push(stagePiece(c, st.stage));
  return out;
}

// ---- What the player holds ----

/** Entities with how many copies, in first-seen order. */
function counted(es: Entity[]): [Entity, number][] {
  const m = new Map<Entity, number>();
  for (const e of es) m.set(e, (m.get(e) ?? 0) + 1);
  return [...m];
}

const fresh = (c: Ctx, es: Entity[]) => es.filter((e) => !c.used.has(e.id));

function randomOf(c: Ctx, es: Entity[]): Entity {
  const left = fresh(c, es);
  return c.rng.pick(left.length ? left : es);
}

function heldPiece(c: Ctx, st: GameSample, kinds: { components: boolean; items: boolean }): Piece | null {
  const parts: [Entity, number][] = [];
  if (kinds.components) {
    const comps = counted(st.components).filter(([e]) => !c.used.has(e.id));
    const pool = comps.length ? comps : [[randomOf(c, c.v.byKind.component), c.rng.int(1, 2)] as [Entity, number]];
    parts.push(...c.rng.sample(pool, c.rng.int(1, Math.min(4, pool.length))));
  }
  if (kinds.items) {
    const items = counted(st.items).filter(([e]) => !c.used.has(e.id));
    const pool = items.length ? items : [[randomOf(c, completedItems(c.v)), 1] as [Entity, number]];
    parts.push(...c.rng.sample(pool, c.rng.int(1, Math.min(3, pool.length))));
  }
  if (!parts.length) return null;
  const ordered = c.rng.chance(0.3) ? c.rng.shuffle(parts) : parts;
  const items = ordered.map(([e, n]) => renderMention(c, e, { count: n }));
  return listPiece(c, pickT(c, T.SET_FRAME), "set", items);
}

const completedItems = (v: Vocab) => v.byKind.item.filter((e) => e.sub === "item");

function boardUnits(c: Ctx, st: GameSample, min: number, max: number) {
  const left = st.board.filter((b) => !c.used.has(b.unit.id));
  return c.rng.sample(left, c.rng.int(Math.min(min, left.length), Math.min(max, left.length)));
}

/** Units without a frame: added or upgraded, the rest of the board stays (A4, A17). */
function bareUnitsPiece(c: Ctx, st: GameSample): Piece | null {
  const units = boardUnits(c, st, 1, 3);
  if (!units.length) return null;
  const set = inPool(T.SET_FRAME, c.pool).find((t) => t.id === "set.bare")!;
  return listPiece(c, set, "set", units.map((u) => renderMention(c, u.unit, { stars: u.stars })));
}

function boardPiece(c: Ctx, st: GameSample): Piece | null {
  const units = boardUnits(c, st, 3, 9);
  if (units.length < 2) return null;
  const items = units.map((u) => renderMention(c, u.unit, { stars: u.stars }));
  return listPiece(c, pickT(c, T.BOARD_FRAME), "set", items, "board");
}

// ---- Events ----

function addPiece(c: Ctx, kind: "component" | "item"): Piece {
  const e = randomOf(c, kind === "component" ? c.v.byKind.component : c.v.byKind.item);
  const count = kind === "component" && c.rng.chance(0.2) ? 2 : 1;
  return listPiece(c, pickT(c, T.ADD), "add", [renderMention(c, e, { count })]);
}

function craftPiece(c: Ctx, st: GameSample): Piece {
  const held = fresh(c, st.items).filter((e) => e.sub === "item");
  const e = held.length ? c.rng.pick(held) : randomOf(c, completedItems(c.v));
  const item = renderMention(c, e);
  const recipe = catalog.hasItem(e.id) ? catalog.item(e.id).components : null;
  // The recipe is said but not labeled (rule 10); its names are typed like any other.
  const parts = recipe
    ? (recipe.map((id) => chooseName(c, c.v.byId.get(id)!).one) as [string, string])
    : null;
  const options = inPool(T.CRAFT, c.pool)
    .map((tpl) => ({ tpl, text: tpl.f(item.text, parts) }))
    .filter((o) => o.text !== null);
  const { tpl, text } = c.rng.pick(options);
  return {
    text: text!,
    word: true,
    first: false,
    templates: [tpl.id],
    typos: item.typos,
    apply: (b) => b.mention("craft", item.mention),
  };
}

function addUnitPiece(c: Ctx, st: GameSample): Piece {
  const u = c.rng.chance(0.6) && st.board.length ? c.rng.pick(st.board) : { unit: randomOf(c, c.v.byKind.unit), stars: 1 as const };
  if (c.used.has(u.unit.id)) return addPiece(c, "component");
  if (u.stars > 1 && c.rng.chance(0.5) && inPool(T.STARRED, c.pool).length) {
    const tpl = pickT(c, T.STARRED);
    const name = chooseName(c, u.unit);
    c.used.add(u.unit.id);
    return {
      text: tpl.f(name.one, u.stars),
      word: true,
      first: false,
      templates: [tpl.id],
      typos: name.typo ? 1 : 0,
      apply: (b) => b.mention("add", { name: name.one, stars: u.stars as 2 | 3 }),
    };
  }
  return listPiece(c, pickT(c, T.ADD_UNIT), "add", [renderMention(c, u.unit, { stars: u.stars })]);
}

function removePiece(c: Ctx, st: GameSample): Piece {
  if (c.rng.chance(0.55)) {
    const units = st.board.filter((b) => !c.used.has(b.unit.id));
    const u = units.length ? c.rng.pick(units).unit : randomOf(c, c.v.byKind.unit);
    return listPiece(c, pickT(c, T.REMOVE_UNIT), "remove", [renderMention(c, u)]);
  }
  const e = randomOf(c, c.rng.chance(0.7) ? c.v.byKind.component : completedItems(c.v));
  return listPiece(c, pickT(c, T.REMOVE), "remove", [renderMention(c, e)]);
}

function augmentPiece(c: Ctx, st: GameSample, withAt: boolean): Piece {
  const taken = st.augments.filter((a) => !c.used.has(a.augment.id));
  const pick = taken.length
    ? c.rng.pick(taken)
    : (() => {
        const augment = randomOf(c, c.v.byKind.augment);
        return { augment, at: augment.selections![0] as Selection };
      })();
  const m = renderMention(c, pick.augment);
  if (!withAt) return listPiece(c, pickT(c, T.AUGMENT_ADD), "add", [m]);
  const tpl = pickT(c, T.AUGMENT_AT);
  return {
    text: tpl.f.render(m.text, pick.at),
    word: true,
    first: false,
    templates: [tpl.id],
    typos: m.typos,
    apply: (b) => b.mention(tpl.f.list, { ...m.mention, at: pick.at }),
  };
}

function eventPiece(c: Ctx, st: GameSample): Piece {
  const event = c.rng.weighted([
    ["component", 22],
    ["item", 10],
    ["craft", 18],
    ["unit", 18],
    ["remove", 14],
    ["augment", 10],
    ["augment-at", 8],
  ] as const);
  switch (event) {
    case "component":
    case "item":
      return addPiece(c, event);
    case "craft":
      return craftPiece(c, st);
    case "unit":
      return addUnitPiece(c, st);
    case "remove":
      return removePiece(c, st);
    case "augment":
      return augmentPiece(c, st, false);
    case "augment-at":
      return augmentPiece(c, st, true);
  }
}

/** Asides that talk about a field, so they're left out of a message that states it ("hp 38, lost 12 hp"). */
const DISTRACTOR_FIELD: Record<string, "level" | "gold" | "hp"> = {
  "x.going": "level",
  "x.fast9": "level",
  "x.should-level": "level",
  "x.relative-gold": "gold",
  "x.lost-hp": "hp",
};

function distractorPiece(c: Ctx, said: Set<string> = new Set()): Piece {
  const tpl = pickT(
    c,
    T.DISTRACTOR.filter((t) => !said.has(DISTRACTOR_FIELD[t.id])),
  );
  const unit = randomOf(c, c.v.byKind.unit);
  const component = randomOf(c, c.v.byKind.component);
  const item = randomOf(c, completedItems(c.v));
  for (const e of [unit, component, item]) c.used.add(e.id);
  const text = tpl.f({
    unit: chooseName(c, unit).one,
    component: chooseName(c, component).one,
    item: chooseName(c, item).one,
  });
  return { ...simplePiece(text, true, [tpl.id], () => {}), last: true };
}

// ---- Messages ----

/** Joins clauses, adds glue, and builds the label in the order things were said. */
export function assemble(c: Ctx, pieces: Piece[]): { text: string; label: StateUpdate; templates: string[]; typos: number } {
  const ordered = [
    ...pieces.filter((p) => p.first),
    ...c.rng.shuffle(pieces.filter((p) => p.bare)),
    ...c.rng.shuffle(pieces.filter((p) => !p.first && !p.bare && !p.last)),
    ...pieces.filter((p) => p.last),
  ];
  const joins = ordered.slice(1).map(() => pickT(c, T.CLAUSE_JOIN));
  for (let i = 1; i < joins.length; i++) if (c.rng.chance(0.75)) joins[i] = joins[0];
  // "on 3-2 and bow" reads oddly; a frameless list follows punctuation.
  const plainJoins = inPool(T.CLAUSE_JOIN, c.pool).filter((j) => !j.word);
  for (let i = 0; i < joins.length; i++) if (ordered[i + 1].bare && joins[i].word) joins[i] = c.rng.pick(plainJoins);
  let opener = c.rng.chance(0.15) ? pickT(c, T.OPENER) : null;
  const closer = c.rng.chance(0.1) ? pickT(c, T.CLOSER) : null;

  const body = () => ordered.map((p, i) => (i ? joins[i - 1].f : "") + p.text).join("");
  // A quick-bar-only token needs a plain word somewhere, or the message is a quick-bar line (rule 22).
  const hasWord = () => ordered.some((p) => p.word) || joins.some((j) => j.word) || !!opener || !!closer;
  if (hasQuickOnlyToken(body()) && !hasWord()) {
    const at = joins.findIndex((_, i) => !ordered[i + 1].bare);
    if (at >= 0) joins[at] = inPool(T.CLAUSE_JOIN, c.pool).find((j) => j.word)!;
    else opener = pickT(c, T.OPENER);
  }

  const text = `${opener?.f ?? ""}${body()}${closer?.f ?? ""}`.replace(/\s+/g, " ").trim();
  const b = new LabelBuilder();
  for (const p of ordered) p.apply(b);
  const glue = [opener?.id, closer?.id, ...joins.map((j) => j.id)].filter((x): x is string => !!x);
  return {
    text,
    label: b.build(),
    templates: [...ordered.flatMap((p) => p.templates), ...glue],
    typos: ordered.reduce((n, p) => n + p.typos, 0),
  };
}

type Scenario = "snapshot" | "events" | "mixed" | "board" | "augments" | "clear" | "next" | "distractor";

function plainPieces(c: Ctx, st: GameSample, scenario: Scenario): Piece[] {
  const pieces: Piece[] = [];
  const add = (p: Piece | null) => p && pieces.push(p);
  switch (scenario) {
    case "snapshot":
      pieces.push(...scalarPieces(c, st, 0.6));
      if (c.rng.chance(0.8)) add(heldPiece(c, st, { components: c.rng.chance(0.85), items: c.rng.chance(0.4) }));
      if (c.rng.chance(0.12)) add(bareUnitsPiece(c, st));
      if (c.rng.chance(0.08) && st.augments.length) add(augmentPiece(c, st, false));
      break;
    case "events":
      pieces.push(...scalarPieces(c, st, 0.25));
      for (let i = c.rng.int(1, 3); i > 0; i--) add(eventPiece(c, st));
      break;
    case "mixed":
      pieces.push(...scalarPieces(c, st, 0.45));
      add(heldPiece(c, st, { components: true, items: c.rng.chance(0.3) }));
      for (let i = c.rng.int(1, 2); i > 0; i--) add(eventPiece(c, st));
      break;
    case "board":
      pieces.push(...scalarPieces(c, st, 0.35));
      add(boardPiece(c, st));
      break;
    case "augments": {
      pieces.push(...scalarPieces(c, st, 0.35));
      const all = inPool(T.AUGMENTS_FRAME, c.pool);
      if (all.length && st.augments.length > 1 && c.rng.chance(0.3)) {
        const items = st.augments.map((a) => renderMention(c, a.augment));
        add(listPiece(c, c.rng.pick(all), "set", items, "augments"));
      } else {
        for (let i = Math.max(1, c.rng.int(1, st.augments.length)); i > 0; i--) add(augmentPiece(c, st, true));
      }
      break;
    }
    case "clear": {
      const tpl = pickT(c, T.CLEAR);
      add(simplePiece(tpl.f.render(), true, [tpl.id], (b) => b.clear(tpl.f.category)));
      pieces.push(...scalarPieces(c, st, 0.4));
      // Something held in a different category: "no items, 2 bows".
      if (tpl.f.category === "components" && c.rng.chance(0.4)) add(heldPiece(c, st, { components: false, items: true }));
      if (tpl.f.category === "items" && c.rng.chance(0.4)) add(heldPiece(c, st, { components: true, items: false }));
      break;
    }
    case "next": {
      const tpl = pickT(c, T.NEXT);
      add(simplePiece(tpl.f(), true, [tpl.id], (b) => b.scalar("next", true)));
      if (c.rng.chance(0.5)) add(goldPiece(c, st.gold));
      if (c.rng.chance(0.3)) add(hpPiece(c, st.hp));
      break;
    }
    case "distractor":
      add(distractorPiece(c));
      return pieces;
  }
  if (!pieces.length) add(levelPiece(c, st.level));
  if (c.rng.chance(0.06)) {
    const b = new LabelBuilder();
    for (const p of pieces) p.apply(b);
    add(distractorPiece(c, new Set(Object.keys(b.build()))));
  }
  return pieces;
}

// ---- Quick-bar lines ----

interface Token {
  text: string;
  /** A quick-bar-only token (rule 22). */
  quickOnly: boolean;
  template: string;
  typo: boolean;
  apply: (b: LabelBuilder) => void;
}

function quickName(c: Ctx, st: GameSample): Token[] {
  const kind = c.rng.weighted([
    ["component", 40],
    ["item", 30],
    ["unit", 22],
    ["augment", 8],
  ] as const);
  const es = kind === "unit" ? c.v.byKind.unit : kind === "item" ? completedItems(c.v) : c.v.byKind[kind];
  const e = randomOf(
    c,
    es.filter((x) => x.surfaces.some((s) => s.quickSafe)),
  );
  c.used.add(e.id);
  const name = chooseName(c, e, { quick: true });
  const op = c.rng.weighted([
    ["plain", 65],
    ["add", 15],
    ["remove", 15],
    ["repeat", kind === "component" ? 8 : 0],
  ] as const);
  const typoed = name.typo;
  if (op === "repeat") {
    return [
      { text: name.one, quickOnly: false, template: "q.name", typo: typoed, apply: (b) => b.mention("craft", { name: name.one }) },
      { text: name.one, quickOnly: false, template: "q.name", typo: false, apply: (b) => b.mention("craft", { name: name.one }) },
    ];
  }
  if (op === "add") {
    return [{ text: `+${name.one}`, quickOnly: true, template: "q.add", typo: typoed, apply: (b) => b.mention("add", { name: name.one }) }];
  }
  if (op === "remove") {
    return [{ text: `-${name.one}`, quickOnly: true, template: "q.remove", typo: typoed, apply: (b) => b.mention("remove", { name: name.one }) }];
  }
  const stars = kind === "unit" ? (st.board.find((u) => u.unit === e)?.stars ?? (c.rng.chance(0.3) ? 2 : 1)) : 1;
  if (stars > 1) {
    return [
      {
        text: `${name.one}${stars}`,
        quickOnly: true,
        template: "q.stars",
        typo: typoed,
        apply: (b) => b.mention("craft", { name: name.one, stars: stars as 2 | 3 }),
      },
    ];
  }
  return [{ text: name.one, quickOnly: false, template: "q.name", typo: typoed, apply: (b) => b.mention("craft", { name: name.one }) }];
}

function quickLine(c: Ctx, st: GameSample): Example {
  const tokens: Token[] = [];
  const scalar = (tpl: Template<(n: number) => string>, key: "level" | "gold" | "hp", n: number) =>
    tokens.push({ text: tpl.f(n), quickOnly: tpl.id !== "q.gold.bare", template: tpl.id, typo: false, apply: (b) => b.scalar(key, n) });
  if (c.rng.chance(0.4)) scalar(pickT(c, T.Q_LEVEL), "level", st.level);
  if (c.rng.chance(0.55)) {
    // 1-3 right after a name would read as stars (rule 23), so small gold always has its cue.
    const forms = inPool(T.Q_GOLD, c.pool).filter((t) => st.gold > 3 || t.id !== "q.gold.bare");
    scalar(c.rng.pick(forms), "gold", st.gold);
  }
  if (c.rng.chance(0.2)) scalar(pickT(c, T.Q_HP), "hp", st.hp);
  if (c.rng.chance(0.2)) tokens.push({ text: st.stage, quickOnly: false, template: "q.stage", typo: false, apply: (b) => b.scalar("stage", st.stage) });
  if (c.rng.chance(0.15)) {
    const tpl = pickT(c, T.Q_NEXT);
    tokens.push({ text: tpl.f, quickOnly: true, template: tpl.id, typo: false, apply: (b) => b.scalar("next", true) });
  }
  const names = c.rng.weighted([
    [0, 15],
    [1, 35],
    [2, 30],
    [3, 15],
    [4, 5],
  ] as const);
  for (let i = 0; i < names; i++) tokens.push(...quickName(c, st));

  const single = tokens.length === 1 && tokens[0].template === "q.gold.bare";
  if (!tokens.length || (!single && !tokens.some((t) => t.quickOnly))) scalar(pickT(c, T.Q_LEVEL), "level", st.level);

  // Repeated names stay next to each other ("bow bow").
  const groups: Token[][] = [];
  for (const t of tokens) {
    const last = groups.at(-1);
    if (last && t.template === "q.name" && last[0].text === t.text) last.push(t);
    else groups.push([t]);
  }
  const ordered = c.rng.shuffle(groups).flat();
  const b = new LabelBuilder();
  for (const t of ordered) t.apply(b);
  return {
    text: ordered.map((t) => t.text).join(" "),
    label: b.build(),
    meta: { mode: "quick", scenario: "quick", templates: ordered.map((t) => t.template), typos: ordered.filter((t) => t.typo).length },
  };
}

/** One generated example for a split, from a sampled game state. */
export function makeExample(rng: Rng, pool: Pool, v: Vocab, st: GameSample): Example {
  const c: Ctx = { rng, pool, v, used: new Set() };
  const mode = rng.weighted([
    ["plain", 82],
    ["quick", 17],
    ["undo", 1],
  ] as const);
  if (mode === "undo") {
    const tpl = pickT(c, T.Q_UNDO);
    return { text: tpl.f, label: { undo: true }, meta: { mode, scenario: "undo", templates: [tpl.id], typos: 0 } };
  }
  if (mode === "quick") return quickLine(c, st);
  const scenario = rng.weighted([
    ["snapshot", 34],
    ["events", 26],
    ["mixed", 14],
    ["board", 6],
    ["augments", 7],
    ["clear", 4],
    ["next", 5],
    ["distractor", 4],
  ] as const);
  const out = assemble(c, plainPieces(c, st, scenario));
  return { text: out.text, label: out.label, meta: { mode, scenario, templates: out.templates, typos: out.typos } };
}
