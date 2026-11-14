/**
 * Everything a generated message can name, from the current snapshot, the
 * augment pools and aliases.json, with the ways a player might type each name.
 * Every typed form (except deliberate typos) is checked to resolve to its id
 * the way docs/ml-state-contract.md section 4 says the app will resolve it.
 */
import { aliases, augmentStages, catalog } from "../../src/data";
import { QuickLexicon, normalize } from "../../src/engine/quick";
import { AUGMENT_SELECTIONS } from "../../src/assistant/contract";

export type Kind = "component" | "item" | "unit" | "augment";
export type Selection = (typeof AUGMENT_SELECTIONS)[number];

/** One way to type a name. */
export interface Surface {
  text: string;
  /** Plural form that still resolves ("bows"), or null. */
  plural: string | null;
  /** Can appear in a quick-bar line (no digits, at most 4 words, no sign). */
  quickSafe: boolean;
  source: "name" | "alias" | "prefix";
}

export interface Entity {
  id: string;
  kind: Kind;
  /** "item", "emblem" or "artifact" for items. */
  sub?: string;
  name: string;
  cost?: number;
  /** Augment selections that offer it. */
  selections?: Selection[];
  surfaces: Surface[];
}

export interface Vocab {
  entities: Entity[];
  byKind: Record<Kind, Entity[]>;
  byId: Map<string, Entity>;
  lexicon: QuickLexicon;
  /** Augment ids offered at each selection, from src/data/augments-*.json. */
  pools: Record<Selection, string[]>;
}

/** Typed forms for multi-word alias keys (keys are stored without spaces). */
const ALIAS_DISPLAY: Record<string, string> = {
  florafatalisspat: "flora fatalis spat",
  sivirbeastwithin: "sivir beast within",
  nidaleebeastwithin: "nidalee beast within",
  "sivirbeastwithin+": "sivir beast within+",
  "nidaleebeastwithin+": "nidalee beast within+",
  goldtonsofstats: "gold tons of stats",
  prismatictonsofstats: "prismatic tons of stats",
  tonsofstats1: "tons of stats 1",
  tonsofstats2: "tons of stats 2",
  tonsofstatsi: "tons of stats i",
  tonsofstatsii: "tons of stats ii",
};

export function aliasDisplay(key: string): string {
  const text = ALIAS_DISPLAY[key] ?? (key.length > 4 && key.endsWith("spat") ? `${key.slice(0, -4)} spat` : key);
  return normalize(text) === key ? text : key;
}

/**
 * Words the labeling rules give a meaning (cues, verbs, connectives) or that read as ordinary
 * words, never used as a shortened name.
 */
const RESERVED = new Set([
  ...["level", "gold", "stage", "round", "star", "board", "team", "next", "undo", "no", "and", "my"],
  ...["edge", "hand", "last", "spear", "giant", "gain", "hold", "slam", "build", "made", "going", "time"],
]);

const COMMAND = [/^g?\d+g?$/, /^(?:l|lv|lvl)\d+$/, /^(?:h|hp)\d+$/, /^\d+hp$/, /^\d-\d$/, /^(?:n|next|u|undo)$/];
export const isCommand = (word: string) => COMMAND.some((r) => r.test(word.toLowerCase()));

/**
 * The id a typed name resolves to, or null if it resolves to nothing or to
 * several things: exact alias or name, then a plural fallback, then a unique prefix.
 */
export function resolveName(lexicon: QuickLexicon, text: string): string | null {
  const key = normalize(text);
  if (!key) return null;
  const exact = lexicon.exact(key);
  if (exact.length) return exact.length === 1 ? exact[0].id : null;
  for (const cut of [1, 2]) {
    if (key.length > cut + 1 && key.endsWith(cut === 1 ? "s" : "es")) {
      const found = lexicon.exact(key.slice(0, -cut));
      if (found.length) return found.length === 1 ? found[0].id : null;
    }
  }
  const prefix = lexicon.prefix(key);
  return prefix.length === 1 ? prefix[0].id : null;
}

/** "bow" → "bows", "recurve bow" → "recurve bows"; null for names like "tear of the goddess". */
export function pluralize(text: string): string | null {
  if (/\bof\b/i.test(text) || /\d/.test(text)) return null;
  return /s$/i.test(text) ? text : `${text}s`;
}

