import { describe, expect, it } from "vitest";
import { aliases, augmentStages, catalog, comps } from "./index";
import compAugmentsJson from "./comp-augments.json";
import { applyCompAugments } from "./compAugments";
import { AUGMENT_STRENGTH_BONUS, CompAugmentsSchema, CompSchema, MAX_COMP_AUGMENTS, type Comp } from "./schema";
import { validateAliases, validateComps } from "./validate";

describe("curated comps", () => {
  it("are all consistent with the Community Dragon snapshot", () => {
    expect(validateComps(comps, catalog)).toEqual([]);
  });

  it("cover a spread of tiers", () => {
    const tiers = new Set(comps.map((c) => c.tier));
    expect(comps.length).toBeGreaterThanOrEqual(8);
    expect(tiers.has("S") || tiers.has("A")).toBe(true);
  });

  it("only use recipes that exist and weigh items 1 to 3", () => {
    for (const comp of comps) {
      for (const t of comp.targetItems) {
        expect(catalog.item(t.item).components).toHaveLength(2);
        expect(t.weight).toBeGreaterThanOrEqual(1);
        expect(t.weight).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe.each(augmentStages)("$stage augment list", ({ augments }) => {
  it("only lists augments in the snapshot, once each", () => {
    const ids = augments.map((a) => a.id);
    expect(ids.filter((id) => !catalog.hasAugment(id))).toEqual([]);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("validateComps", () => {
  const good = comps[0];

  it("reports a unit or item that no longer exists after a patch", () => {
    const stale = {
      ...good,
      slug: "stale",
      carries: ["DA_Removed_Unit"],
      targetItems: [{ item: "DA_Removed_Item", unit: good.carries[0], weight: 3 }],
    };
    const problems = validateComps([stale], catalog);
    expect(problems).toContain('stale: unknown unit "DA_Removed_Unit" in carries');
    expect(problems).toContain('stale: unknown item "DA_Removed_Item" in targetItems');
  });

  it("reports an unknown augment", () => {
    const bad = { ...good, augmentModifiers: [{ augment: "DA_Nope", bonus: 0.1, note: "x", unplayable: false }] };
    expect(validateComps([bad], catalog).some((p) => p.includes('unknown augment "DA_Nope"'))).toBe(true);
  });

  it("reports duplicate slugs and carries missing from the board", () => {
    const problems = validateComps([good, { ...good, endBoard: [good.endBoard[1]] }], catalog);
    expect(problems.some((p) => p.includes("duplicate slug"))).toBe(true);
    expect(problems.some((p) => p.includes("is not on the end board"))).toBe(true);
  });
});

describe("CompSchema", () => {

  it("rejects an item weight outside 1 to 3", () => {
    const bad = { ...comps[0], targetItems: [{ ...comps[0].targetItems[0], weight: 5 }] };
    expect(CompSchema.safeParse(bad).success).toBe(false);
  });
});

describe("comp-augments.json", () => {
  const file = CompAugmentsSchema.parse(compAugmentsJson);

  it("gives every comp at least one augment", () => {
    expect(comps.filter((c) => !c.augmentModifiers.length).map((c) => c.slug)).toEqual([]);
  });

  it("explains every core and strong pick", () => {
    const unexplained = Object.entries(file.comps).flatMap(([slug, list]) =>
      list.filter((e) => (e.strength === "core" || e.strength === "strong") && !e.note).map((e) => `${slug} ${e.augment}`),
    );
    expect(unexplained).toEqual([]);
  });
});

describe("applyCompAugments", () => {
  const comp: Comp = { ...comps[0], style: "fast-8" };
  const file = (entries: unknown[], rules: unknown[] = []) =>
    CompAugmentsSchema.parse({ ...compAugmentsJson, comps: { [comp.slug]: entries }, rules });

  it("rejects a comp list longer than the cap", () => {
    const many = Array.from({ length: MAX_COMP_AUGMENTS + 1 }, () => ({ augment: "DA_18_BigGrabBag", strength: "good" }));
    expect(() => file(many)).toThrow();
  });

  it("applies a rule to every comp it matches, unless the comp lists the augment itself", () => {
    const rule = { augment: "DA_NoScoutNoPivot", when: { styles: ["fast-8"] }, strength: "unplayable", note: "Locked in." };
    const reroll: Comp = { ...comp, slug: "a-reroll", style: "reroll-2" };
    const { comps: out } = applyCompAugments([comp, reroll], file([], [rule]), catalog);
    expect(out[0].augmentModifiers).toEqual([{ augment: "DA_NoScoutNoPivot", bonus: 0, note: "Locked in.", unplayable: true }]);
    expect(out[1].augmentModifiers).toEqual([]);

    const own = file([{ augment: "DA_NoScoutNoPivot", strength: "good", note: "Fine here." }], [rule]);
    expect(applyCompAugments([comp], own, catalog).comps[0].augmentModifiers).toEqual([
      { augment: "DA_NoScoutNoPivot", bonus: AUGMENT_STRENGTH_BONUS.good, note: "Fine here.", unplayable: false },
    ]);
  });

  it("reports a rule for an unknown augment", () => {
    const rule = { augment: "DA_Nope", when: { styles: ["fast-8"] }, strength: "unplayable", note: "x" };
    expect(applyCompAugments([comp], file([], [rule]), catalog).problems).toContain(
      'comp-augments.json rules: unknown augment "DA_Nope"',
    );
  });

  it("turns strengths into bonuses and fills in a note", () => {
    const { comps: out, problems } = applyCompAugments(
      [comp],
      file([
        { augment: "DA_18_BigGrabBag", strength: "core", note: "Custom." },
        { augment: "DA_SmallGrabBag", strength: "avoid" },
      ]),
      catalog,
    );
    expect(problems).toEqual([]);
    expect(out[0].augmentModifiers).toEqual([
      { augment: "DA_18_BigGrabBag", bonus: AUGMENT_STRENGTH_BONUS.core, note: "Custom.", unplayable: false },
      {
        augment: "DA_SmallGrabBag",
        bonus: AUGMENT_STRENGTH_BONUS.avoid,
        note: "Small Grab Bag works against this comp.",
        unplayable: false,
      },
    ]);
  });

  it("reports unknown augments, repeats, unknown comps and lists left in comp files", () => {
    const bad = CompAugmentsSchema.parse({
      ...compAugmentsJson,
      comps: {
        [comp.slug]: [
          { augment: "DA_Nope", strength: "good" },
          { augment: "DA_18_BigGrabBag", strength: "good" },
          { augment: "DA_18_BigGrabBag", strength: "core" },
        ],
        "renamed-comp": [],
      },
    });
    const { problems, unused } = applyCompAugments([comp], bad, catalog, [comp.slug]);
    expect(problems).toEqual([
      `${comp.slug}: augmentModifiers belong in src/data/comp-augments.json, not the comp file`,
      `comp-augments.json ${comp.slug}: unknown augment "DA_Nope"`,
      `comp-augments.json ${comp.slug}: "DA_18_BigGrabBag" is listed twice`,
    ]);
    // A comp that left the tier list keeps its entry without failing the refresh.
    expect(unused).toEqual(["renamed-comp"]);
  });

  it("falls back to TFT Academy's picks for a comp with no entry", () => {
    const fresh: Comp = { ...comp, slug: "new-comp", academyAugments: ["DA_18_BigGrabBag"] };
    const { comps: out, problems } = applyCompAugments([fresh], file([]), catalog);
    expect(problems).toEqual([]);
    expect(out[0].augmentModifiers).toEqual([
      {
        augment: "DA_18_BigGrabBag",
        bonus: AUGMENT_STRENGTH_BONUS.good,
        note: `${catalog.augmentName("DA_18_BigGrabBag")} is a good augment for this comp.`,
        unplayable: false,
      },
    ]);

    const curated = { ...fresh, slug: comp.slug };
    const own = file([{ augment: "DA_SmallGrabBag", strength: "core", note: "Ours." }]);
    expect(applyCompAugments([curated], own, catalog).comps[0].augmentModifiers.map((m) => m.augment)).toEqual([
      "DA_SmallGrabBag",
    ]);
  });

  it("rejects a strength it does not know", () => {
    expect(() => file([{ augment: "DA_18_BigGrabBag", strength: "great" }])).toThrow();
  });
});

describe("quick bar aliases", () => {
  it("all point at something in the snapshot", () => {
    expect(validateAliases(aliases, catalog)).toEqual([]);
  });

  it("catch an id the snapshot does not have", () => {
    expect(validateAliases({ note: "", aliases: { zz: "DA_NotAThing" } }, catalog)).toHaveLength(1);
  });
});
