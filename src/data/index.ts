import { Catalog } from "@/engine/catalog";
import aliasesJson from "./aliases.json";
import { TftEngine } from "@/engine/router";
import augments21Json from "./augments-2-1.json";
import augments32Json from "./augments-3-2.json";
import augments42Json from "./augments-4-2.json";
import { applyCompAugments } from "./compAugments";
import compAugmentsJson from "./comp-augments.json";
import compsTftAcademy from "./comps-tftacademy.json";
import economyJson from "./economy.json";
import itemStatsJson from "./item-stats.json";
import {
  AliasesSchema,
  CompAugmentsSchema,
  CompSchema,
  EconomyModelSchema,
  ItemStatsSchema,
  StageAugmentsSchema,
  type Comp,
  type Snapshot,
} from "./schema";
import snapshotJson from "./snapshot.json";
import { validateAliases, validateComps } from "./validate";

import apheliosFlex from "./comps/aphelios-flex.json";
import asheFast9 from "./comps/ashe-fast-9.json";
import azirRammusReroll from "./comps/azir-rammus-reroll.json";
import caitlynReroll from "./comps/caitlyn-reroll.json";
import defenderCassiopeia from "./comps/defender-cassiopeia.json";
import dravenFast9 from "./comps/draven-fast-9.json";
import floraMalphite from "./comps/flora-malphite.json";
import invokerMorganaAhri from "./comps/invoker-morgana-ahri.json";
import khazixReroll from "./comps/khazix-reroll.json";
import primalMalphite from "./comps/primal-malphite.json";
import riftbeastReroll from "./comps/riftbeast-reroll.json";
import veigarReroll from "./comps/veigar-reroll.json";

export const snapshot = snapshotJson as Snapshot;
export const catalog = new Catalog(snapshot);

// Parsing here means a malformed comp fails `next build` instead of reaching a player.
const raw: unknown[] = [
  apheliosFlex,
  asheFast9,
  azirRammusReroll,
  caitlynReroll,
  defenderCassiopeia,
  dravenFast9,
  floraMalphite,
  invokerMorganaAhri,
  khazixReroll,
  primalMalphite,
  riftbeastReroll,
  veigarReroll,
];
// Converted from TFT Academy's tier list by scripts/fetch-tftacademy.ts.
raw.push(...compsTftAcademy.comps);
const curatedKeyItems: Record<string, Comp["keyItems"]> = compsTftAcademy.curatedKeyItems;
const parsed: Comp[] = raw.map((c) => {
  const comp = CompSchema.parse(c);
  const extra = curatedKeyItems[comp.slug] ?? [];
  return extra.length ? { ...comp, keyItems: [...comp.keyItems, ...extra] } : comp;
});

// Augment picks live in one hand-edited file so they are easy to update each patch.
const ownLists = raw.filter((c) => "augmentModifiers" in (c as object)).map((c) => (c as Comp).slug);
const withAugments = applyCompAugments(parsed, CompAugmentsSchema.parse(compAugmentsJson), catalog, ownLists);
export const comps: Comp[] = withAugments.comps;

/** Quick bar shorthand, hand-edited. */
export const aliases = AliasesSchema.parse(aliasesJson);

const problems = [...withAugments.problems, ...validateComps(comps, catalog), ...validateAliases(aliases, catalog)];
if (problems.length) throw new Error(`Invalid comp data:\n${problems.join("\n")}`);

/** The three augment selections, in the order they are offered. */
export const augmentStages = (
  [
    ["2-1", augments21Json],
    ["3-2", augments32Json],
    ["4-2", augments42Json],
  ] as const
).map(([stage, json]) => {
  const pool = StageAugmentsSchema.parse(json);
  const unknown = pool.augments.filter((a) => !catalog.hasAugment(a.id)).map((a) => a.id);
  if (unknown.length) throw new Error(`Unknown ${stage} augments: ${unknown.join(", ")}`);
  return { stage, ...pool };
});

export const itemStats = ItemStatsSchema.parse(itemStatsJson);
export const economyModel = EconomyModelSchema.parse(economyJson);
export const engine = new TftEngine(catalog, comps, itemStats, economyModel);

/** The patch the comps, and so the recommendations, are for: TFT Academy's tier list, refreshed daily. */
export const patch = compsTftAcademy.patch;

export const compBySlug = (slug: string) => comps.find((c) => c.slug === slug);
