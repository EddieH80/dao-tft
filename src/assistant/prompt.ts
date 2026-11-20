/**
 * The prompt the on-device model gets for one player message (docs/ml-plan.md step 5).
 * The app builds it at runtime; the eval exports the same prompts for Python runs
 * (scripts/ml/eval/prompts.ts), so both see identical text.
 *
 * The prompt holds:
 * - instructions and the output schema (docs/ml-state-contract.md, condensed);
 * - worked examples as earlier chat turns;
 * - the message, with the names found in it. Never the whole snapshot: only names the
 *   message seems to mention, picked by deterministic matching (aliases first), so the
 *   prompt stays short and changes with the daily snapshot.
 *
 * Candidates are a hint, not a decision: the model still copies the player's words (rule 1),
 * and the app resolves them (contract section 4). The model is never given ids or state.
 */
import { isQuickCommand, normalize, type Entry, type EntryType, type QuickLexicon } from "@/engine/quick";

/** Bump when the instructions, examples, candidate matching or format change; recorded in every export. */
export const PROMPT_VERSION = "prompt-v1";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type MatchKind = "alias" | "name" | "plural" | "numbered" | "prefix" | "fuzzy";

/** A run of the player's words that seems to name something in the snapshot. */
export interface Candidate {
  /** The words as typed, without a leading sign, an attached star digit or edge punctuation. */
  typed: string;
  match: MatchKind;
  /** What it could be, at most MAX_OPTIONS; several means ambiguous. */
  options: { name: string; type: EntryType }[];
}

/** Longest name in words (Young and Wild and Free, Tear Of The Goddess plus a number). */
const MAX_WORDS = 5;
const MAX_OPTIONS = 3;
/** Shorter prefixes match too much. */
const MIN_PREFIX = 3;
/** At most this many candidates, the contract's mention limit. */
const MAX_CANDIDATES = 20;

/**
 * Words that are never a name on their own: articles, pronouns, the labeling rules' cue words,
 * verbs and connectives (contract rule 22), and ordinary words that start a name ("edge", "time").
 * They can still be part of a longer name ("the indomitable", "level up").
 */
