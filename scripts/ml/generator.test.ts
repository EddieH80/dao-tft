import { describe, expect, it } from "vitest";
import { StateUpdateSchema } from "../../src/assistant/contract";
import { Deduper, normText, wordSignature } from "./dedupe";
import { generate } from "./generate";
import { LabelBuilder, canonical, serialize } from "./labels";
import { assemble, hasQuickOnlyToken, typo, type Piece } from "./render";
import { Rng } from "./rng";
import { splitStats } from "./stats";
import * as T from "./templates";
import { SHARED_TEMPLATES, type Template } from "./templates";
import { buildVocab, pluralize, resolveName } from "./vocab";

const v = buildVocab();

/** An Rng whose picks follow a script (indexes into each list); everything else is seeded. */
class ScriptRng extends Rng {
  constructor(private readonly script: number[]) {
    super(1);
  }
  pick<X>(xs: readonly X[]): X {
    const i = this.script.shift();
    if (i === undefined) throw new Error("script ran out");
    return xs[i];
  }
}

describe("labels", () => {
  it("serializes in contract key order, whatever order things were said", () => {
    const b = new LabelBuilder()
      .mention("set", { name: "bows", count: 2 })
      .scalar("gold", 32)
      .mention("set", { name: "sword" })
      .scalar("level", 6);
    expect(serialize(b.build())).toBe('{"level":6,"gold":32,"set":[{"name":"bows","count":2},{"name":"sword"}]}');
  });

  it("merges a repeated name into a count, ignoring case (rule 5)", () => {
    const b = new LabelBuilder().mention("craft", { name: "bow" }).mention("craft", { name: "Bow" }).mention("craft", { name: "ie" });
    expect(b.build()).toEqual({ craft: [{ name: "bow", count: 2 }, { name: "ie" }] });
  });

  it("keeps different star levels apart, and the last value of a scalar (rule 20)", () => {
    const b = new LabelBuilder()
      .scalar("level", 6)
      .scalar("level", 7)
      .mention("set", { name: "vi", stars: 2 })
      .mention("set", { name: "vi" });
    expect(b.build()).toEqual({ level: 7, set: [{ name: "vi", stars: 2 }, { name: "vi" }] });
  });

  it("drops empty lists and count 1, and orders mention keys", () => {
    expect(canonical({ set: [], add: [{ at: "2-1", name: "uplink" }], craft: [{ count: 1, name: "ie" }] })).toEqual({
      add: [{ name: "uplink", at: "2-1" }],
      craft: [{ name: "ie" }],
    });
    expect(JSON.stringify(canonical({ add: [{ at: "2-1", name: "uplink" }] }))).toBe('{"add":[{"name":"uplink","at":"2-1"}]}');
  });

  it("clears each category once, in the order said", () => {
    expect(new LabelBuilder().clear("items").clear("board").clear("items").build()).toEqual({ clear: ["items", "board"] });
  });
});

