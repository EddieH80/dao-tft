import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { aliases, catalog } from "@/data";
import { QuickLexicon, normalize } from "@/engine/quick";
import { normText, wordSignature } from "../../scripts/ml/dedupe";
import { canonical } from "../../scripts/ml/labels";
import { REAL_TEST_FILE } from "../../scripts/ml/real-test";
import { StateUpdateSchema } from "./contract";
import { EXAMPLES, SYSTEM_PROMPT, buildPrompt, editDistance, findCandidates, formatCandidates } from "./prompt";

const ROOT = resolve(__dirname, "../..");
const lexicon = new QuickLexicon(catalog, aliases);
/** typed → "match: Name (type) or …", for compact assertions. */
const found = (text: string) =>
  Object.fromEntries(
    findCandidates(text, lexicon).map((c) => [c.typed, `${c.match}: ${c.options.map((o) => `${o.name} (${o.type})`).join(" or ")}`]),
  );
const jsonl = (path: string) =>
  readFileSync(path, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as { id: string; text: string });

describe("findCandidates", () => {
  it("matches aliases, full names, plurals and abbreviations, longest run first", () => {
    expect(found("got ie and hand of justice, 2 bows, b.f. sword")).toEqual({
      ie: "alias: Infinity Edge (item)",
      "hand of justice": "name: Hand Of Justice (item)",
      bows: "plural: Recurve Bow (component)",
      "b.f. sword": "name: B.F. Sword (component)",
    });
  });

  it("reads quick-bar lines: commands are skipped, signs and attached star digits aren't part of the name", () => {
    expect(found("n g52 l7 h64 4-2 -vi +jg Pebbles2 kog")).toEqual({
      vi: "name: Vi (unit)",
      jg: "alias: Jeweled Gauntlet (item)",
      Pebbles: "name: Pebbles (unit)",
      kog: "alias: Kog'Maw (unit)",
    });
  });

  it("reads a trailing number as a numeral when it completes a name (rule 2)", () => {
    expect(found("took bronze for life 1 at 3-2")).toEqual({ "bronze for life 1": "numbered: Bronze For Life I (augment)" });
    expect(found("glass cannon 2")).toEqual({ "glass cannon 2": "numbered: Glass Cannon II (augment)" });
    // A number that doesn't complete a name stays out: it's a star level.
    expect(found("vi 2")).toEqual({ vi: "name: Vi (unit)" });
  });

  it("falls back to a unique prefix, then to a typo against aliases first", () => {
    expect(found("cass and rabadons")).toEqual({
      cass: "prefix: Cassiopeia (unit)",
      rabadons: "prefix: Rabadon's Deathcap (item)",
    });
    expect(found("Kobukko, chain veest, rapid firecanon")).toEqual({
      Kobukko: "fuzzy: Kobuko (unit)",
      "chain veest": "fuzzy: Chain Vest (component)",
      "rapid firecanon": "fuzzy: Rapid Firecannon (item)",
    });
    // "swrod" is one swap from the alias "sword", so the alias wins over any full name.
    expect(found("swrod")).toEqual({ swrod: "fuzzy: B.F. Sword (component)" });
  });

  it("lists every option for an ambiguous name, once each", () => {
    // Two snapshot augments share the key; the player qualifies them ("prismatic tons of stats").
    expect(found("tons of stats")).toEqual({
      "tons of stats": "name: Tons of Stats! (augment) or TONS of Stats! (augment)",
    });
    // Two Beast Within augments with the same name read as one option.
    expect(found("beast within")).toEqual({ "beast within": "name: Beast Within (augment)" });
  });

  it("never reads a cue word, verb or connective as a name on its own (rule 22)", () => {
    // "level" prefix-matches Level Up!, "gold" and "edge" start names.
    expect(found("level 6, gold 30, hit 8, got a sword and the edge")).toEqual({ sword: "alias: B.F. Sword (component)" });
    // As part of a full name they still count.
    expect(found("my 2-1 was level up")).toEqual({ "level up": "name: Level Up! (augment)" });
  });

  it("doesn't run a name across a comma, or let a typo swallow the next word", () => {
    expect(Object.keys(found("vi, ornn"))).toEqual(["vi", "ornn"]);
    expect(Object.keys(found("got void staff"))).toEqual(["void staff"]);
    expect(found("Sparrng Gloves x2")).toEqual({ "Sparrng Gloves": "fuzzy: Sparring Gloves (component)" });
  });

  it("ignores short words a typo budget would make noisy, and gibberish", () => {
    expect(found("oooga booga")).toEqual({});
    expect(found("eise")).toEqual({});
  });

  it("is deterministic and keeps the message's order", () => {
    const text = "sold Scuttlecrab, I have cloak, got two tears, slammed eon";
    expect(findCandidates(text, lexicon)).toEqual(findCandidates(text, lexicon));
    expect(Object.keys(found(text))).toEqual(["Scuttlecrab", "cloak", "tears", "eon"]);
  });

  it("lists a name once however often it's typed", () => {
    expect(Object.keys(found("sword sword bow Sword"))).toEqual(["sword", "bow"]);
  });
});