const STOPWORDS = new Set(
  [
    ...["a", "an", "the", "my", "i", "im", "ive", "id", "me", "we", "you", "it", "its", "is", "am", "are", "was", "were", "be"],
    ...["to", "of", "on", "at", "in", "for", "from", "with", "and", "or", "but", "so", "then", "now", "just", "also", "plus"],
    ...["rn", "lol", "ok", "okay", "alright", "hey", "yo", "well", "um", "uh", "pls", "please", "thanks", "ty"],
    ...["what", "should", "can", "could", "would", "how", "why", "which", "who", "do", "does", "did", "if", "this", "that"],
    ...["these", "those", "some", "few", "several", "couple", "pair", "all", "any", "only", "still", "too", "very", "really"],
    ...["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "x", "no", "not", "dont", "yet"],
    ...["got", "get", "have", "has", "had", "hit", "took", "take", "grabbed", "picked", "up", "gained", "bought", "buy"],
    ...["added", "put", "made", "make", "built", "build", "crafted", "slammed", "slam", "combined", "finished", "sold"],
    ...["sell", "lost", "lose", "used", "use", "removed", "benched", "gave", "away", "holding", "hold", "playing", "into"],
    ...["out", "off", "rolled", "roll", "rolling", "spent", "spend", "went", "going", "go", "actually", "wait", "left"],
    ...["level", "lvl", "lv", "gold", "hp", "health", "stage", "round", "star", "stars", "starred", "board", "team"],
    ...["bench", "next", "undo", "u", "new", "game", "xp", "carousel", "orb", "augment", "augments", "item", "items"],
    ...["component", "components", "unit", "units", "copy", "copies", "time", "edge", "hand", "last", "spear", "giant"],
    ...["gain", "big", "late", "more", "less", "good", "bad", "free"],
  ].map(normalize),
);

const ROMAN: Record<string, string> = { "1": "i", "2": "ii", "3": "iii" };
const ARABIC: Record<string, string> = { i: "1", ii: "2", iii: "3" };

interface Token {
  start: number;
  end: number;
  /** End without an attached star digit ("jinx2" → "jinx"), or null. */
  bareEnd: number | null;
  key: string;
  /** Has a letter and isn't a quick-bar command or a number. */
  nameable: boolean;
  stop: boolean;
  /** A comma, period or similar follows, so no name runs past this token. */
  breakAfter: boolean;
}

/** Splits the message into words, with their spans in the original text. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const m of text.matchAll(/\S+/g)) {
    const raw = m[0];
    let start = m.index;
    let end = start + raw.length;
    const lead = raw.match(/^["'([{]+/)?.[0].length ?? 0;
    const trail = raw.match(/[.,!?:;"')\]}/|&]+$/)?.[0] ?? "";
    start += lead;
    end -= trail.length;
    // A period ends a sentence, except in an abbreviation with another period ("b.f. sword").
    const abbreviation = trail === "." && raw.slice(0, -1).includes(".");
    const breakAfter = !abbreviation && /[.,!?:;/|&)]/.test(trail);
    let core = text.slice(start, end);
    // A leading "+" or "-" is the quick bar's sign, not part of the name.
    if (core.length > 1 && (core[0] === "+" || core[0] === "-")) {
      start++;
      core = core.slice(1);
    }
    const key = normalize(core);
    if (!key) {
      // A lone "+", "/" or "&" separates things, like a comma.
      if (tokens.length) tokens[tokens.length - 1].breakAfter = true;
      continue;
    }
    const command = isQuickCommand(core);
    const bareEnd = !command && /[a-z][123]$/i.test(core) ? end - 1 : null;
    tokens.push({
      start,
      end,
      bareEnd,
      key,
      // "x2" and "2x" are counts (rule 6), not names.
      nameable: /[a-z]/.test(key) && !command && !/^(?:x\d+|\d+x)$/.test(key),
      stop: STOPWORDS.has(key),
      breakAfter,
    });
  }
  return tokens;
}

/** Optimal string alignment distance (Levenshtein plus adjacent swaps), stopping early past `max`. */
export function editDistance(a: string, b: string, max = Infinity): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      rowMin = Math.min(rowMin, d);
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}

/** Typos allowed for a key of this length: none below 5 letters, one up to 7, two from 8. */
const fuzzyBudget = (key: string) => (key.length >= 8 ? 2 : key.length >= 5 ? 1 : 0);

interface KeyIndex {
  keys: { key: string; entry: Entry; alias: boolean }[];
  aliases: Set<string>;
}
const keyIndex = new WeakMap<QuickLexicon, KeyIndex>();
function indexOf(lexicon: QuickLexicon): KeyIndex {
  let index = keyIndex.get(lexicon);
  if (!index) {
    const keys = lexicon.keys();
    index = { keys, aliases: new Set(keys.filter((k) => k.alias).map((k) => k.key)) };
    keyIndex.set(lexicon, index);
  }
  return index;
}

/** The closest alias keys within the typo budget, or failing that the closest names. */
function fuzzy(lexicon: QuickLexicon, key: string, single: boolean): Entry[] {
  const budget = fuzzyBudget(key);
  if (!budget) return [];
  for (const alias of [true, false]) {
    let best = budget + 1;
    let found: Entry[] = [];
    for (const k of indexOf(lexicon).keys) {
      if (k.alias !== alias) continue;
      // Augments are typed in full; a single word near one is usually an ordinary word.
      if (single && k.entry.type === "augment") continue;
      const d = editDistance(key, k.key, best);
      if (d > budget) continue;
      if (d < best) [best, found] = [d, [k.entry]];
      else if (d === best) found.push(k.entry);
    }
    if (found.length) return found;
  }
  return [];
}

/** Entries the key names exactly: alias, then full name, then a plural without its "s" / "es". */
function exact(lexicon: QuickLexicon, key: string): { entries: Entry[]; match: MatchKind } | null {
  const found = lexicon.exact(key);
  if (found.length) return { entries: found, match: indexOf(lexicon).aliases.has(key) ? "alias" : "name" };
  for (const cut of [1, 2]) {
    if (key.length > cut + 2 && key.endsWith(cut === 1 ? "s" : "es")) {
      const plural = lexicon.exact(key.slice(0, -cut));
      if (plural.length) return { entries: plural, match: "plural" };
    }
  }
  return null;
}

