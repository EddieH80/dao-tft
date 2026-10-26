import { describe, expect, it } from "vitest";
import type { Comp, ItemStats } from "@/data/schema";
import { ITEM, TEST_COMPS, catalog, emptyState, makeComp, testEngine } from "./fixtures";
import { ITEM_ROLE, NO_ITEM_STATS } from "./items";
import { AUGMENT_CAP } from "./augments";
import { carrySwaps, openFrontline, scoutFromOpponents, scoutPenalty } from "./scout";
import { ORPHAN_ITEM_PENALTY, REROLL_MISS, REROLL_WINDOW, STAR_BONUS, boardWeight, starBonus, demoteOneFit, fitFor, isRuledOut } from "./router";
import type { GameState, Recommendation } from "./types";

describe("rank", () => {
  it("puts the comp whose items the components build on top", () => {
    const engine = testEngine();
    const ap = engine.rank(emptyState({ NeedlesslyLargeRod: 2, TearOfTheGoddess: 2 }));
    expect(ap[0].comp.slug).toBe("ap-mage");
    expect(ap[0].allocation.built.map((b) => b.item)).toContain(ITEM.rabadons);

    const ad = engine.rank(emptyState({ BFSword: 1, SparringGloves: 1, RecurveBow: 1, NegatronCloak: 1 }));
    expect(ad[0].comp.slug).toBe("ad-sniper");
  });

  it("ranks every comp and orders them by score", () => {
    const ranking = testEngine().rank(emptyState({ GiantsBelt: 2, ChainVest: 1 }));
    expect(ranking).toHaveLength(TEST_COMPS.length);
    for (let i = 1; i < ranking.length; i++) expect(ranking[i - 1].score).toBeGreaterThanOrEqual(ranking[i].score);
    expect(ranking[0].comp.slug).toBe("tank-line");
  });

  it("lets a higher tier win when two comps match equally", () => {
    // Both want Bloodthirster as their only reachable item.
    const ranking = testEngine().rank(emptyState({ BFSword: 1, NegatronCloak: 1 }));
    const idx = (slug: string) => ranking.findIndex((r) => r.comp.slug === slug);
    expect(idx("ad-sniper")).toBeLessThan(idx("ad-bruiser"));
  });

  it("explains what is missing for comps it cannot finish", () => {
    const [top] = testEngine().rank(emptyState({ NeedlesslyLargeRod: 1 }));
    expect(top.comp.slug).toBe("ap-mage");
    expect(top.allocation.pending.some((p) => p.have.includes("NeedlesslyLargeRod"))).toBe(true);
  });

  it("maps scores to tier-style fit labels", () => {
    expect(fitFor(1)).toBe("S");
    expect(fitFor(0.7)).toBe("A");
    expect(fitFor(0.5)).toBe("B");
    expect(fitFor(0.3)).toBe("C");
    expect(fitFor(0.1)).toBe("D");
  });
});

describe("hitNext", () => {
  it("shows which component completes one of the comp's items, best first", () => {
    const engine = testEngine();
    const sniper = TEST_COMPS.find((c) => c.slug === "ad-sniper")!;
    const hits = engine.hitNext(sniper, emptyState({ BFSword: 1 }));
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.find((t) => t.component === "SparringGloves")?.unlocks).toContain(ITEM.infinityEdge);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].gain).toBeGreaterThanOrEqual(hits[i].gain);
  });

  it("only lists components that help that comp", () => {
    const engine = testEngine();
    for (const comp of TEST_COMPS) {
      expect(engine.hitNext(comp, emptyState({ BFSword: 1 })).every((t) => t.gain > 0)).toBe(true);
    }
  });

  it("names the item a component builds toward when it completes nothing", () => {
    const engine = testEngine();
    const mage = TEST_COMPS.find((c) => c.slug === "ap-mage")!;
    const hits = engine.hitNext(mage, emptyState());
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((t) => t.unlocks.length === 0 && t.toward)).toBe(true);
  });
});