describe("editDistance", () => {
  it("counts edits and adjacent swaps", () => {
    expect(editDistance("cloak", "cloak")).toBe(0);
    expect(editDistance("clok", "cloak")).toBe(1);
    expect(editDistance("cloka", "cloak")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
    // Stops early once past the limit.
    expect(editDistance("cloak", "spatula", 1)).toBe(2);
  });
});

describe("formatCandidates", () => {
  it("shows the typed words and what they could be, marking typos as maybe", () => {
    expect(formatCandidates(findCandidates("ie, Kobukko", lexicon))).toBe(
      'Names in the message:\n"ie" = Infinity Edge (item)\n"Kobukko" = maybe Kobuko (unit)',
    );
    expect(formatCandidates([])).toBe("Names in the message: none");
  });
});

describe("buildPrompt", () => {
  const messages = buildPrompt("lvl 7, ie and 2 bows", lexicon);

  it("is the system message, the examples as chat turns, then the message", () => {
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM_PROMPT });
    const turns = messages.slice(1, -1);
    expect(turns).toHaveLength(EXAMPLES.length * 2);
    turns.forEach((m, i) => expect(m.role).toBe(i % 2 ? "assistant" : "user"));
    expect(messages.at(-1)).toEqual({
      role: "user",
      content:
        'Names in the message:\n"ie" = Infinity Edge (item)\n"bows" = Recurve Bow (component)\nMessage: lvl 7, ie and 2 bows',
    });
  });

  it("includes only the names the message mentions, never the whole snapshot or any id", () => {
    const last = buildPrompt("should I roll?", lexicon).at(-1)!.content;
    expect(last).toBe("Names in the message: none\nMessage: should I roll?");
    const all = messages.map((m) => m.content).join("\n");
    for (const id of ["DA_InfinityEdge", "RecurveBow", "BFSword"]) expect(all).not.toContain(id);
    // Units no example or message names aren't in the prompt.
    for (const unit of ["Ahri", "Taric", "Elder Dragon"]) expect(all).not.toContain(unit);
  });

  it("stays well inside WebLLM's 4k-token context (about 4 characters a token)", () => {
    const long = "my board is soraka 2, hecarim, tristana, elise, vi, ornn, ashe, draven, taric, 3-2, 26 gold, ie, gs, 2 bows";
    const chars = buildPrompt(long, lexicon).reduce((n, m) => n + m.content.length, 0);
    expect(chars).toBeLessThan(8000);
  });
});

describe("prompt examples", () => {
  it("are canonical labels that pass the app's schema", () => {
    for (const ex of EXAMPLES) {
      const parsed = StateUpdateSchema.parse(JSON.parse(ex.output));
      expect(ex.output, ex.text).toBe(JSON.stringify(canonical(parsed)));
    }
  });

  it("list every labeled name among the message's candidates (the snapshot still has them)", () => {
    for (const ex of EXAMPLES) {
      const typed = new Set(findCandidates(ex.text, lexicon).map((c) => normalize(c.typed)));
      const u = JSON.parse(ex.output) as Record<string, { name: string }[] | unknown>;
      for (const list of ["set", "remove", "add", "craft"]) {
        for (const m of (u[list] as { name: string }[] | undefined) ?? []) expect(typed, `${ex.text}: ${m.name}`).toContain(normalize(m.name));
      }
    }
  });

  it("are never taken from the real-world test set (Project rules)", () => {
    const real = jsonl(resolve(ROOT, REAL_TEST_FILE));
    const texts = new Set(real.map((r) => normText(r.text)));
    const signatures = new Set(real.map((r) => wordSignature(r.text)));
    for (const ex of EXAMPLES) {
      expect(texts.has(normText(ex.text)), ex.text).toBe(false);
      expect(signatures.has(wordSignature(ex.text)), ex.text).toBe(false);
    }
    expect(readFileSync(resolve(__dirname, "prompt.ts"), "utf8")).not.toMatch(/real-test|r0\d{3}/);
  });

  const train = resolve(ROOT, "ml-data/v1/train.jsonl");
  const test = resolve(ROOT, "ml-data/v1/test.jsonl");
  it.skipIf(!existsSync(train) || !existsSync(test))("are copied from the train split, and none is in the synthetic test split", () => {
    const byId = new Map(jsonl(train).map((r) => [r.id, r.text]));
    for (const ex of EXAMPLES.filter((e) => e.source.startsWith("train-"))) expect(byId.get(ex.source), ex.source).toBe(ex.text);
    const testTexts = new Set(jsonl(test).map((r) => normText(r.text)));
    for (const ex of EXAMPLES) expect(testTexts.has(normText(ex.text)), ex.text).toBe(false);
  });
});
