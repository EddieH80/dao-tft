/**
 * Phrasings, split into a training pool and a test pool that share no template,
 * so the test set measures whether the model generalizes to phrasing it never saw.
 * A few forms have only one way to be written (a bare list of names, a quick-bar
 * stage or sign); those are marked "both" and listed in SHARED_TEMPLATES.
 *
 * Every phrasing follows the labeling rules in docs/ml-state-contract.md section 5.
 */

export type Pool = "train" | "test";

export interface Template<F> {
  id: string;
  pool: Pool | "both";
  /**
   * Has a word that is neither a quick-bar command nor a name ("gold", "got", "and"), so a
   * message containing it is plain language, not a quick-bar line (rule 22).
   */
  word: boolean;
  f: F;
  /** Relative odds of being picked (default 1). */
  w?: number;
}

const t = <F>(id: string, pool: Template<F>["pool"], word: boolean, f: F, w?: number): Template<F> => ({
  id,
  pool,
  word,
  f,
  w,
});

export const inPool = <F>(ts: readonly Template<F>[], pool: Pool) => ts.filter((x) => x.pool === pool || x.pool === "both");

/** Template ids that may appear in both splits, because the form has no other spelling. */
export const SHARED_TEMPLATES = ["set.bare", "q.gold.bare", "q.stage", "q.name", "q.add", "q.remove", "q.stars"];

const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"];

// ---- Scalars (rules 15-18, 20) ----

type Num = (n: number) => string;

export const LEVEL: Template<Num>[] = [
  t("level.word", "train", true, (n) => `level ${n}`),
  t("level.lvl", "train", true, (n) => `lvl ${n}`),
  t("level.im", "train", true, (n) => `I'm ${n}`),
  t("level.hit", "train", true, (n) => `hit ${n}`),
  t("level.lv", "test", true, (n) => `lv ${n}`),
  t("level.iam", "test", true, (n) => `I am ${n}`),
  t("level.went", "test", true, (n) => `went ${n}`),
  t("level.now", "test", true, (n) => `${n} now`),
];

export const GOLD: Template<Num>[] = [
  t("gold.suffix-word", "train", true, (n) => `${n} gold`),
  t("gold.suffix-g", "train", false, (n) => `${n}g`),
  t("gold.prefix-word", "train", true, (n) => `gold ${n}`),
  t("gold.dollar", "test", true, (n) => `$${n}`),
  t("gold.prefix-g", "test", false, (n) => `g${n}`),
  t("gold.colon", "test", true, (n) => `gold: ${n}`),
];

export const HP: Template<Num>[] = [
  t("hp.suffix", "train", true, (n) => `${n} hp`),
  t("hp.prefix", "train", true, (n) => `hp ${n}`),
  t("hp.health", "test", true, (n) => `${n} health`),
  t("hp.h", "test", false, (n) => `h${n}`),
  t("hp.colon", "test", true, (n) => `hp: ${n}`),
];

/** `link`: the stage is joined by "on"/"at", so it goes first in the message (rule 19). */
type StageF = { render: (stage: string) => string; link: boolean };
export const STAGE: Template<StageF>[] = [
  t("stage.bare", "train", false, { render: (s) => s, link: false }),
  t("stage.on", "train", true, { render: (s) => `on ${s}`, link: true }),
  t("stage.word", "train", true, { render: (s) => `stage ${s}`, link: false }),
  t("stage.its", "test", true, { render: (s) => `it's ${s}`, link: false }),
  t("stage.at", "test", true, { render: (s) => `at ${s}`, link: true }),
  t("stage.round", "test", true, { render: (s) => `stage ${s.split("-")[0]} round ${s.split("-")[1]}`, link: false }),
];

/** A value said twice; the label keeps the second (rule 20). `cue` renders the first value. */
type CorrectionF = (first: string, second: number) => string;
export const CORRECTION: Template<CorrectionF>[] = [
  t("fix.actually", "train", true, (first, b) => `${first}, actually ${b}`),
  t("fix.nowait", "test", true, (first, b) => `${first} no wait ${b}`),
];