/** Distinct options, at most MAX_OPTIONS, or null when there are too many to help. */
function options(entries: Entry[]): Candidate["options"] | null {
  const seen = new Map<string, { name: string; type: EntryType }>();
  for (const e of entries) seen.set(`${e.type}|${e.name}`, { name: e.name, type: e.type });
  const list = [...seen.values()];
  return list.length && list.length <= MAX_OPTIONS ? list : null;
}

/**
 * The runs of words in `text` that seem to name a component, item, unit or augment, in the
 * order typed. Deterministic: at each word, tiers are tried in order, and within a tier the
 * longest run wins, as in the quick bar.
 * 1. exact: alias, full name, plural, or a trailing 1-3 / i-iii read as a numeral ("glass cannon 2");
 * 2. a unique prefix of at least 3 letters (not for single-word augments);
 * 3. fuzzy: within 1 typo (5-7 letters) or 2 (8+), against aliases first, then names.
 */
export function findCandidates(text: string, lexicon: QuickLexicon): Candidate[] {
  const tokens = tokenize(text);
  const out: Candidate[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < tokens.length && out.length < MAX_CANDIDATES) {
    if (!tokens[i].nameable) {
      i++;
      continue;
    }
    // A name can't run past a break or past a word with an attached star digit.
    let reach = 1;
    while (reach < MAX_WORDS && i + reach < tokens.length && !tokens[i + reach - 1].breakAfter && tokens[i + reach - 1].bareEnd === null)
      reach++;
    const found = match(text, tokens.slice(i, i + reach), lexicon);
    if (!found) {
      i++;
      continue;
    }
    const dedupe = normalize(found.candidate.typed);
    if (!seen.has(dedupe)) {
      seen.add(dedupe);
      out.push(found.candidate);
    }
    i += found.words;
  }
  return out;
}

function match(text: string, span: Token[], lexicon: QuickLexicon): { candidate: Candidate; words: number } | null {
  const lengths = Array.from({ length: span.length }, (_, k) => span.length - k);
  // Each run of words can end with or without an attached star digit ("jinx2"), full form first.
  const forms = (n: number) => {
    const words = span.slice(0, n);
    const last = words[n - 1];
    const head = words.slice(0, -1).map((t) => t.key);
    const full = { key: [...head, last.key].join(""), end: last.end };
    if (last.bareEnd === null) return [full];
    return [full, { key: [...head, normalize(text.slice(last.start, last.bareEnd))].join(""), end: last.bareEnd }];
  };
  const result = (n: number, end: number, entries: Entry[], kind: MatchKind) => {
    const opts = options(entries);
    return opts ? { candidate: { typed: text.slice(span[0].start, end), match: kind, options: opts }, words: n } : null;
  };
  // Single words that are stopwords never name anything (rule 22's cue words).
  const allowed = (n: number) => n > 1 || !span[0].stop;
  // Runs for prefix and fuzzy matching are all name-like words, and don't start or end with a
  // stopword, which a typo budget would otherwise swallow ("got void staff"). Only exact names
  // may start with one ("the indomitable").
  const loose = (n: number) => span.slice(0, n).every((t) => t.nameable) && !span[0].stop && !span[n - 1].stop;

  for (const n of lengths) {
    if (!allowed(n)) continue;
    for (const f of forms(n)) {
      const hit = exact(lexicon, f.key);
      if (hit) {
        const r = result(n, f.end, hit.entries, hit.match);
        if (r) return r;
      }
    }
    // "glass cannon 2" → Glass Cannon II; "tons of stats ii" → the "2" form.
    const last = span[n - 1].key;
    if (n > 1 && (ROMAN[last] || ARABIC[last])) {
      const head = span.slice(0, n - 1).map((t) => t.key).join("");
      const hit = exact(lexicon, head + (ROMAN[last] ?? ARABIC[last]));
      if (hit) {
        const r = result(n, span[n - 1].end, hit.entries, "numbered");
        if (r) return r;
      }
    }
  }
  // Then the longest run that a prefix or a typo explains, so "blue buuff" beats "blue" as a prefix.
  for (const n of lengths) {
    if (!loose(n)) continue;
    for (const f of forms(n)) {
      if (f.key.length < MIN_PREFIX) continue;
      const found = lexicon.prefix(f.key).filter((e) => n > 1 || e.type !== "augment");
      const r = found.length ? result(n, f.end, found, "prefix") : null;
      if (r) return r;
    }
    if (n > 3) continue;
    for (const f of forms(n)) {
      const found = fuzzy(lexicon, f.key, n === 1);
      const r = found.length ? result(n, f.end, found, "fuzzy") : null;
      if (r) return r;
    }
  }
  return null;
}