describe("augments", () => {
  const withMods = () => {
    const comps = TEST_COMPS.map((c) =>
      c.slug === "tank-line"
        ? { ...c, augmentModifiers: [{ augment: "aug-tank", bonus: 0.3, note: "Loves tank items", unplayable: false }] }
        : c,
    );
    return testEngine(comps);
  };
  const state = emptyState({ BFSword: 1, SparringGloves: 1, NegatronCloak: 1, GiantsBelt: 1 });

  it("applies the modifier and records why", () => {
    const ranking = withMods().rank({ ...state, augments: ["aug-tank"] });
    const tank = ranking.find((r) => r.comp.slug === "tank-line")!;
    expect(tank.augmentBonus).toBeCloseTo(0.3);
    expect(tank.augmentNotes).toEqual(["Loves tank items"]);
  });

  it("flags a comp lifted into the top 3 as a flex enabler", () => {
    // The tank comp has nothing to build from these components, so it starts last.
    const engine = withMods();
    const bag = emptyState({ BFSword: 1, SparringGloves: 1, NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 });
    expect(engine.rank(bag).findIndex((r) => r.comp.slug === "tank-line")).toBe(3);
    const ranking = engine.rank({ ...bag, augments: ["aug-tank"] });
    const tank = ranking.find((r) => r.comp.slug === "tank-line")!;
    expect(ranking.indexOf(tank)).toBeLessThan(3);
    expect(tank.tags).toContain("flex-enabler");
  });

  it("does not flag a comp lifted by less than a strong pick", () => {
    // Just enough to pass ad-bruiser (0.17) into third, but short of a strong pick.
    const comps = TEST_COMPS.map((c) =>
      c.slug === "tank-line" ? { ...c, augmentModifiers: [{ augment: "aug-generic", bonus: 0.19, note: "", unplayable: false }] } : c,
    );
    const bag = emptyState({ BFSword: 1, SparringGloves: 1, NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 });
    const ranking = testEngine(comps).rank({ ...bag, augments: ["aug-generic"] });
    expect(ranking.findIndex((r) => r.comp.slug === "tank-line")).toBeLessThan(3);
    expect(ranking.every((r) => !r.tags.includes("flex-enabler"))).toBe(true);
  });

  it("flags a clearly leading boosted comp as a lock-in", () => {
    const comps = TEST_COMPS.map((c) =>
      c.slug === "ad-sniper"
        ? { ...c, augmentModifiers: [{ augment: "aug-ad", bonus: 0.4, note: "AD all day", unplayable: false }] }
        : c,
    );
    const ranking = testEngine(comps).rank({ ...emptyState({ BFSword: 1, SparringGloves: 1 }), augments: ["aug-ad"] });
    expect(ranking[0].comp.slug).toBe("ad-sniper");
    expect(ranking[0].tags).toContain("lock-in");
  });

  it("adds several picks together, up to a cap", () => {
    const mods = ["a", "b", "c"].map((augment) => ({ augment, bonus: 0.3, note: augment, unplayable: false }));
    const comps = TEST_COMPS.map((c) => (c.slug === "tank-line" ? { ...c, augmentModifiers: mods } : c));
    const tank = (augments: string[]) =>
      testEngine(comps).rank({ ...state, augments }).find((r) => r.comp.slug === "tank-line")!;
    expect(tank(["a"]).augmentBonus).toBeCloseTo(0.3);
    expect(tank(["a", "b", "c"]).augmentBonus).toBeCloseTo(AUGMENT_CAP);
    expect(tank(["a", "b", "c"]).augmentNotes).toEqual(["a", "b", "c"]);
  });

  it("tags nothing without augments", () => {
    expect(testEngine().rank(state).every((r) => r.tags.length === 0)).toBe(true);
  });

  it("previews each offered augment without changing the state", () => {
    const engine = withMods();
    const before = engine.rank(state)[0].comp.slug;
    const outcomes = engine.adviseAugments(state, ["aug-tank", "aug-unknown"]);
    expect(outcomes[0].topChanged).toBe(outcomes[0].ranking[0].comp.slug !== before);
    expect(outcomes[1].topChanged).toBe(false);
    expect(state.augments).toEqual([]);
  });
});

describe("scout", () => {
  const sniper = TEST_COMPS.find((c) => c.slug === "ad-sniper")!;

  it("penalises comps whose carry is contested, with diminishing returns", () => {
    const none = scoutPenalty(sniper, { contested: {} });
    const one = scoutPenalty(sniper, { contested: { "u-sniper": 1 } });
    const lots = scoutPenalty(sniper, { contested: { "u-sniper": 9 } });
    const three = scoutPenalty(sniper, { contested: { "u-sniper": 3 } });
    expect(none).toBe(0);
    expect(one).toBeGreaterThan(none);
    expect(lots).toBe(three);
  });

  it("lowers a contested comp's score by exactly its penalty", () => {
    const engine = testEngine();
    const bag = { BFSword: 1, SparringGloves: 1, RecurveBow: 1, NegatronCloak: 1 };
    const before = engine.rank(emptyState(bag)).find((r) => r.comp.slug === "ad-sniper")!;
    const scout = { contested: { "u-sniper": 2 } };
    const after = engine.rank({ ...emptyState(bag), scout }).find((r) => r.comp.slug === "ad-sniper")!;
    expect(after.scoutPenalty).toBeCloseTo(scoutPenalty(sniper, scout));
    expect(before.score - after.score).toBeCloseTo(after.scoutPenalty);
  });

  it("moves a contested comp below an equally good one", () => {
    // Same items, so only the tier (S 1.0 vs A 0.85) separates them until someone contests the S carry.
    const items: [string, number][] = [[ITEM.warmogs, 3]];
    const engine = testEngine([makeComp("s-comp", "S", "u-s", items), makeComp("a-comp", "A", "u-a", items)]);
    const bag = emptyState({ GiantsBelt: 2 });
    expect(engine.rank(bag)[0].comp.slug).toBe("s-comp");
    const contested = engine.rank({ ...bag, scout: { contested: { "u-s": 2 } } });
    expect(contested[0].comp.slug).toBe("a-comp");
  });

  it("counts each opponent's comp units as contested", () => {
    const [a, b] = TEST_COMPS;
    const { contested } = scoutFromOpponents([a, undefined, a, b]);
    expect(contested[a.carries[0]]).toBe(2);
    expect(contested[b.carries[0]]).toBe(a.endBoard.includes(b.carries[0]) ? 3 : 1);
    expect(scoutFromOpponents([undefined]).contested).toEqual({});
  });

  it("suggests uncontested carries that share items", () => {
    const engine = testEngine();
    const scout = { contested: { "u-sniper": 2 } };
    const ranking = engine.rank({ ...emptyState({ BFSword: 1, SparringGloves: 1 }), scout });
    const swaps = carrySwaps(sniper, ranking, scout);
    expect(swaps.map((s) => s.comp.slug)).toEqual(["ad-bruiser"]);
    expect(swaps[0].sharedItems).toEqual(expect.arrayContaining([ITEM.infinityEdge, ITEM.bloodthirster]));
  });

  it("does not suggest a swap into another contested carry", () => {
    const scout = { contested: { "u-sniper": 2, "u-bruiser": 1 } };
    const ranking = testEngine().rank({ ...emptyState({ BFSword: 1 }), scout });
    expect(carrySwaps(sniper, ranking, scout)).toEqual([]);
  });

  it("only offers frontline alternatives nobody else holds", () => {
    const comp = makeComp("x", "A", "u-x", [[ITEM.warmogs, 3]], { frontlineAlternatives: ["t1", "t2", "t3"] });
    expect(openFrontline(comp, { contested: { t2: 2 } })).toEqual(["t1", "t3"]);
  });
});