// ---- Numbers on names (rules 6-8) ----

/** Renders a count; returns the text and the name as it appears (the label's `name`). */
type CountF = (one: string, many: string | null, n: number) => { text: string; name: string } | null;
export const COUNT: Template<CountF>[] = [
  t("count.digit", "train", false, (one, many, n) => ({ text: `${n} ${many ?? one}`, name: many ?? one })),
  t("count.word", "train", true, (one, many, n) =>
    NUMBER_WORDS[n] ? { text: `${NUMBER_WORDS[n]} ${many ?? one}`, name: many ?? one } : null,
  ),
  t("count.x-after", "train", false, (one, _, n) => ({ text: `${one} x${n}`, name: one })),
  t("count.repeat", "train", false, (one, _, n) => (n === 2 && !one.includes(" ") ? { text: `${one} ${one}`, name: one } : null)),
  t("count.nx-before", "test", false, (one, _, n) => ({ text: `${n}x ${one}`, name: one })),
  t("count.xn-before", "test", false, (one, _, n) => ({ text: `x${n} ${one}`, name: one })),
  t("count.pair", "test", true, (_, many, n) => (n === 2 && many ? { text: `pair of ${many}`, name: many } : null)),
  t("count.couple", "test", true, (_, many, n) => (n === 2 && many ? { text: `a couple ${many}`, name: many } : null)),
];
/** Count templates that start with a number or x, so they can't follow a name after a bare space. */
export const COUNT_STARTS_TIGHT = new Set(["count.digit", "count.word", "count.nx-before", "count.xn-before"]);

type StarsF = (name: string, stars: number) => string;
export const STARS: Template<StarsF>[] = [
  t("stars.after", "train", false, (n, k) => `${n} ${k}`),
  t("stars.before-word", "train", true, (n, k) => `${k} star ${n}`),
  t("stars.after-word", "train", true, (n, k) => `${n} ${k} star`),
  t("stars.after-asterisk", "test", false, (n, k) => `${n} ${k}*`),
  t("stars.before-asterisk", "test", false, (n, k) => `${k}* ${n}`),
  t("stars.asterisks", "test", false, (n, k) => `${n} ${"*".repeat(k)}`),
  t("stars.before-dash", "test", true, (n, k) => `${k}-star ${n}`),
  t("stars.after-dash", "test", true, (n, k) => `${n} ${k}-star`),
];
export const STARS_START_TIGHT = new Set(["stars.before-word", "stars.before-asterisk", "stars.before-dash"]);

// ---- Lists and verbs (rules 9-14) ----

type Frame = (list: string) => string;

/** `set`: what the player holds. */
export const SET_FRAME: Template<Frame>[] = [
  t("set.bare", "both", false, (l) => l),
  t("set.i-have", "train", true, (l) => `I have ${l}`),
  t("set.ive-got", "train", true, (l) => `I've got ${l}`),
  t("set.im-holding", "test", true, (l) => `I'm holding ${l}`),
  t("set.holding", "test", true, (l) => `holding ${l}`),
];

/** The whole board: `clear: ["board"]` plus `set` (rule 13). */
export const BOARD_FRAME: Template<Frame>[] = [
  t("board.my-board", "train", true, (l) => `my board is ${l}`),
  t("board.colon", "train", true, (l) => `board: ${l}`),
  t("board.playing", "test", true, (l) => `playing ${l}`),
  t("board.my-team", "test", true, (l) => `my team is ${l}`),
];

/** Every augment: `clear: ["augments"]` plus `set`. */
export const AUGMENTS_FRAME: Template<Frame>[] = [t("augs.my-augments", "train", true, (l) => `my augments are ${l}`)];

