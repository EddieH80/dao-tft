import economyJson from "@/data/economy.json";
import snapshot from "@/data/snapshot.json";
import { EconomyModelSchema, type Comp, type ItemStats, type Snapshot, type TargetItem, type Tier } from "@/data/schema";
import { Catalog } from "./catalog";
import { TftEngine } from "./router";
import type { ComponentBag, GameState } from "./types";

export const catalog = new Catalog(snapshot as Snapshot);

/** Short names for real Set 18 completed items, used by test comps. */
export const ITEM = {
  infinityEdge: "DA_InfinityEdge", // BFSword + SparringGloves
  bloodthirster: "DA_Bloodthirster", // BFSword + NegatronCloak
  deathblade: "DA_Deathblade", // BFSword + BFSword
  giantSlayer: "DA_GiantSlayer", // RecurveBow + BFSword
  rabadons: "DA_RabadonsDeathcap", // Rod + Rod
  archangels: "DA_ArchangelsStaff", // Rod + Tear
  blueBuff: "DA_BlueBuff", // Tear + Tear
  jeweled: "DA_JeweledGauntlet", // Rod + Gloves
  warmogs: "DA_WarmogsArmor", // Belt + Belt
  sunfire: "DA_SunfireCape", // Chain + Belt
  gargoyle: "DA_GargoyleStoneplate", // Chain + Cloak
  bramble: "DA_BrambleVest", // Chain + Chain
} as const;

export function makeComp(
  slug: string,
  tier: Tier,
  carry: string,
  items: [item: string, weight: number][],
  extra: Partial<Comp> = {},
): Comp {
  const targetItems: TargetItem[] = items.map(([item, weight]) => ({ item, unit: carry, weight }));
  return {
    slug,
    name: slug,
    tier,
    style: "fast-8",
    summary: "test comp",
    playWhen: ["always"],
    carries: [carry],
    frontline: [`${slug}-tank`],
    endBoard: [carry],
    targetItems,
    opener: { units: [carry], note: "" },
    slams: [],
    stages: [{ stage: "Stage 1", tip: "test" }],
    augmentModifiers: [],
    frontlineAlternatives: [],
    keyItems: [],
    ...extra,
  };
}

export const emptyState = (components: ComponentBag = {}): GameState => ({
  components,
  items: [],
  board: [],
  stars: {},
  augments: [],
  scout: { contested: {} },
  level: 8,
  gold: null,
  hp: null,
  stage: null,
});

export const TEST_COMPS: Comp[] = [
  makeComp("ap-mage", "S", "u-mage", [
    [ITEM.rabadons, 3],
    [ITEM.archangels, 3],
    [ITEM.blueBuff, 2],
  ]),
  makeComp("ad-sniper", "A", "u-sniper", [
    [ITEM.infinityEdge, 3],
    [ITEM.giantSlayer, 3],
    [ITEM.bloodthirster, 2],
  ]),
  makeComp("tank-line", "B", "u-tank", [
    [ITEM.warmogs, 3],
    [ITEM.sunfire, 3],
    [ITEM.gargoyle, 2],
  ]),
  makeComp("ad-bruiser", "C", "u-bruiser", [
    [ITEM.deathblade, 3],
    [ITEM.bloodthirster, 3],
    [ITEM.infinityEdge, 2],
  ]),
];

export const economyModel = EconomyModelSchema.parse(economyJson);
export const testEngine = (comps: Comp[] = TEST_COMPS, stats?: ItemStats) =>
  new TftEngine(catalog, comps, stats, economyModel);