describe("board", () => {
  const KARMA = "DA_Karma18"; // Blossom / Spellweaver
  const AHRI = "DA_18_Ahri"; // Blossom / Spellweaver
  const YORICK = "DA_18_Yorick"; // Blossom / Juggernaut / Summoner
  const KOBUKO = "DA_18_Kobuko"; // Sprykin / Brawler
  const items: [string, number][] = [[ITEM.archangels, 3]];
  const bloom = makeComp("bloom", "A", AHRI, items, { endBoard: [AHRI, KARMA], opener: { units: [KARMA], note: "" } });
  const bag = { NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 };
  const rank = (board: string[]) =>
    testEngine([bloom]).rank({ ...emptyState(bag), board })[0];

  it("adds nothing without a board", () => {
    const rec = rank([]);
    expect(rec.boardBonus).toBe(0);
    expect(rec.boardMatches).toEqual([]);
  });

  it("gives full credit to units the comp plays", () => {
    const rec = rank([KARMA]);
    expect(rec.boardBonus).toBeCloseTo(0.15);
    expect(rec.boardMatches).toEqual([KARMA]);
  });

  it("gives half credit to a unit that only shares a trait", () => {
    const rec = rank([YORICK]);
    expect(rec.boardBonus).toBeCloseTo(0.075);
    expect(rec.boardMatches).toEqual([]);
  });

  it("gives no credit to unrelated or unknown units", () => {
    expect(rank([KOBUKO]).boardBonus).toBe(0);
    expect(rank(["not-a-unit"]).boardBonus).toBe(0);
  });

  it("averages over the whole board", () => {
    // One matching unit out of two is half the full bonus.
    expect(rank([KARMA, KOBUKO]).boardBonus).toBeCloseTo(0.075);
  });

  it("breaks a tie between otherwise equal comps", () => {
    const other = makeComp("other", "A", "u-other", items);
    const ranking = testEngine([other, bloom]).rank({ ...emptyState(bag), board: [KARMA] });
    expect(ranking[0].comp.slug).toBe("bloom");
  });

  it("counts for less while the board is still early", () => {
    const at = (level: number) => testEngine([bloom]).rank({ ...emptyState(bag), board: [KARMA], level })[0];
    expect(at(4).boardBonus).toBeCloseTo(boardWeight(4));
    expect(at(4).boardBonus).toBeLessThan(at(7).boardBonus);
    expect(at(7).boardBonus).toBeLessThan(at(8).boardBonus);
    expect(at(10).boardBonus).toBeCloseTo(0.15);
  });

  it("loses to a held artifact early, but not once the board is committed", () => {
    // Same items and tier; the board fits "bloom" perfectly, the artifact suits "other"'s carry far better.
    // Ahri can still hold it, so "bloom" is not penalised for a dead item.
    const other = makeComp("other", "A", "u-other", items);
    const holders = [
      { unit: "u-other", delta: -0.2 },
      { unit: AHRI, delta: -0.01 },
    ];
    const stats = { ...NO_ITEM_STATS, holders: { DA_Artifact_Dawncore: holders } };
    const state = { ...emptyState(bag), board: [KARMA], items: ["DA_Artifact_Dawncore"] };
    const top = (level: number) => testEngine([bloom, other], stats).rank({ ...state, level })[0].comp.slug;
    expect(top(4)).toBe("other");
    expect(top(8)).toBe("bloom");
  });
});

