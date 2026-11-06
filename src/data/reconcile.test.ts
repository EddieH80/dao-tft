import { describe, expect, it } from "vitest";
import { diffSnapshots, reconcileFile } from "./reconcile";
import type { Snapshot } from "./schema";

const entry = (id: string, name: string) => ({ id, name, icon: "" });
const snapshot = (augments: [string, string][], units: [string, string][] = []): Snapshot => ({
  set: 18,
  source: "",
  fetchedAt: "",
  components: [],
  items: [],
  uncraftables: [],
  units: units.map(([id, name]) => ({ ...entry(id, name), cost: 1, traits: [] })),
  traits: [],
  augments: augments.map(([id, name]) => entry(id, name)),
});

const old = snapshot(
  [
    ["DA_PandorasItemsII", "Pandora's Items II"],
    ["DA_PandorasItemsIII", "Pandora's Items III"],
    ["DA_HeartOfSteel", "Heart of Steel"],
    ["DA_HedgeFund", "Hedge Fund"],
    ["DA_Twin", "Twin"],
  ],
  [["DA_18_Azir", "Azir"]],
);
const next = snapshot([
  ["DA_PandorasItemsIIMinus", "Pandora's Items II"],
  ["DA_PandorasItemsIII", "Pandora's Items III"],
  ["DA_HedgeFund", "Hedge Fund"],
  ["DA_TwinA", "Twin"],
  ["DA_TwinB", "Twin"],
]);
const diff = diffSnapshots(old, next);

const pool = (ids: string[]) =>
  JSON.stringify({ patch: "18.4b", augments: ids.map((id) => ({ id, tier: "gold" })) }, null, 2) + "\n";

describe("diffSnapshots", () => {
  it("treats a gone id with one same-name newcomer as renamed", () => {
    expect(diff.renamed).toEqual(new Map([["DA_PandorasItemsII", "DA_PandorasItemsIIMinus"]]));
  });

  it("treats a gone id with no, or more than one, same-name newcomer as removed", () => {
    expect([...diff.removed.keys()]).toEqual(["DA_18_Azir", "DA_HeartOfSteel", "DA_Twin"]);
  });
});

describe("reconcileFile", () => {
  it("rewrites a renamed id and nothing that merely starts with it", () => {
    const text = pool(["DA_PandorasItemsII", "DA_PandorasItemsIII"]);
    const out = reconcileFile("augments-2-1.json", text, diff);
    expect(out.text).toBe(pool(["DA_PandorasItemsIIMinus", "DA_PandorasItemsIII"]));
    expect(out.changes).toEqual([
      "augments-2-1.json: renamed DA_PandorasItemsII (Pandora's Items II) to DA_PandorasItemsIIMinus",
    ]);
  });

  it("drops a removed augment from a stage pool", () => {
    const out = reconcileFile("augments-3-2.json", pool(["DA_HardCommit", "DA_HeartOfSteel", "DA_HedgeFund"]), diff);
    expect(out.text).toBe(pool(["DA_HardCommit", "DA_HedgeFund"]));
    expect(out.changes).toEqual(["augments-3-2.json: dropped DA_HeartOfSteel (Heart of Steel), no longer in the game"]);
  });

  const compAugments = (lines: string[]) =>
    ['{', '  "rules": [],', '  "comps": {', '    "a-comp": [', ...lines, "    ]", "  }", "}", ""].join("\n");
  const line = (id: string, last = false) => `      {"augment": "${id}", "strength": "good"}${last ? "" : ","}`;

  it("drops a removed augment from the middle of a comp list, keeping the layout", () => {
    const text = compAugments([line("DA_HedgeFund"), line("DA_HeartOfSteel"), line("DA_PandorasItemsIII", true)]);
    const out = reconcileFile("comp-augments.json", text, diff);
    expect(out.text).toBe(compAugments([line("DA_HedgeFund"), line("DA_PandorasItemsIII", true)]));
  });

  it("drops a removed augment at the end of a comp list and the comma before it", () => {
    const text = compAugments([line("DA_HedgeFund"), line("DA_HeartOfSteel", true)]);
    const out = reconcileFile("comp-augments.json", text, diff);
    expect(out.text).toBe(compAugments([line("DA_HedgeFund", true)]));
    expect(() => JSON.parse(out.text)).not.toThrow();
  });

  it("drops an alias that points at a removed id", () => {
    const aliases = (lines: string[]) => ['{', '  "note": "",', '  "aliases": {', ...lines, "  }", "}", ""].join("\n");
    const text = aliases(['    "hf": "DA_HedgeFund",', "", '    "hos": "DA_HeartOfSteel"']);
    const out = reconcileFile("aliases.json", text, diff);
    expect(out.text).toBe(aliases(['    "hf": "DA_HedgeFund"', ""]));
  });

  it("leaves a removed unit in a hand-written comp for a person to fix", () => {
    const text = JSON.stringify({ carries: ["DA_18_Azir"] }, null, 2) + "\n";
    expect(reconcileFile("comps/azir-rammus-reroll.json", text, diff)).toEqual({ text, changes: [] });
  });

  it("leaves an id no snapshot had, so validation still catches typos", () => {
    const text = pool(["DA_HeartOfSteal"]);
    expect(reconcileFile("augments-2-1.json", text, diff)).toEqual({ text, changes: [] });
  });
});
