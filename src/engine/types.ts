import type { Comp, Tier } from "@/data/schema";
import type { StyleOutlook } from "./economy";

export type ComponentId = string;
export type UnitId = string;
export type ItemId = string;
export type AugmentId = string;

/** A unit's star level; 1 is a single copy. */
export type StarLevel = 1 | 2 | 3;
export const STAR_LEVELS: StarLevel[] = [1, 2, 3];

/** Component id -> how many the player holds. */
export type ComponentBag = Record<ComponentId, number>;

export interface ScoutState {
  /** Unit id -> number of opponents seen holding or playing it. */
  contested: Record<UnitId, number>;
}

export interface GameState {
  components: ComponentBag;
  /** Completed items, artifacts and emblems already in hand; repeats allowed. */
  items: ItemId[];
  /** Units on the player's board right now; updated as the game goes on. */
  board: UnitId[];
  /** Board unit -> its star level when above 1; a unit missing here is 1-star. */
  stars: Record<UnitId, StarLevel>;
  augments: AugmentId[];
  scout: ScoutState;
  /** Player level; the board counts for more as it rises. */
  level: number;
  /** Gold, HP and the current round ("4-2"); null when the player has not said. */
  gold: number | null;
  hp: number | null;
  stage: string | null;
}

/** A target item with its recipe resolved against the catalog. */
export interface TargetEntry {
  item: ItemId;
  unit: UnitId;
  weight: number;
  components: [ComponentId, ComponentId];
}

export interface BuiltItem extends TargetEntry {
  /** Components consumed to craft it; empty if the player already holds the item. */
  uses: ComponentId[];
  held?: boolean;
  /** Set when a held artifact or emblem (`item`) fills this target's slot instead of its own item. */
  replaces?: ItemId;
}

/** A target item that is not built: what is already in hand and what is still needed. */
export interface PendingItem extends TargetEntry {
  have: ComponentId[];
  need: ComponentId[];
}

export interface Allocation {
  built: BuiltItem[];
  pending: PendingItem[];
  leftover: ComponentBag;
  /** Built weight plus partial credit for leftover components. */
  value: number;
}

export type Fit = "S" | "A" | "B" | "C" | "D";
export type RecTag = "lock-in" | "flex-enabler";

export interface Recommendation {
  comp: Comp;
  tier: Tier;
  score: number;
  fit: Fit;
  coverage: number;
  allocation: Allocation;
  augmentBonus: number;
  augmentNotes: string[];
  /** Pull from held artifacts, emblems and items the comp does not already build. */
  itemBonus: number;
  itemNotes: string[];
  scoutPenalty: number;
  /** Board units that appear in this comp's opener or end board. */
  boardMatches: UnitId[];
  boardBonus: number;
  /** Taken off a reroll comp when the board has none of its carries. */
  rerollPenalty: number;
  /** Added to a reroll comp whose carry is already 2- or 3-star on the board. */
  starBonus: number;
  /** The carry that earned `starBonus`, and its star level. */
  starredCarry: { unit: UnitId; stars: StarLevel } | null;
  /** Held items no unit in this comp would use well, one entry per copy. */
  orphanItems: ItemId[];
  orphanPenalty: number;
  /** Why a taken augment rules this comp out; empty while it is playable. */
  unplayable: string[];
  /** Whether the player's gold, level, HP and stage can reach this comp's style; null while unknown. */
  economy: StyleOutlook | null;
  tags: RecTag[];
}

/** A component worth hitting next for one comp. */
export interface HitTarget {
  component: ComponentId;
  /** Increase in the comp's weighted item progress. */
  gain: number;
  /** Items that become buildable that were not before. */
  unlocks: ItemId[];
  /** A still-missing item this component goes into, when it completes nothing yet. */
  toward?: ItemId;
}

export interface AugmentOutcome {
  augment: AugmentId;
  ranking: Recommendation[];
  topChanged: boolean;
}

export interface CarrySwap {
  comp: Comp;
  sharedItems: ItemId[];
}