describe("reroll comps", () => {
  const AHRI = "DA_18_Ahri";
  const KARMA = "DA_Karma18";
  const KOBUKO = "DA_18_Kobuko";
  const items: [string, number][] = [[ITEM.archangels, 3]];
  const reroll = makeComp("reroll", "A", AHRI, items, { style: "reroll-2", endBoard: [AHRI, KARMA] });
  const bag = { NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 };
  const rank = (comp: Comp, board: string[]) => testEngine([comp]).rank({ ...emptyState(bag), board })[0];

  it("drops one fit grade when the board has none of its carries", () => {
    // The items are complete, so only the missing carry holds it back.
    const rec = rank(reroll, [KOBUKO]);
    expect(rec.rerollPenalty).toBeCloseTo(REROLL_MISS);
    expect(rank({ ...reroll, style: "fast-8" }, [KOBUKO]).fit).toBe("S");
    expect(rec.fit).toBe("A");
  });

  it("counts only carries, not the rest of the comp", () => {
    expect(rank(reroll, [KARMA]).rerollPenalty).toBeCloseTo(REROLL_MISS);
    expect(rank(reroll, [KARMA, AHRI]).rerollPenalty).toBe(0);
  });

  it("drops exactly one grade from any score", () => {
    for (const score of [1.3, 1.05, 0.85, 0.7, 0.65, 0.5, 0.25, 0.1]) {
      const grades = ["S", "A", "B", "C", "D"];
      const expected = grades[Math.min(grades.indexOf(fitFor(score)) + 1, grades.length - 1)];
      expect(fitFor(demoteOneFit(score))).toBe(expected);
      expect(demoteOneFit(score)).toBeLessThan(score);
    }
  });

  it("leaves an empty board and non-reroll comps alone", () => {
    expect(rank(reroll, []).rerollPenalty).toBe(0);
    expect(rank({ ...reroll, style: "fast-8" }, [KOBUKO]).rerollPenalty).toBe(0);
  });

  it("ranks below a comp one tier lower that the items fit just as well", () => {
    const sTierReroll = { ...reroll, tier: "S" as const };
    const other = makeComp("other", "A", "u-other", items);
    const ranking = testEngine([sTierReroll, other]).rank({ ...emptyState(bag), board: [KOBUKO] });
    expect(ranking[0].comp.slug).toBe("other");
  });

  it("rises with a 2- or 3-star carry on the board", () => {
    const starred = (comp: Comp, stars: GameState["stars"]) =>
      testEngine([comp]).rank({ ...emptyState(bag), board: [AHRI, KARMA], stars })[0];
    const flat = starred(reroll, {});
    expect(flat.starBonus).toBe(0);
    expect(flat.starredCarry).toBeNull();
    expect(starred(reroll, { [AHRI]: 2 }).score).toBeCloseTo(flat.score + STAR_BONUS[2]);
    const three = starred(reroll, { [AHRI]: 3 });
    expect(three.starBonus).toBeCloseTo(REROLL_MISS);
    expect(three.starredCarry).toEqual({ unit: AHRI, stars: 3 });
  });

  it("gives a 3-star 3-cost carry two fit grades", () => {
    const KHAZIX = "DA_18_KhaZix"; // 3-cost
    const r3 = makeComp("r3", "A", KHAZIX, items, { style: "reroll-3" });
    const at = (stars: GameState["stars"]) =>
      testEngine([r3]).rank({ ...emptyState(bag), board: [KHAZIX], stars })[0];
    expect(at({ [KHAZIX]: 3 }).starBonus).toBeCloseTo(2 * REROLL_MISS);
    expect(at({ [KHAZIX]: 3 }).score).toBeCloseTo(at({}).score + 2 * REROLL_MISS);
    expect(at({ [KHAZIX]: 2 }).starBonus).toBeCloseTo(STAR_BONUS[2]);
    // Only 3-costs: a 3-star 1-, 2- or 4-cost carry stays at one grade.
    for (const cost of [1, 2, 4]) expect(starBonus(3, cost)).toBeCloseTo(REROLL_MISS);
  });

  it("picks the carry whose stars add the most", () => {
    const KHAZIX = "DA_18_KhaZix";
    const pair = makeComp("pair", "A", AHRI, items, { style: "reroll-3", carries: [AHRI, KHAZIX] });
    const rec = testEngine([pair]).rank({
      ...emptyState(bag),
      board: [AHRI, KHAZIX],
      stars: { [AHRI]: 3, [KHAZIX]: 3 },
    })[0];
    expect(rec.starredCarry).toEqual({ unit: KHAZIX, stars: 3 });
  });

  it("counts stars only on a reroll comp's carries", () => {
    const rank3 = (comp: Comp, stars: GameState["stars"]) =>
      testEngine([comp]).rank({ ...emptyState(bag), board: [AHRI, KARMA], stars })[0];
    expect(rank3(reroll, { [KARMA]: 3 }).starBonus).toBe(0);
    expect(rank3({ ...reroll, style: "fast-8" }, { [AHRI]: 3 }).starBonus).toBe(0);
  });

  it("lets a 3-star carry lift a reroll comp over a higher tier with the same items", () => {
    const other = makeComp("other", "A", "u-other", items);
    const bTier = { ...reroll, tier: "B" as const };
    const state = { ...emptyState(bag), board: [AHRI], level: 5 };
    expect(testEngine([bTier, other]).rank(state)[0].comp.slug).toBe("other");
    expect(testEngine([bTier, other]).rank({ ...state, stars: { [AHRI]: 3 } })[0].comp.slug).toBe("reroll");
  });
});

