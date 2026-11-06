import type { Comp, ItemStats } from "@/data/schema";
import { isTeamSizeItem } from "./board";
import type { Catalog } from "./catalog";
import type { ItemId } from "./types";

/** A guide builds this artifact or emblem in the comp. */
const KEY_ITEM_BONUS = 0.2;
/**
 * tactics.tools placement gain -> score, for a comp carry and for any other
 * end-board unit. Dawncore lifts Veigar by 0.51 placements, so it is worth ~0.3.
 */
const CARRY_HOLDER_SCALE = 0.6;
const BOARD_HOLDER_SCALE = 0.3;
/** An emblem for a trait the end board already runs this many units of. */
const EMBLEM_TRAIT_UNITS = 2;
const EMBLEM_TRAIT_BONUS = 0.08;
/** A completed item the comp does not list, but one of its carries commonly builds. */
const TOP_ITEM_BONUS = 0.05;
/** Further reasons for the same item count at this fraction of their value. */
const EXTRA_REASON = 0.5;
/** One item can only push so far, and so can a bench full of them. */
const PER_ITEM_CAP = 0.4;
const TOTAL_CAP = 0.45;

/**
 * What kind of unit a crafted item suits. Tank items fit any frontliner; AD and
 * AP items fit carries already building that damage type; "any" items (hybrid
 * or utility) fit any carry. Component rules cannot tell these apart: Steadfast
 * Heart is a tank item but Quicksilver is not, and AD carries build Guinsoo's
 * Rod. A new item after a patch fails a test until it is added here.
 */
export type ItemRole = "tank" | "ad" | "ap" | "any";
export const ITEM_ROLE: Record<string, ItemRole> = {
  DA_AdaptiveHelm: "tank",
  DA_BrambleVest: "tank",
  DA_Crownguard: "tank",
  DA_DragonsClaw: "tank",
  DA_Evenshroud: "tank",
  DA_GargoyleStoneplate: "tank",
  DA_IonicSpark: "tank",
  DA_ProtectorsVow: "tank",
  DA_SpiritVisage: "tank",
  DA_SteadfastHeart: "tank",
  DA_SunfireCape: "tank",
  DA_WarmogsArmor: "tank",
  DA_Bloodthirster: "ad",
  DA_Deathblade: "ad",
  DA_EdgeOfNight: "ad",
  DA_GiantSlayer: "ad",
  DA_InfinityEdge: "ad",
  DA_KrakensFury: "ad",
  DA_LastWhisper: "ad",
  DA_RedBuff: "ad",
  DA_SpearOfShojin: "ad",
  DA_SteraksGage: "ad",
  DA_TitansResolve: "ad",
  DA_ArchangelsStaff: "ap",
  DA_JeweledGauntlet: "ap",
  DA_Morellonomicon: "ap",
  DA_NashorsTooth: "ap",
  DA_RabadonsDeathcap: "ap",
  DA_VoidStaff: "ap",
  DA_BlueBuff: "any",
  DA_GuinsoosRageblade: "any",
  DA_HandOfJustice: "any",
  DA_HextechGunblade: "any",
  DA_Quicksilver: "any",
  DA_StrikersFlail: "any",
  DA_ThiefsGloves: "any",
};

export const NO_ITEM_STATS: ItemStats = {
  source: "https://tactics.tools/items",
  statsUpdated: "",
  fetchedAt: "",
  holders: {},
  topItems: {},
};

const round = (n: number) => n.toFixed(2);

/**
 * How much the held items a comp does not already build (`spare`) pull the
 * player toward it. Artifacts and emblems are the strong signal. An item's
 * best reason counts in full and agreeing reasons add a little more, so a guide
 * pick that is also the unit's best holder outranks either one alone.
 */
export function heldItemEffect(
  comp: Comp,
  spare: ItemId[],
  catalog: Catalog,
  stats: ItemStats,
): { bonus: number; notes: string[] } {
  let bonus = 0;
  const notes: string[] = [];
  for (const id of new Set(spare)) {
    const ranked = holderReasons(comp, id, catalog, stats);
    if (ranked.length) {
      const value = ranked[0].value + EXTRA_REASON * ranked.slice(1).reduce((sum, r) => sum + r.value, 0);
      bonus += Math.min(PER_ITEM_CAP, value);
      notes.push(...ranked.map((r) => r.note));
    }
  }
  return { bonus: Math.min(TOTAL_CAP, bonus), notes };
}