/** Gaining components, items or units. */
export const ADD: Template<Frame>[] = [
  t("add.got", "train", true, (l) => `got ${l}`),
  t("add.just-got", "train", true, (l) => `just got ${l}`),
  t("add.hit", "train", true, (l) => `hit ${l}`),
  t("add.picked-up", "train", true, (l) => `picked up ${l}`),
  t("add.grabbed", "test", true, (l) => `grabbed ${l}`),
  t("add.gained", "test", true, (l) => `gained ${l}`),
];

export const ADD_UNIT: Template<Frame>[] = [
  t("add-unit.bought", "train", true, (l) => `bought ${l}`),
  t("add-unit.added", "train", true, (l) => `added ${l}`),
  t("add-unit.fielded", "test", true, (l) => `fielded ${l}`),
  t("add-unit.put-in", "test", true, (l) => `put in ${l}`),
];

/** "2-starred jinx" → add with stars (rule 9). */
export const STARRED: Template<StarsF>[] = [t("starred.verb", "train", true, (n, k) => `${k}-starred ${n}`)];

/** `components` are the recipe's names, said but not labeled (rule 10). */
type CraftF = (item: string, components: [string, string] | null) => string | null;
export const CRAFT: Template<CraftF>[] = [
  t("craft.made", "train", true, (i) => `made ${i}`),
  t("craft.slammed", "train", true, (i) => `slammed ${i}`),
  t("craft.built", "train", true, (i) => `built ${i}`),
  t("craft.made-from", "train", true, (i, c) => (c ? `made ${i} from ${c[0]} and ${c[1]}` : null)),
  t("craft.crafted", "test", true, (i) => `crafted ${i}`),
  t("craft.finished", "test", true, (i) => `finished ${i}`),
  t("craft.out-of", "test", true, (i, c) => (c ? `crafted ${i} out of ${c[0]} + ${c[1]}` : null)),
];

export const REMOVE: Template<Frame>[] = [
  t("remove.lost", "train", true, (l) => `lost ${l}`),
  t("remove.dont-have", "train", true, (l) => `don't have ${l} anymore`),
  t("remove.used", "test", true, (l) => `used ${l}`),
  t("remove.gave-away", "test", true, (l) => `gave away ${l}`),
];

export const REMOVE_UNIT: Template<Frame>[] = [
  t("remove-unit.sold", "train", true, (l) => `sold ${l}`),
  t("remove-unit.benched", "test", true, (l) => `benched ${l}`),
];

/** An augment taken, without its selection. */
export const AUGMENT_ADD: Template<Frame>[] = [
  t("aug.took", "train", true, (a) => `took ${a}`),
  t("aug.got", "train", true, (a) => `got ${a}`),
  t("aug.picked", "test", true, (a) => `picked ${a}`),
  t("aug.grabbed", "test", true, (a) => `grabbed ${a}`),
];

/** An augment with its selection (rule 19). */
type AugAtF = { render: (augment: string, selection: string) => string; list: "add" | "set" };
export const AUGMENT_AT: Template<AugAtF>[] = [
  t("aug-at.took-at", "train", true, { render: (a, s) => `took ${a} at ${s}`, list: "add" }),
  t("aug-at.my-was", "train", true, { render: (a, s) => `my ${s} was ${a}`, list: "set" }),
  t("aug-at.picked-on", "test", true, { render: (a, s) => `picked ${a} on ${s}`, list: "add" }),
  t("aug-at.the-is", "test", true, { render: (a, s) => `the ${s} augment is ${a}`, list: "set" }),
  t("aug-at.for", "test", true, { render: (a, s) => `grabbed ${a} for ${s}`, list: "add" }),
];

type ClearF = { render: () => string; category: "components" | "items" | "board" | "augments" };
export const CLEAR: Template<ClearF>[] = [
  t("clear.components", "train", true, { render: () => "no components", category: "components" }),
  t("clear.items", "train", true, { render: () => "no items", category: "items" }),
  t("clear.augments", "train", true, { render: () => "no augments", category: "augments" }),
  t("clear.components-yet", "test", true, { render: () => "no components yet", category: "components" }),
  t("clear.items-yet", "test", true, { render: () => "no items yet", category: "items" }),
  t("clear.board", "test", true, { render: () => "empty board", category: "board" }),
];