describe("held artifacts and emblems", () => {
  const DAWNCORE = "DA_Artifact_Dawncore";
  const stats = (holders: ItemStats["holders"], topItems: ItemStats["topItems"] = {}): ItemStats => ({
    ...NO_ITEM_STATS,
    holders,
    topItems,
  });
  const find = (ranking: Recommendation[], slug: string) => ranking.find((r) => r.comp.slug === slug)!;
  const held = (items: string[]) => ({ ...emptyState({ BFSword: 1 }), items });

  it("push the comp a guide builds them in", () => {
    const comps = [...TEST_COMPS, makeComp("dawn", "C", "u-dawn", [[ITEM.bramble, 3]], { keyItems: [{ item: DAWNCORE, unit: "u-dawn" }] })];
    const without = find(testEngine(comps).rank(emptyState({ BFSword: 1 })), "dawn");
    const withIt = find(testEngine(comps).rank(held([DAWNCORE])), "dawn");
    expect(withIt.itemBonus).toBeCloseTo(0.2);
    // It also fills the carry's only slot, so the comp is now fully covered.
    expect(withIt.coverage).toBe(1);
    expect(withIt.score - without.score).toBeGreaterThan(0.2);
    expect(withIt.itemNotes[0]).toContain("Dawncore");
  });

  it("fill one of the wearer's item slots, the one components cannot build", () => {
    const comp = makeComp("yi", "A", "u-yi", [[ITEM.infinityEdge, 3], [ITEM.rabadons, 3]], {
      keyItems: [{ item: "DA_Artifact_NavoriFlickerblade", unit: "u-yi" }],
    });
    const state = { ...emptyState({ BFSword: 1, SparringGloves: 1 }), items: ["DA_Artifact_NavoriFlickerblade"] };
    const rec = testEngine([comp]).rank(state)[0];
    expect(rec.allocation.built).toContainEqual(
      expect.objectContaining({ item: "DA_Artifact_NavoriFlickerblade", replaces: ITEM.rabadons, held: true }),
    );
    expect(rec.allocation.built.map((b) => b.item)).toContain(ITEM.infinityEdge);
    expect(rec.coverage).toBe(1);
  });

  it("fill a carry's slot when only tactics.tools rates them on it", () => {
    const comp = makeComp("veigar", "A", "u-veigar", [[ITEM.rabadons, 3]]);
    const stats = { ...NO_ITEM_STATS, holders: { [DAWNCORE]: [{ unit: "u-veigar", delta: -0.5 }] } };
    const rec = testEngine([comp], stats).rank(held([DAWNCORE]))[0];
    expect(rec.allocation.built[0]).toMatchObject({ item: DAWNCORE, replaces: ITEM.rabadons });
  });

  it("take no slot on a unit the comp builds nothing for", () => {
    const comp = makeComp("jugg", "A", "u-carry", [[ITEM.rabadons, 3]], {
      keyItems: [{ item: "DA_18_EmblemJuggernaut", unit: "u-kennen" }],
    });
    const rec = testEngine([comp]).rank(held(["DA_18_EmblemJuggernaut"]))[0];
    expect(rec.allocation.built).toEqual([]);
    expect(rec.itemBonus).toBeCloseTo(0.2);
  });

  it("weigh tactics.tools holders by how much they help, carries over the rest of the board", () => {
    const comps = [
      makeComp("carry", "A", "u-veigar", [[ITEM.rabadons, 3]]),
      makeComp("board", "A", "u-other", [[ITEM.rabadons, 3]], { endBoard: ["u-other", "u-veigar"] }),
    ];
    const ranking = testEngine(comps, stats({ [DAWNCORE]: [{ unit: "u-veigar", delta: -0.5 }] })).rank(held([DAWNCORE]));
    expect(find(ranking, "carry").itemBonus).toBeCloseTo(0.3);
    expect(find(ranking, "board").itemBonus).toBeCloseTo(0.15);
    expect(ranking[0].comp.slug).toBe("carry");
  });

  it("add a little more when a guide and the stats agree, up to a cap", () => {
    const keyItems = [{ item: DAWNCORE, unit: "u-veigar" }];
    const comp = makeComp("both", "A", "u-veigar", [[ITEM.rabadons, 3]], { keyItems });
    const agree = (delta: number) =>
      testEngine([comp], stats({ [DAWNCORE]: [{ unit: "u-veigar", delta }] })).rank(held([DAWNCORE]))[0].itemBonus;
    expect(agree(-0.2)).toBeCloseTo(0.2 + 0.5 * 0.12);
    expect(agree(-0.9)).toBeCloseTo(0.4);
  });

  it("favour comps that already run the emblem's trait", () => {
    const juggernauts = catalog.snapshot.units.filter((u) => u.traits.includes("Juggernaut")).map((u) => u.id);
    const comp = makeComp("jugg", "B", juggernauts[0], [[ITEM.warmogs, 3]], { endBoard: juggernauts.slice(0, 2) });
    const rec = testEngine([comp]).rank(held(["DA_18_EmblemJuggernaut"]))[0];
    expect(rec.itemBonus).toBeGreaterThan(0);
    expect(rec.itemNotes[0]).toContain("Juggernaut");
  });

  it("give a small push for a held item a carry commonly builds", () => {
    const comp = makeComp("ad", "A", "u-sniper", [[ITEM.infinityEdge, 3]]);
    const rec = testEngine([comp], stats({}, { "u-sniper": [ITEM.deathblade] })).rank(held([ITEM.deathblade]))[0];
    expect(rec.itemBonus).toBeCloseTo(0.05);
  });

  it("do not count twice for an item the comp already builds", () => {
    const rec = find(testEngine(TEST_COMPS, stats({}, { "u-mage": [ITEM.rabadons] })).rank(held([ITEM.rabadons])), "ap-mage");
    expect(rec.itemBonus).toBe(0);
  });

  it("are capped across a bench of artifacts", () => {
    const items = ["DA_Artifact_Dawncore", "DA_Artifact_LudensTempest", "DA_Artifact_Manazane"];
    const comp = makeComp("dawn", "C", "u-dawn", [[ITEM.bramble, 3]], {
      keyItems: items.map((item) => ({ item, unit: "u-dawn" })),
    });
    expect(testEngine([comp]).rank(held(items))[0].itemBonus).toBeCloseTo(0.45);
  });
});