/**
 * Whether some unit in the comp would put a held item to good use: the comp
 * builds it, a guide or tactics.tools puts it on one of its units, the comp
 * runs the emblem's trait, or one of its units builds it in any guide or
 * commonly on tactics.tools. Failing that, its role decides (see ITEM_ROLE):
 * tank items fit any frontline, and Rabadon's suits any AP carry but not an AD
 * one. Unknown items get the benefit of the doubt.
 */
export function hasGoodHolder(
  comp: Comp,
  id: ItemId,
  catalog: Catalog,
  stats: ItemStats,
  /** Unit id -> items guides give it across every comp. */
  guideUse: Map<string, Set<ItemId>> = new Map(),
): boolean {
  const item = catalog.holdable(id);
  if (!item) return true;
  // An extra board slot helps every comp.
  if (isTeamSizeItem(id)) return true;
  if (comp.targetItems.some((t) => t.item === id)) return true;
  if (holderReasons(comp, id, catalog, stats).length) return true;
  if (item.kind !== "item") return false;
  if (comp.endBoard.some((u) => stats.topItems[u]?.includes(id) || guideUse.get(u)?.has(id))) return true;
  const role = ITEM_ROLE[id];
  if (!role || role === "any") return true;
  if (role === "tank") return comp.frontline.length > 0;
  // The carries' damage type, read from the AD and AP items the comp gives them.
  const carryRoles = new Set(comp.targetItems.filter((t) => comp.carries.includes(t.unit)).map((t) => ITEM_ROLE[t.item]));
  return carryRoles.has(role);
}

/** Why a comp wants a held item it does not already build, strongest first. */
function holderReasons(
  comp: Comp,
  id: ItemId,
  catalog: Catalog,
  stats: ItemStats,
): { value: number; note: string }[] {
  const item = catalog.holdable(id);
  if (!item) return [];
  // Best value per reason kind, so one unit's several stats do not stack.
  const reasons = new Map<string, { value: number; note: string }>();
  const consider = (kind: string, value: number, note: string) => {
    if (value > (reasons.get(kind)?.value ?? 0)) reasons.set(kind, { value, note });
  };

  const key = comp.keyItems.find((k) => k.item === id);
  if (key) {
    consider("guide", KEY_ITEM_BONUS, `TFT Academy builds ${item.name} on ${unitName(catalog, key.unit)} in this comp.`);
  }

  for (const { unit, delta } of stats.holders[id] ?? []) {
    const scale = comp.carries.includes(unit)
      ? CARRY_HOLDER_SCALE
      : comp.endBoard.includes(unit)
        ? BOARD_HOLDER_SCALE
        : 0;
    consider(
      "holder",
      -delta * scale,
      `${item.name} is a top pick for ${unitName(catalog, unit)} (${round(delta)} average placement on tactics.tools).`,
    );
  }

  if (item.kind === "emblem") {
    const trait = item.name.replace(/ Emblem$/, "");
    const count = comp.endBoard.filter((u) => catalog.traitsOf(u).includes(trait)).length;
    if (count >= EMBLEM_TRAIT_UNITS) {
      consider("trait", EMBLEM_TRAIT_BONUS, `${item.name} adds to this comp's ${count} ${trait} units.`);
    }
  }

  if (item.kind === "item") {
    const user = comp.carries.find((u) => stats.topItems[u]?.includes(id));
    if (user) consider("top", TOP_ITEM_BONUS, `${unitName(catalog, user)} often builds ${item.name}.`);
  }

  return [...reasons.values()].sort((a, b) => b.value - a.value);
}

/**
 * Artifacts and emblems among `spare` that one of the comp's units would wear,
 * so they take one of that unit's item slots: the unit a guide puts it on, or
 * else the comp carry tactics.tools rates highest with it.
 */
export function slotFillers(
  comp: Comp,
  spare: ItemId[],
  catalog: Catalog,
  stats: ItemStats,
): { item: ItemId; unit: string }[] {
  return spare.flatMap((id) => {
    const kind = catalog.holdable(id)?.kind;
    if (kind !== "artifact" && kind !== "emblem") return [];
    const unit =
      comp.keyItems.find((k) => k.item === id)?.unit ??
      (stats.holders[id] ?? []).find((h) => comp.carries.includes(h.unit))?.unit;
    return unit ? [{ item: id, unit }] : [];
  });
}

function unitName(catalog: Catalog, id: string): string {
  return catalog.hasUnit(id) ? catalog.unit(id).name : id;
}