/** Lowercase, without . ' ! punctuation: "B.F. Sword" → "bf sword". */
const strip = (name: string) =>
  name
    .toLowerCase()
    .replace(/[.'’!]/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Name variants: as written, lowercase, without punctuation, and for units apostrophes as spaces ("kha zix"). */
function nameVariants(name: string, kind: Kind): string[] {
  const lower = name.toLowerCase();
  const out = [name, lower, strip(name)];
  if (kind === "unit" && /['’]/.test(name)) out.push(lower.replace(/['’]/g, " "));
  return [...new Set(out)];
}

const quickSafe = (text: string) =>
  text.split(/\s+/).length <= 4 && !/\d/.test(text) && !/^[+-]/.test(text) && !/,/.test(text) && !isCommand(text);

export function buildVocab(): Vocab {
  const lexicon = new QuickLexicon(catalog, aliases);
  const snapshot = catalog.snapshot;
  const pools = Object.fromEntries(augmentStages.map((s) => [s.stage, s.augments.map((a) => a.id)])) as Record<
    Selection,
    string[]
  >;
  const aliasesById = new Map<string, string[]>();
  for (const [key, id] of Object.entries(aliases.aliases)) aliasesById.set(id, [...(aliasesById.get(id) ?? []), key]);

  const raw: Omit<Entity, "surfaces">[] = [
    ...snapshot.components.map((c) => ({ id: c.id, kind: "component" as const, name: c.name })),
    ...catalog.holdables.map((h) => ({ id: h.id, kind: "item" as const, sub: h.kind, name: h.name })),
    ...snapshot.units.map((u) => ({ id: u.id, kind: "unit" as const, name: u.name, cost: u.cost })),
    ...snapshot.augments
      .map((a) => ({
        id: a.id,
        kind: "augment" as const,
        name: a.name,
        selections: AUGMENT_SELECTIONS.filter((s) => pools[s].includes(a.id)),
      }))
      // Augments no selection offers can't be taken.
      .filter((a) => a.selections.length),
  ].filter((e) => !e.name.includes(",")); // "One, Two, Five!": commas separate mentions

  const entities: Entity[] = [];
  for (const e of raw) {
    const candidates: [string, Surface["source"]][] = [
      ...nameVariants(e.name, e.kind).map((t) => [t, "name"] as [string, Surface["source"]]),
      ...(aliasesById.get(e.id) ?? []).map((k) => [aliasDisplay(k), "alias"] as [string, Surface["source"]]),
    ];
    // One unique prefix, as players shorten names: the start of a long unit name ("cass" for
    // Cassiopeia), or the first word of a multi-word item ("rabadons", "lunar"). Augments are
    // typed in full or by alias; their first words are too often ordinary words ("level", "time").
    const stripped = strip(e.name);
    const words = stripped.split(" ");
    const prefixes =
      e.kind === "unit" && words.length === 1 && stripped.length >= 7
        ? Array.from({ length: stripped.length - 5 }, (_, i) => stripped.slice(0, i + 4))
        : e.kind === "item" && words.length > 1
          ? [words[0]]
          : [];
    const p = prefixes.find((p) => !RESERVED.has(p) && resolveName(lexicon, p) === e.id);
    if (p) candidates.push([p, "prefix"]);
    const seen = new Set<string>();
    const surfaces: Surface[] = [];
    for (const [text, source] of candidates) {
      if (seen.has(text) || resolveName(lexicon, text) !== e.id) continue;
      seen.add(text);
      // Only components and items come in more than one copy.
      const plural = e.kind === "component" || e.kind === "item" ? pluralize(text) : null;
      surfaces.push({
        text,
        plural: plural && resolveName(lexicon, plural) === e.id ? plural : null,
        quickSafe: quickSafe(text),
        source,
      });
    }
    if (surfaces.length) entities.push({ ...e, surfaces });
  }

  const byKind = { component: [], item: [], unit: [], augment: [] } as Record<Kind, Entity[]>;
  for (const e of entities) byKind[e.kind].push(e);
  return { entities, byKind, byId: new Map(entities.map((e) => [e.id, e])), lexicon, pools };
}