describe("held completed items", () => {
  it("count as built without using components", () => {
    const state = { ...emptyState({ BFSword: 1, SparringGloves: 1 }), items: [ITEM.rabadons] };
    const mage = testEngine().rank(state).find((r) => r.comp.slug === "ap-mage")!;
    const held = mage.allocation.built.find((b) => b.item === ITEM.rabadons);
    expect(held).toMatchObject({ held: true, uses: [] });
    expect(mage.allocation.leftover).toEqual({ BFSword: 1, SparringGloves: 1 });
  });

  it("lift the comp that wants them", () => {
    const engine = testEngine();
    const base = emptyState({ BFSword: 1, SparringGloves: 1 });
    const before = engine.rank(base).find((r) => r.comp.slug === "ap-mage")!.score;
    const after = engine.rank({ ...base, items: [ITEM.rabadons] }).find((r) => r.comp.slug === "ap-mage")!.score;
    expect(after).toBeGreaterThan(before);
  });

  it("do not count as progress for the next component", () => {
    const engine = testEngine();
    const mage = TEST_COMPS.find((c) => c.slug === "ap-mage")!;
    const hits = engine.hitNext(mage, { ...emptyState(), items: [ITEM.rabadons] });
    expect(hits.flatMap((t) => t.unlocks)).not.toContain(ITEM.rabadons);
  });
});

describe("unplayable augments", () => {
  const nsnp = { augment: "aug-lock", bonus: 0, note: "Locked in.", unplayable: true };
  const comps = TEST_COMPS.map((c) => (c.slug === "ap-mage" ? { ...c, augmentModifiers: [nsnp] } : c));
  const state = emptyState({ NeedlesslyLargeRod: 2, TearOfTheGoddess: 2 });

  it("sorts the comp below every playable one and grades it D", () => {
    const engine = testEngine(comps);
    expect(engine.rank(state)[0].comp.slug).toBe("ap-mage");
    const ranking = engine.rank({ ...state, augments: ["aug-lock"] });
    const mage = ranking.at(-1)!;
    expect(mage.comp.slug).toBe("ap-mage");
    expect(mage.fit).toBe("D");
    expect(mage.unplayable).toEqual(["Locked in."]);
    expect(mage.augmentBonus).toBe(0);
  });

  it("does nothing until the augment is taken", () => {
    expect(testEngine(comps).rank(state)[0].unplayable).toEqual([]);
  });
});

