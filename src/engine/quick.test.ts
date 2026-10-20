import { describe, expect, it } from "vitest";
import aliasesJson from "@/data/aliases.json";
import { AliasesSchema } from "@/data/schema";
import { catalog, economyModel } from "./fixtures";
import { QuickLexicon, advanceRound, runQuick, type QuickState } from "./quick";

const ctx = {
  catalog,
  lexicon: new QuickLexicon(catalog, AliasesSchema.parse(aliasesJson)),
  model: economyModel,
  augmentRounds: ["2-1", "3-2", "4-2"],
};
const start: QuickState = {
  components: {},
  items: [],
  board: [],
  stars: {},
  augments: [],
  level: 4,
  gold: null,
  goldEstimated: false,
  hp: null,
  stage: null,
};
const run = (input: string, state: Partial<QuickState> = {}) => runQuick(input, { ...start, ...state }, ctx);

describe("quick bar", () => {
  it("reads gold, level, HP and round in one line", () => {
    const r = run("52 l7 h64 4-2");
    expect(r.ok).toBe(true);
    expect(r.state).toMatchObject({ gold: 52, level: 7, hp: 64, stage: "4-2" });
    expect(run("g30 lv6 hp80 30g").state).toMatchObject({ gold: 30, level: 6, hp: 80 });
  });

  it("rejects out-of-range numbers and rounds that do not exist", () => {
    expect(run("250").ok).toBe(false);
    expect(run("l11").ok).toBe(false);
    expect(run("h101").ok).toBe(false);
    expect(run("9-9").ok).toBe(false);
  });

  it("matches names however they are typed, over several words, and by prefix", () => {
    const r = run("kha'zix KHAZIX rek sai master yi");
    expect(r.state.board).toEqual(["DA_18_KhaZix", "DA_18_RekSai", "DA_18_MasterYi_AD"]);
    expect(r.steps.map((s) => s.ok)).toEqual([true, false, true, true]); // the second Kha'Zix is already on the board
    expect(run("tear of the goddess infinity edge guinsoo").state).toMatchObject({
      components: { TearOfTheGoddess: 1 },
      items: ["DA_InfinityEdge", "DA_GuinsoosRageblade"],
    });
  });

  it("knows the shorthand players type", () => {
    expect(run("bf bf glove rod").state.components).toEqual({ BFSword: 2, SparringGloves: 1, NeedlesslyLargeRod: 1 });
    expect(run("ie").state.items).toEqual(["DA_InfinityEdge"]);
  });

  it("uses up the components of an item it can craft, unless told not to", () => {
    const held = { components: { BFSword: 1, SparringGloves: 1, RecurveBow: 1 } };
    const crafted = run("ie", held);
    expect(crafted.state.components).toEqual({ RecurveBow: 1 });
    expect(crafted.steps[0].text).toMatch(/uses/);
    expect(run("+ie", held).state.components).toEqual(held.components);
    // Missing a component: it came from elsewhere, so nothing is used up.
    expect(run("ie", { components: { BFSword: 1 } }).state.components).toEqual({ BFSword: 1 });
    // Two of the same component.
    expect(run("deathblade", { components: { BFSword: 2 } }).state.components).toEqual({});
  });

  it("removes with a minus and says when there is nothing to remove", () => {
    expect(run("-bf", { components: { BFSword: 2 } }).state.components).toEqual({ BFSword: 1 });
    expect(run("-bf").ok).toBe(false);
    expect(run("-ie", { items: ["DA_InfinityEdge", "DA_InfinityEdge"] }).state.items).toEqual(["DA_InfinityEdge"]);
  });

  it("refuses a unit when the board is full, and drops units when the level falls", () => {
    const full = { level: 2, board: ["DA_18_Akali", "DA_18_Camille"] };
    expect(run("leona", full).ok).toBe(false);
    const down = run("l3", { level: 4, board: ["DA_18_Akali", "DA_18_Camille", "DA_18_Leona", "DA_18_Ornn"] });
    expect(down.state.board).toHaveLength(3);
    expect(down.steps[0].text).toMatch(/drops Ornn/);
  });

  it("fills augment picks in order and removes later picks with an earlier one", () => {
    const r = run("caretakers ally pandoras bench");
    expect(r.state.augments).toEqual(["DA_18_CaretakersAlly", "DA_PandorasBench"]);
    expect(r.steps[1].text).toMatch(/3-2 augment/);
    expect(run("-caretakers ally", { augments: r.state.augments }).state.augments).toEqual([]);
  });

  it("picks the base augment over its upgrades, and flags real ambiguity", () => {
    expect(run("heroic grab").state.augments).toEqual(["DA_HeroicGrabBag"]);
    const vague = run("beast within");
    expect(vague.ok).toBe(false);
    expect(vague.steps[0].text).toMatch(/could be/);
  });

  it("flags words it does not know and changes nothing for them", () => {
    const r = run("38 zzzz");
    expect(r.ok).toBe(false);
    expect(r.steps.map((s) => s.ok)).toEqual([true, false]);
  });

  it("treats a lone u as undo", () => {
    expect(run("u").undo).toBe(true);
    expect(run("undo").undo).toBe(true);
  });
});

describe("next round", () => {
  it("starts at 2-1 and moves one round on", () => {
    expect(advanceRound(start, economyModel).stage).toBe("2-1");
    expect(advanceRound({ ...start, stage: "3-2" }, economyModel).stage).toBe("3-3");
  });

  it("adds a round's income and marks gold as an estimate", () => {
    const next = advanceRound({ ...start, stage: "3-2", gold: 34 }, economyModel);
    expect(next).toMatchObject({ gold: 42, goldEstimated: true });
    expect(run("n 50", { stage: "3-2", gold: 34 }).state).toMatchObject({ stage: "3-3", gold: 50, goldEstimated: false });
  });

  it("pays nothing on the carousel or without a known gold", () => {
    expect(advanceRound({ ...start, stage: "3-3", gold: 34 }, economyModel)).toMatchObject({ stage: "3-4", gold: 34 });
    expect(advanceRound({ ...start, stage: "3-2" }, economyModel).gold).toBeNull();
  });

  it("sets a unit's star level with *2 or *3, adding or upgrading it", () => {
    const added = run("kha zix*2 ahri");
    expect(added.ok).toBe(true);
    expect(added.state.board).toEqual(["DA_18_KhaZix", "DA_18_Ahri"]);
    expect(added.state.stars).toEqual({ DA_18_KhaZix: 2 });

    const upgraded = run("khazix*3", added.state);
    expect(upgraded.ok).toBe(true);
    expect(upgraded.state.stars).toEqual({ DA_18_KhaZix: 3 });
    expect(run("khazix*1", upgraded.state).state.stars).toEqual({});
    expect(run("khazix*3", upgraded.state).ok).toBe(false);
  });

  it("forgets a unit's star level when it leaves the board", () => {
    const state = { board: ["DA_18_KhaZix", "DA_18_Ahri"], stars: { DA_18_KhaZix: 3 as const, DA_18_Ahri: 2 as const } };
    expect(run("-khazix", state).state.stars).toEqual({ DA_18_Ahri: 2 });
    expect(run("l2", { ...state, board: ["DA_18_Ahri", "DA_18_RekSai", "DA_18_KhaZix"] }).state.stars).toEqual({
      DA_18_Ahri: 2,
    });
  });

  it("rejects a star level on anything but a unit being added", () => {
    expect(run("bf*2").ok).toBe(false);
    expect(run("52*2").ok).toBe(false);
    expect(run("-khazix*2", { board: ["DA_18_KhaZix"] }).ok).toBe(false);
  });
});