export const NEXT: Template<() => string>[] = [
  t("next.round", "train", true, () => "next round"),
  t("next.on-to", "test", true, () => "on to the next round"),
];

// ---- Text with nothing to label (rule 21, deferred table) ----

type DistractorF = (ctx: { unit: string; component: string; item: string }) => string;
export const DISTRACTOR: Template<DistractorF>[] = [
  t("x.roll", "train", true, () => "should I roll?"),
  t("x.what-play", "train", true, () => "what do I play"),
  t("x.going", "train", true, () => "going 8 soon"),
  t("x.contested", "train", true, (c) => `2 people on ${c.unit}`),
  t("x.if-hit", "train", true, (c) => `if I hit a ${c.component}`),
  t("x.relative-gold", "train", true, () => "+10 gold"),
  t("x.good", "test", true, () => "is this good?"),
  t("x.fast9", "test", true, () => "thinking fast 9"),
  t("x.unit-contested", "test", true, (c) => `${c.unit} is contested`),
  t("x.should-slam", "test", true, (c) => `should I slam ${c.item}?`),
  t("x.lost-hp", "test", true, () => "lost 12 hp"),
  t("x.should-level", "test", true, () => "should I level?"),
];

// ---- Glue ----

export const OPENER: Template<string>[] = [
  t("open.ok", "train", true, "ok "),
  t("open.so", "train", true, "so "),
  t("open.alright", "train", true, "alright "),
  t("open.hey", "test", true, "hey "),
  t("open.uh", "test", true, "uh "),
  t("open.update", "test", true, "update: "),
];

export const CLOSER: Template<string>[] = [
  t("close.rn", "train", true, " rn"),
  t("close.lol", "train", true, " lol"),
  t("close.atm", "test", true, " atm"),
  t("close.tbh", "test", true, " tbh"),
];

/** Between clauses. */
export const CLAUSE_JOIN: Template<string>[] = [
  t("join.comma", "train", false, ", ", 3),
  t("join.and", "train", true, " and "),
  t("join.semicolon", "test", false, "; ", 2),
  t("join.plus", "test", true, " plus "),
  t("join.period", "test", false, ". "),
];

/**
 * Between names in one list. A bare space is only used between one-word names, and never next to
 * a number (it would read as stars or a count).
 */
export const LIST_JOIN: Template<string>[] = [
  t("list.comma", "train", false, ", ", 3),
  t("list.space", "train", false, " ", 1.5),
  t("list.and", "train", true, " and "),
  t("list.amp", "test", false, " & ", 2),
  t("list.slash", "test", false, " / "),
];

// ---- Quick-bar lines (rules 22-25) ----

export const Q_LEVEL: Template<Num>[] = [
  t("q.level.l", "train", false, (n) => `l${n}`),
  t("q.level.lvl", "train", false, (n) => `lvl${n}`),
  t("q.level.lv", "test", false, (n) => `lv${n}`),
];
/** `bare` is the only gold form that isn't quick-bar-only. */
export const Q_GOLD: Template<Num>[] = [
  t("q.gold.bare", "both", false, (n) => `${n}`),
  t("q.gold.g", "train", false, (n) => `g${n}`),
  t("q.gold.suffix", "test", false, (n) => `${n}g`),
];
export const Q_HP: Template<Num>[] = [
  t("q.hp.h", "train", false, (n) => `h${n}`),
  t("q.hp.hp", "test", false, (n) => `hp${n}`),
  t("q.hp.suffix", "test", false, (n) => `${n}hp`),
];
export const Q_NEXT: Template<string>[] = [t("q.next.n", "train", false, "n"), t("q.next.next", "test", false, "next")];
export const Q_UNDO: Template<string>[] = [t("q.undo.u", "train", false, "u"), t("q.undo.undo", "test", false, "undo")];