describe("held items without a holder", () => {
  // An AP comp with a frontline: Deathblade is an AD item none of its units want.
  const items: [string, number][] = [[ITEM.archangels, 3]];
  const bag = { NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 };
  const mage = makeComp("mage", "S", "u-mage", items);
  const rank = (held: string[], stats?: ItemStats, comp = mage) =>
    testEngine([comp], stats).rank({ ...emptyState(bag), items: held })[0];

  it("drops a comp at least one and a half grades for an item none of its units use", () => {
    const clean = rank([]);
    const dead = rank([ITEM.deathblade]);
    expect(dead.orphanItems).toEqual([ITEM.deathblade]);
    expect(dead.orphanPenalty).toBeCloseTo(ORPHAN_ITEM_PENALTY);
    expect(clean.score - dead.score).toBeGreaterThanOrEqual(1.5 * 0.2 - 1e-9);
    // 1.0 sits high in S, so it lands in A; an A-tier comp at 0.85 sits low in S and falls to B.
    expect([clean.fit, dead.fit]).toEqual(["S", "A"]);
    const aTier = makeComp("mage", "A", "u-mage", items);
    expect([rank([], undefined, aTier).fit, rank([ITEM.deathblade], undefined, aTier).fit]).toEqual(["S", "B"]);
  });

  it("counts each dead copy", () => {
    expect(rank([ITEM.deathblade, ITEM.deathblade]).orphanPenalty).toBeCloseTo(2 * ORPHAN_ITEM_PENALTY);
  });

  it("lets any frontliner hold a tank item", () => {
    expect(rank([ITEM.bramble]).orphanItems).toEqual([]);
    expect(rank([ITEM.bramble], undefined, { ...mage, frontline: [] }).orphanItems).toEqual([ITEM.bramble]);
  });

  it("lets a carry hold an item of its damage type, and any carry a hybrid item", () => {
    expect(rank([ITEM.rabadons]).orphanItems).toEqual([]);
    expect(rank(["DA_GuinsoosRageblade"]).orphanItems).toEqual([]);
  });

  it("leaves items a unit builds in some guide or commonly on tactics.tools alone", () => {
    const stats = { ...NO_ITEM_STATS, topItems: { "u-mage": [ITEM.deathblade] } };
    expect(rank([ITEM.deathblade], stats).orphanItems).toEqual([]);
    const other = makeComp("other", "B", "u-mage", [[ITEM.deathblade, 3]]);
    const both = testEngine([mage, other]).rank({ ...emptyState(bag), items: [ITEM.deathblade] });
    expect(both.find((r) => r.comp.slug === "mage")!.orphanItems).toEqual([]);
  });

  it("leaves an artifact a unit in the comp wears well alone", () => {
    const stats = { ...NO_ITEM_STATS, holders: { DA_Artifact_Dawncore: [{ unit: "u-mage", delta: -0.3 }] } };
    expect(rank(["DA_Artifact_Dawncore"], stats).orphanItems).toEqual([]);
    expect(rank(["DA_Artifact_Dawncore"]).orphanItems).toEqual(["DA_Artifact_Dawncore"]);
  });
});

describe("ITEM_ROLE", () => {
  it("gives every crafted item in the snapshot a role", () => {
    const missing = catalog.snapshot.items.filter((i) => i.kind === "item" && !ITEM_ROLE[i.id]).map((i) => i.id);
    expect(missing).toEqual([]);
  });
});

describe("economy", () => {
  // Same items and tier, so only the style separates them.
  const items: [string, number][] = [[ITEM.archangels, 3]];
  const fast9 = makeComp("fast9", "S", "u-mage", items, { style: "fast-9" });
  const reroll = makeComp("reroll", "A", "u-mage", items, { style: "reroll-2" });
  const bag = { NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 };
  const rank = (economy: Partial<Pick<GameState, "level" | "gold" | "hp" | "stage">>) =>
    testEngine([fast9, reroll]).rank({ ...emptyState(bag), ...economy });

  it("changes nothing while gold or stage is unknown", () => {
    const ranking = rank({ level: 8, hp: 20 });
    expect(ranking[0].comp.slug).toBe("fast9");
    expect(ranking.every((r) => r.economy === null)).toBe(true);
  });

  it("grades a style the player cannot reach D and lists it last, with the reason", () => {
    const ranking = rank({ level: 8, gold: 30, hp: 20, stage: "4-2" });
    const last = ranking.at(-1)!;
    expect(last.comp.slug).toBe("fast9");
    expect(last.fit).toBe("D");
    expect(last.economy?.verdict).toBe("unrealistic");
    expect(isRuledOut(last)).toBe(true);
  });

  it("drops a style the player can only just reach one grade", () => {
    // Level 5 on 3-5 can reach a 3-cost reroll only by 4-1, past its usual 3-5.
    const r3 = makeComp("r3", "S", "u-mage", items, { style: "reroll-3" });
    const engine = testEngine([r3]);
    const state = { ...emptyState(bag), level: 5, hp: 100, stage: "3-5" };
    const known = engine.rank({ ...state, gold: 60 })[0];
    const unknown = engine.rank(state)[0];
    expect(known.economy?.verdict).toBe("stretch");
    expect([unknown.fit, known.fit]).toEqual(["S", "A"]);
  });
});