/** The candidate list as the model sees it. */
export function formatCandidates(candidates: Candidate[]): string {
  if (!candidates.length) return "Names in the message: none";
  const line = (c: Candidate) => {
    const what = c.options.map((o) => `${o.name} (${o.type})`).join(" or ");
    return `"${c.typed}" = ${c.match === "fuzzy" ? `maybe ${what}` : what}`;
  };
  return ["Names in the message:", ...candidates.map(line)].join("\n");
}

/** One user turn: the names found, then the message itself, last so it sits next to the answer. */
export function formatUser(text: string, lexicon: QuickLexicon): string {
  return `${formatCandidates(findCandidates(text, lexicon))}\nMessage: ${text}`;
}

export const SYSTEM_PROMPT = `You turn a Teamfight Tactics player's message into a JSON update for their game tracker. Reply with one JSON object on one line and nothing else: no prose, no code fences.

Fields. Leave out anything the message doesn't state. {} means nothing to update.
- "level": 2-10. "gold": 0-250. "hp": 0-100. "stage": the current round, like "4-2".
- "goldChange": gold gained by selling or from an orb (+N), or spent rolling or buying units or xp (-N), only when the amount is stated. Several changes are summed. Never together with "gold": a stated total wins.
- "hpChange": HP lost (-N) or gained (+N). Never together with "hp".
- "next": true for "n", "next", "next round". "undo": true for "u" or "undo", alone. "newGame": true for "new game", alone.
- "clear": a list of "components", "items", "board", "augments". Use it for "no components", and when the player gives the whole board ("my board is", "board:") or all their augments ("my augments are").
- "set": things the player has, with no event verb: a bare list, "I have", "I've got".
- "add": things gained: "got", "hit", "took", "picked up", "bought", "2-starred", "+name".
- "remove": things sold, lost or used: "sold", "lost", "-name".
- "craft": items made: "made", "built", "slammed". In a shorthand line, plain names go here too.
Each list holds mentions like {"name":"bows","count":2}. A mention has "name" and optionally one of:
- "count": 2-20, from a number or "x2" before the name, or the name repeated. Left out for one.
- "stars": 1-3, from a number right after the name ("jinx 2", "jinx2") or "2 star" before it.
- "at": "2-1", "3-2" or "4-2": the augment round, when the player links it ("took X at 2-1", "my 2-1 was X").

Rules:
- "name" is the player's own words for the thing, copied exactly as typed, typos and plurals included. Leave out "a", "the", "my", count words and star markers.
- Each message comes with the names found in it. Copy the words in quotes, never the full name after "=". A name that isn't listed is still copied as typed.
- Questions, plans, "if" and other players update nothing: {}. A statement next to a question is still recorded.
- A bare number in a sentence is not gold. In a shorthand line like "n 38 h71 l7 ie -bow" it is: there "l7" is level 7, "h71" is hp 71, a plain name goes in "craft", "+name" in "add", "-name" in "remove".
- If a value is stated twice, the last one wins.`;

/**
 * Worked examples, sent as earlier chat turns. Most are copied verbatim from the synthetic train
 * split (data v1, ids noted), so they use only train-pool phrasings and never test-only ones.
 * The generator has no gold or HP changes yet, so one example is written from contract rules
 * 16b and 17b. Never take an example from, or equal to, a real-world test text (Project rules);
 * a test checks.
 * The output is the canonical label (keys in contract order).
 */