describe("rng", () => {
  it("repeats exactly for a seed and differs across seeds", () => {
    const seq = (seed: number) => {
      const r = new Rng(seed);
      return Array.from({ length: 5 }, () => r.int(1, 100));
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
  });

  it("stays in range", () => {
    const r = new Rng(9);
    for (let i = 0; i < 1000; i++) {
      const n = r.int(3, 5);
      expect(n >= 3 && n <= 5).toBe(true);
    }
    expect(r.weighted([["only", 1]] as const)).toBe("only");
  });
});

describe("names", () => {
  it("resolves names the way the contract says the app will (section 4)", () => {
    expect(resolveName(v.lexicon, "bows")).toBe("RecurveBow");
    expect(resolveName(v.lexicon, "Kha Zix")).toBe("DA_18_KhaZix");
    expect(resolveName(v.lexicon, "kha")).toBe("DA_18_KhaZix");
    expect(resolveName(v.lexicon, "ie")).toBe("DA_InfinityEdge");
    expect(resolveName(v.lexicon, "lunar spat")).toBe("DA_18_EmblemLunar");
    expect(resolveName(v.lexicon, "prismatic tons of stats")).toBe("DA_TonsOfStatsII");
    expect(resolveName(v.lexicon, "tons of stats")).toBeNull(); // two augments share the name
    expect(resolveName(v.lexicon, "jnx")).toBeNull();
  });

  it("pluralizes only simple names", () => {
    expect(pluralize("bow")).toBe("bows");
    expect(pluralize("recurve bow")).toBe("recurve bows");
    expect(pluralize("gloves")).toBe("gloves");
    expect(pluralize("tear of the goddess")).toBeNull();
    expect(pluralize("tons of stats 2")).toBeNull();
  });

  it("only offers typed forms that resolve to their own id", () => {
    for (const e of v.entities) {
      for (const s of e.surfaces) {
        expect(resolveName(v.lexicon, s.text), `${s.text} → ${e.id}`).toBe(e.id);
        if (s.plural) expect(resolveName(v.lexicon, s.plural), `${s.plural} → ${e.id}`).toBe(e.id);
      }
    }
  });

  it("has the expected forms for a few names", () => {
    const texts = (id: string) => v.byId.get(id)!.surfaces.map((s) => s.text);
    expect(texts("RecurveBow")).toEqual(["Recurve Bow", "recurve bow", "bow"]);
    expect(texts("DA_18_KhaZix")).toEqual(["Kha'Zix", "kha'zix", "khazix", "kha zix", "kz"]);
    expect(texts("DA_18_PrimalAugment_Sivir")).toEqual(["sivir beast within"]);
    expect(v.byId.get("DA_StrikersFlail")!.surfaces.map((s) => s.text)).not.toContain("striker s flail");
    // A name ending in a number can't go in a quick-bar line, where "2" would read as stars.
    expect(v.byId.get("DA_TonsOfStatsII")!.surfaces.find((s) => s.text === "tons of stats 2")!.quickSafe).toBe(false);
  });

  it("makes one small slip per typo, never on the first letter", () => {
    // Letters after the first in "sword" are at 1-4; the script picks index 1 (the "o") then the operation.
    expect(typo(new ScriptRng([1, 0]), "sword")).toBe("swrd");
    expect(typo(new ScriptRng([1, 1]), "sword")).toBe("swrod");
    expect(typo(new ScriptRng([1, 2]), "sword")).toBe("swoord");
    expect(typo(new ScriptRng([0, 0]), "kz")).toBe("kz"); // too short to slip
  });
});

describe("templates", () => {
  const categories: Record<string, Template<unknown>[]> = Object.fromEntries(
    Object.entries(T).filter(([, x]) => Array.isArray(x) && (x as Template<unknown>[])[0]?.id),
  ) as Record<string, Template<unknown>[]>;

  it("never reuses a template id", () => {
    const ids = Object.values(categories).flatMap((ts) => ts.map((t) => t.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("shares only the templates that have one spelling", () => {
    const shared = Object.values(categories)
      .flat()
      .filter((t) => t.pool === "both")
      .map((t) => t.id);
    // A frameless list and a bare quick-bar number have no other spelling.
    expect(shared.sort()).toEqual(["q.gold.bare", "set.bare"]);
    for (const id of shared) expect(SHARED_TEMPLATES).toContain(id);
  });

  it("renders different text in the two pools", () => {
    const args: Record<string, unknown[]> = {
      COUNT: ["bow", "bows", 2],
      STARS: ["jinx", 2],
      STARRED: ["jinx", 2],
      CRAFT: ["ie", ["sword", "glove"]],
      CORRECTION: ["level 6", 7],
      DISTRACTOR: [{ unit: "ashe", component: "bow", item: "ie" }],
      LEVEL: [7],
      GOLD: [7],
      HP: [7],
      Q_LEVEL: [7],
      Q_GOLD: [7],
      Q_HP: [7],
    };
    const sample = (name: string, t: Template<unknown>): string => {
      const f = t.f as unknown;
      if (typeof f === "string") return f;
      if (typeof f === "function") return JSON.stringify((f as (...a: unknown[]) => unknown)(...(args[name] ?? ["X"])));
      return (f as { render: (...a: unknown[]) => string }).render("bow", "3-2");
    };
    for (const [name, all] of Object.entries(categories)) {
      const ts = all.map((t) => ({ ...t, f: sample(name, t) }));
      const train = new Set(ts.filter((t) => t.pool === "train").map((t) => t.f));
      const test = ts.filter((t) => t.pool === "test").map((t) => t.f);
      for (const s of test) expect(train.has(s), `${name}: ${s}`).toBe(false);
    }
  });

  it("renders the contract's forms exactly", () => {
    const f = <F>(ts: Template<F>[], id: string) => ts.find((t) => t.id === id)!.f;
    expect(f(T.LEVEL, "level.im")(7)).toBe("I'm 7");
    expect(f(T.LEVEL, "level.now")(8)).toBe("8 now");
    expect(f(T.GOLD, "gold.suffix-g")(32)).toBe("32g");
    expect(f(T.STAGE, "stage.round").render("3-2")).toBe("stage 3 round 2");
    expect(f(T.STARS, "stars.after")("jinx", 2)).toBe("jinx 2");
    expect(f(T.STARS, "stars.asterisks")("jinx", 3)).toBe("jinx ***");
    expect(f(T.COUNT, "count.digit")("bow", "bows", 2)).toEqual({ text: "2 bows", name: "bows" });
    expect(f(T.COUNT, "count.repeat")("bow", "bows", 2)).toEqual({ text: "bow bow", name: "bow" });
    expect(f(T.COUNT, "count.repeat")("recurve bow", "recurve bows", 2)).toBeNull();
    expect(f(T.COUNT, "count.pair")("tear of the goddess", null, 2)).toBeNull();
    expect(f(T.AUGMENT_AT, "aug-at.the-is").render("uplink", "2-1")).toBe("the 2-1 augment is uplink");
    expect(f(T.CORRECTION, "fix.actually")("level 6", 7)).toBe("level 6, actually 7");
  });
});

describe("message assembly", () => {
  const piece = (text: string, apply: Piece["apply"], extra: Partial<Piece> = {}): Piece => ({
    text,
    word: true,
    first: false,
    templates: [],
    typos: 0,
    apply,
    ...extra,
  });

  it("puts a linked stage first, a bare list before verbs, and an aside last", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const out = assemble({ rng: new Rng(seed), pool: "train", v, used: new Set() }, [
        piece("should I roll?", () => {}, { last: true }),
        piece("got ie", (b) => b.mention("add", { name: "ie" })),
        piece("bow, sword", (b) => b.mention("set", { name: "bow" }).mention("set", { name: "sword" }), { bare: true, word: false }),
        piece("on 3-2", (b) => b.scalar("stage", "3-2"), { first: true }),
      ]);
      const at = (s: string) => out.text.indexOf(s);
      expect(at("on 3-2")).toBeLessThan(at("bow, sword"));
      expect(at("bow, sword")).toBeLessThan(at("got ie"));
      expect(at("got ie")).toBeLessThan(at("should I roll?"));
      expect(out.text).not.toMatch(/on 3-2 and bow/); // a bare list follows punctuation
      expect(out.label).toEqual({ stage: "3-2", set: [{ name: "bow" }, { name: "sword" }], add: [{ name: "ie" }] });
    }
  });

  it("adds a plain word when a quick-bar-only token would make it a quick-bar line (rule 22)", () => {
    expect(hasQuickOnlyToken("lvl 6, 32g")).toBe(true);
    expect(hasQuickOnlyToken("h40")).toBe(true);
    expect(hasQuickOnlyToken("lvl 6, 32 gold, 3-2")).toBe(false);
    for (let seed = 1; seed <= 30; seed++) {
      const out = assemble({ rng: new Rng(seed), pool: "test", v, used: new Set() }, [
        piece("g32", (b) => b.scalar("gold", 32), { word: false }),
        piece("h40", (b) => b.scalar("hp", 40), { word: false }),
      ]);
      expect(out.text).toMatch(/\b(plus|hey|uh|update|atm|tbh)\b/);
      expect(out.label).toEqual({ gold: 32, hp: 40 });
    }
  });
});

describe("dedupe", () => {
  it("catches exact copies, punctuation and case changes, and reorderings", () => {
    expect(normText("Lvl 6, 32g!")).toBe("lvl 6 32g");
    expect(wordSignature("32g, lvl 6")).toBe("32g 6 lvl");
    const d = new Deduper();
    d.add("lvl 6, 32g");
    expect(d.check("lvl 6, 32g")).toBe("exact");
    expect(d.check("Lvl 6 32g")).toBe("near");
    expect(d.check("32g lvl 6")).toBe("near");
    expect(d.check("lvl 7, 32g")).toBeNull();
  });
});

describe("stats", () => {
  it("counts fields, mentions and lengths", () => {
    const meta = { mode: "plain" as const, scenario: "snapshot", templates: ["a"], typos: 0 };
    const s = splitStats(
      [
        { text: "lvl 6, 2 bows", label: { level: 6, set: [{ name: "bows", count: 2 }] }, meta },
        { text: "u", label: { undo: true }, meta: { ...meta, mode: "undo", scenario: "undo" } },
        { text: "should I roll?", label: {}, meta: { ...meta, scenario: "distractor", typos: 1 } },
      ],
      v,
    );
    expect(s.examples).toBe(3);
    expect(s.emptyLabels).toBe(1);
    expect(s.examplesPerField).toMatchObject({ level: 1, set: 1, undo: 1, gold: 0 });
    expect(s.fieldCoverage.level).toBe(33.3);
    expect(s.mentions).toMatchObject({ total: 1, withCount: 1, withStars: 0, byKind: { component: 1 } });
    expect(s.examplesWithTypos).toBe(1);
    expect(s.length.chars).toMatchObject({ min: 1, max: 14 });
    // "u" is 1 word, "should I roll?" 3, "lvl 6, 2 bows" 4.
    expect(s.length.wordHistogram).toMatchObject({ "1": 1, "2-3": 1, "4-6": 1, "7-10": 0 });
    expect(s.length.words).toMatchObject({ min: 1, p50: 3, max: 4 });
    expect(s.byMode).toEqual({ plain: 2, undo: 1 });
  });
});

describe("generate", () => {
  const small = () => generate({ seed: 3, train: 400, test: 150 });
  const g = small();

  it("is the same for the same seed", () => {
    const again = small();
    expect(again.train.map((r) => r.text)).toEqual(g.train.map((r) => r.text));
    expect(again.test.map((r) => r.target)).toEqual(g.test.map((r) => r.target));
  });

  it("makes the requested counts, with every label valid and its target serialized", () => {
    expect(g.train).toHaveLength(400);
    expect(g.test).toHaveLength(150);
    for (const r of [...g.train, ...g.test]) {
      expect(StateUpdateSchema.safeParse(r.label).success, r.text).toBe(true);
      expect(r.target).toBe(serialize(r.label));
    }
    expect(g.train[0].id).toBe("train-000001");
    expect(g.test.at(-1)!.id).toBe("test-000150");
  });

  it("keeps the splits apart: no shared text, near or exact, and no shared phrasing", () => {
    const seen = new Deduper();
    g.train.forEach((r) => seen.add(r.text));
    for (const r of g.test) expect(seen.check(r.text), r.text).toBeNull();
    const pools = new Map(
      (Object.values(T) as unknown[])
        .filter((x): x is Template<unknown>[] => Array.isArray(x) && !!(x as Template<unknown>[])[0]?.id)
        .flat()
        .map((t) => [t.id, t.pool]),
    );
    for (const [split, other] of [
      ["train", "test"],
      ["test", "train"],
    ] as const) {
      for (const r of g[split]) {
        for (const id of r.meta.templates) expect(pools.get(id) ?? "both", `${r.text}: ${id}`).not.toBe(other);
      }
    }
  });

  it("names only things that resolve, with numbers on the right kinds (unless a typo was made)", () => {
    for (const r of [...g.train, ...g.test]) {
      if (r.meta.typos) continue;
      for (const list of ["set", "remove", "add", "craft"] as const) {
        for (const m of r.label[list] ?? []) {
          const id = resolveName(v.lexicon, m.name);
          expect(id, `${r.text}: ${m.name}`).not.toBeNull();
          const kind = v.byId.get(id!)!.kind;
          if (m.stars) expect(kind, r.text).toBe("unit");
          if (m.at) expect(kind, r.text).toBe("augment");
          if (m.count) expect(["component", "item"], r.text).toContain(kind);
          if (list === "craft" && r.meta.mode === "plain") expect(kind, r.text).toBe("item");
        }
      }
    }
  });

  it("keeps scalars in range for the stage", () => {
    for (const r of g.train) {
      const { level, stage } = r.label;
      if (level !== undefined && stage !== undefined && Number(stage[0]) === 2) expect(level).toBeLessThanOrEqual(5);
    }
  });
});