describe("levelling past a reroll", () => {
  const KARMA = "DA_Karma18"; // 1-cost
  const CAITLYN = "DA_18_Caitlyn"; // 2-cost
  const KHAZIX = "DA_18_KhaZix"; // 3-cost
  const KOBUKO = "DA_18_Kobuko";
  const items: [string, number][] = [[ITEM.archangels, 3]];
  const bag = { NeedlesslyLargeRod: 1, TearOfTheGoddess: 1 };
  const reroll = (cost: 1 | 2 | 3, carry: string) =>
    makeComp(`r${cost}`, "S", carry, items, { style: `reroll-${cost}` as const });
  const at = (comp: Comp, state: Partial<GameState>) =>
    testEngine([comp]).rank({ ...emptyState(bag), board: comp.carries.slice(), ...state })[0];

  it("drops a 1-cost reroll two grades at level 6 from 3-2 without a 3-star carry", () => {
    const r1 = reroll(1, KARMA);
    const before = at(r1, { level: 6, stage: "3-1" });
    const after = at(r1, { level: 6, stage: "3-2" });
    expect(before.levelPenalty).toBe(0);
    expect(after.levelPenalty).toBeGreaterThan(0);
    expect(after.fit).toBe("B");
    expect(before.fit).toBe("S");
    expect(at(r1, { level: 5, stage: "3-2" }).levelPenalty).toBe(0);
  });

  it("keeps applying in later rounds", () => {
    const r1 = reroll(1, KARMA);
    expect(at(r1, { level: 6, stage: "4-1" }).levelPenalty).toBeGreaterThan(0);
    expect(at(reroll(3, KHAZIX), { level: 9, stage: "5-1" }).levelPenalty).toBeGreaterThan(0);
  });

  it("uses each cost's own level and round", () => {
    expect(REROLL_WINDOW).toEqual({ 1: { level: 6, stage: "3-2" }, 2: { level: 7, stage: "3-5" }, 3: { level: 8, stage: "4-1" } });
    const r2 = reroll(2, CAITLYN);
    expect(at(r2, { level: 7, stage: "3-5" }).levelPenalty).toBeGreaterThan(0);
    expect(at(r2, { level: 6, stage: "3-5" }).levelPenalty).toBe(0);
    expect(at(r2, { level: 7, stage: "3-3" }).levelPenalty).toBe(0);
    const r3 = reroll(3, KHAZIX);
    expect(at(r3, { level: 8, stage: "4-1" }).levelPenalty).toBeGreaterThan(0);
    expect(at(r3, { level: 8, stage: "3-5" }).levelPenalty).toBe(0);
  });

  it("spares a comp whose own carry is already 3-star", () => {
    const r1 = reroll(1, KARMA);
    expect(at(r1, { level: 6, stage: "3-2", stars: { [KARMA]: 3 } }).levelPenalty).toBe(0);
    expect(at(r1, { level: 6, stage: "3-2", stars: { [KARMA]: 2 } }).levelPenalty).toBeGreaterThan(0);
    // A 3-star unit the comp does not play does not save it.
    const other = at(r1, { level: 6, stage: "3-2", board: [KARMA, KOBUKO], stars: { [KOBUKO]: 3 } });
    expect(other.levelPenalty).toBeGreaterThan(0);
  });

  it("leaves non-reroll comps, and an unknown round, alone", () => {
    expect(at({ ...reroll(1, KARMA), style: "fast-8" }, { level: 8, stage: "4-1" }).levelPenalty).toBe(0);
    expect(at(reroll(1, KARMA), { level: 8, stage: null }).levelPenalty).toBe(0);
  });

  it("does not also count out-levelling as a stretch economy", () => {
    // Level 7 is two past a 1-cost reroll's roll level, which the economy calls a stretch on its own.
    const rec = at(reroll(1, KARMA), { level: 7, stage: "3-2", gold: 50, hp: 80 });
    expect(rec.economy?.overlevelled).toBe(true);
    expect(rec.stretched).toBe(false);
    expect(rec.fit).toBe("B");
    // Before 3-2 the stretch still counts.
    expect(at(reroll(1, KARMA), { level: 7, stage: "3-1", gold: 50, hp: 80 }).stretched).toBe(true);
  });

  describe("on the economy line", () => {
    const economy = { gold: 50, hp: 80 };
    const verdict = (style: string, level: number, stage: string, board: string[] = [], stars = {}) =>
      testEngine([]).styleOutlooks({ ...economy, level, stage }, board, stars).get(style as Comp["style"]);

    it("rules out each reroll from its own level and round", () => {
      expect(verdict("reroll-1", 6, "3-2")).toMatchObject({ verdict: "unrealistic", levelledPast: true });
      expect(verdict("reroll-1", 6, "3-1")?.levelledPast).toBeUndefined();
      expect(verdict("reroll-1", 5, "3-2")?.levelledPast).toBeUndefined();
      expect(verdict("reroll-2", 7, "3-5")?.verdict).toBe("unrealistic");
      expect(verdict("reroll-2", 7, "3-3")?.levelledPast).toBeUndefined();
      expect(verdict("reroll-3", 8, "4-1")?.verdict).toBe("unrealistic");
      expect(verdict("reroll-3", 8, "3-5")?.levelledPast).toBeUndefined();
      expect(verdict("reroll-1", 6, "3-2")!.note).toMatch(/3-star 1-cost/);
    });

    it("keeps a reroll open with a 3-star unit of its cost", () => {
      expect(verdict("reroll-1", 6, "3-2", [KARMA], { [KARMA]: 3 })?.levelledPast).toBeUndefined();
      expect(verdict("reroll-1", 6, "3-2", [KARMA], { [KARMA]: 2 })?.levelledPast).toBe(true);
      expect(verdict("reroll-1", 6, "3-2", [CAITLYN], { [CAITLYN]: 3 })?.levelledPast).toBe(true);
    });

    it("still only drops the comp two grades instead of ruling it out", () => {
      const rec = at(reroll(1, KARMA), { level: 6, stage: "3-2", ...economy });
      expect(rec.economy?.verdict).not.toBe("unrealistic");
      expect(rec.levelPenalty).toBeGreaterThan(0);
    });
  });
});