export const EXAMPLES: readonly { text: string; output: string; source: string }[] = [
  {
    source: "train-007807",
    text: "my board is soraka, 2 star hecarim, tristana, Elise, stage 3-2, 26 gold",
    output: `{"gold":26,"stage":"3-2","clear":["board"],"set":[{"name":"soraka"},{"name":"hecarim","stars":2},{"name":"tristana"},{"name":"Elise"}]}`,
  },
  {
    source: "train-004165",
    text: "ok got two tears, sold Scuttlecrab, I have cloak, I'm 8",
    output: `{"level":8,"set":[{"name":"cloak"}],"remove":[{"name":"Scuttlecrab"}],"add":[{"name":"tears","count":2}]}`,
  },
  {
    source: "train-013983",
    text: "n Item Extraction sword g54 -morellonomicon",
    output: `{"next":true,"gold":54,"remove":[{"name":"morellonomicon"}],"craft":[{"name":"Item Extraction"},{"name":"sword"}]}`,
  },
  {
    source: "train-011470",
    text: "should I roll? lol",
    output: `{}`,
  },
  {
    source: "train-000886",
    text: "slammed eon, got Luden's Tempest, built Striker's Flail",
    output: `{"add":[{"name":"Luden's Tempest"}],"craft":[{"name":"eon"},{"name":"Striker's Flail"}]}`,
  },
  {
    source: "train-008812",
    text: "83g, I have glove glove, hit 6 rn",
    output: `{"level":6,"gold":83,"set":[{"name":"glove","count":2}]}`,
  },
  {
    source: "train-017171",
    text: "gold 0 and my 2-1 was deadlier blades",
    output: `{"gold":0,"set":[{"name":"deadlier blades","at":"2-1"}]}`,
  },
  {
    source: "train-014578",
    text: "g0 Pebbles2 Kayle",
    output: `{"gold":0,"craft":[{"name":"Pebbles","stars":2},{"name":"Kayle"}]}`,
  },
  {
    source: "train-019309",
    text: "49 gold, hit 8, no components, 13 hp",
    output: `{"level":8,"gold":49,"hp":13,"clear":["components"]}`,
  },
  {
    source: "train-017853",
    text: "3 star veigar and Kobukko and 2 star camile, 29g",
    output: `{"gold":29,"set":[{"name":"veigar","stars":3},{"name":"Kobukko"},{"name":"camile","stars":2}]}`,
  },
  {
    source: "train-013809",
    text: "2 people on rek'sai",
    output: `{}`,
  },
  {
    source: "train-009513",
    text: "lvl 6, my augments are replication, bronze for life i",
    output: `{"level":6,"clear":["augments"],"set":[{"name":"replication"},{"name":"bronze for life i"}]}`,
  },
  {
    source: "train-013044",
    text: "ok next round, 90 gold",
    output: `{"next":true,"gold":90}`,
  },
  {
    source: "contract rules 16b, 17b",
    text: "sold vi for 2 and rolled 10, lost 6 hp",
    output: `{"goldChange":-8,"hpChange":-6,"remove":[{"name":"vi"}]}`,
  },
  // No "u" example: it's in the real-world test set too (the only way to type it), so the
  // instructions cover undo instead.
];

const examplesCache = new WeakMap<QuickLexicon, ChatMessage[]>();

/** The system message and the example turns, which don't depend on the message. */
export function promptPreamble(lexicon: QuickLexicon): ChatMessage[] {
  let turns = examplesCache.get(lexicon);
  if (!turns) {
    turns = [
      { role: "system", content: SYSTEM_PROMPT },
      ...EXAMPLES.flatMap((ex): ChatMessage[] => [
        { role: "user", content: formatUser(ex.text, lexicon) },
        { role: "assistant", content: ex.output },
      ]),
    ];
    examplesCache.set(lexicon, turns);
  }
  return turns;
}

/**
 * The chat messages for one player message. The app passes them to WebLLM, which renders them
 * with Llama 3.2's chat template; Python runs render them the same way (predict_hf.py).
 */
export function buildPrompt(text: string, lexicon: QuickLexicon): ChatMessage[] {
  return [...promptPreamble(lexicon), { role: "user", content: formatUser(text, lexicon) }];
}
