import { COMP_STYLES, isReroll, type Comp, type CompStyle, type EconomyModel, type ItemStats, type Tier } from "@/data/schema";
import { allocate, claimHeld, optimisticBound } from "./allocate";
import { augmentEffect, tagRecommendations } from "./augments";
import { Catalog, bagSize, withComponent } from "./catalog";
import { styleOutlook, type Economy, type StyleOutlook } from "./economy";
import { NO_ITEM_STATS, hasGoodHolder, heldItemEffect, slotFillers } from "./items";
import { scoutPenalty } from "./scout";
import type {
  Allocation,
  AugmentId,
  AugmentOutcome,
  BuiltItem,
  ComponentBag,
  Fit,
  GameState,
  HitTarget,
  Recommendation,
  StarLevel,
  TargetEntry,
  UnitId,
} from "./types";

export const TIER_WEIGHT: Record<Tier, number> = { S: 1, A: 0.85, B: 0.7, C: 0.5 };

const FIT_BANDS: [number, Fit][] = [
  [0.85, "S"],
  [0.65, "A"],
  [0.45, "B"],
  [0.25, "C"],
];

export function fitFor(score: number): Fit {
  return FIT_BANDS.find(([min]) => score >= min)?.[1] ?? "D";
}

/**
 * Most a perfectly matching board can add to a comp's score, by player level.
 * Early boards (levels 3-6) are cheap to replace, so items decide the comp;
 * the board only counts fully once it is committed at 8 and above.
 */
export function boardWeight(level: number): number {
  if (level <= 6) return 0.05;
  if (level === 7) return 0.1;
  return 0.15;
}
/** Score between one fit grade and the next. */
const FIT_BAND_GAP = 0.2;
/** How far a reroll comp without its carries falls: one fit grade. */
export const REROLL_MISS = FIT_BAND_GAP;
/**
 * Added to a reroll comp by its best-starred carry. A 3-star carry means the
 * reroll is already paid for, so it lifts the comp a full fit grade; a 2-star
 * one, which a player who is not rerolling also often has, half a grade.
 */
export const STAR_BONUS: Record<StarLevel, number> = { 1: 0, 2: FIT_BAND_GAP / 2, 3: FIT_BAND_GAP };
/** A 3-star 3-cost carry takes far more rolling than a 1- or 2-cost one, so it lifts the comp two fit grades. */
export const THREE_COST_THREE_STAR_BONUS = 2 * FIT_BAND_GAP;

/** What a reroll carry at this star level adds to its comp. */
export function starBonus(stars: StarLevel, cost: number): number {
  return stars === 3 && cost === 3 ? THREE_COST_THREE_STAR_BONUS : STAR_BONUS[stars];
}
/** Taken off for each held item no unit in the comp would use well: one and a half fit grades. */
export const ORPHAN_ITEM_PENALTY = 1.5 * FIT_BAND_GAP;
/** A taken augment or the player's economy rules this comp out; it is graded D and listed last. */
export const isRuledOut = (rec: Recommendation) => rec.unplayable.length > 0 || rec.economy?.verdict === "unrealistic";

/** Taken off a comp that is ruled out, which also sorts it below every playable comp. */
const UNPLAYABLE_DROP = 1;

/**
 * Moves a score down exactly one fit grade. It falls by the band gap when that
 * lands in the next band, and is clamped into that band when it would not
 * (a score above the top band, or rounding at a band edge).
 */
export function demoteOneFit(score: number): number {
  const band = FIT_BANDS.findIndex(([min]) => score >= min);
  if (band === -1) return score - REROLL_MISS;
  const floor = FIT_BANDS[band][0];
  const below = FIT_BANDS[band + 1]?.[0] ?? -Infinity;
  return Math.max(below, Math.min(score - REROLL_MISS, floor - 1e-6));
}
/** Credit for a board unit that is not in the comp but shares a trait with its end board. */
const TRAIT_MATCH = 0.5;

const bagKey = (bag: ComponentBag) =>
  Object.keys(bag)
    .filter((k) => bag[k] > 0)
    .sort()
    .map((k) => `${k}:${bag[k]}`)
    .join(",");

/** Ranks curated comps against what the player is holding right now. */
export class TftEngine {
  private readonly targets = new Map<string, TargetEntry[]>();
  private readonly allocations = new Map<string, Allocation>();
  /** Unit id -> every item any comp's guide gives it, so a held item can find a holder across guides. */
  private readonly guideUse = new Map<string, Set<string>>();

  constructor(
    readonly catalog: Catalog,
    readonly comps: Comp[],
    readonly itemStats: ItemStats = NO_ITEM_STATS,
    /** Without one, the player's gold, HP and stage are ignored. */
    readonly economy?: EconomyModel,
  ) {
    for (const comp of comps) {
      this.targets.set(
        comp.slug,
        comp.targetItems.map((t) => ({
          item: t.item,
          unit: t.unit,
          weight: t.weight,
          components: catalog.item(t.item).components,
        })),
      );
      for (const t of comp.targetItems) {
        if (!this.guideUse.has(t.unit)) this.guideUse.set(t.unit, new Set());
        this.guideUse.get(t.unit)!.add(t.item);
      }
    }
  }

  /** All comps, best first. Augments in `state` re-rank and tag the result. */
  rank(state: GameState): Recommendation[] {
    const baseline = this.rankWith(state, []);
    if (!state.augments.length) return baseline;
    const ranking = this.rankWith(state, state.augments);
    tagRecommendations(ranking, baseline);
    return ranking;
  }

  /**
   * For one comp: which component, hit next (carousel, creep round), moves its
   * items furthest, and what it completes or builds toward. Best first.
   */
  hitNext(comp: Comp, state: GameState): HitTarget[] {
    const before = this.holdings(comp, state.components, state.items).allocation;
    const had = new Set(before.built.map((b) => b.item));
    return this.catalog.componentIds
      .map((component): HitTarget => {
        const after = this.holdings(comp, withComponent(state.components, component), state.items).allocation;
        return {
          component,
          gain: after.value - before.value,
          unlocks: after.built.map((b) => b.item).filter((i) => !had.has(i)),
          toward: before.pending.find((p) => p.need.includes(component))?.item,
        };
      })
      .filter((t) => t.gain > 0)
      .sort((a, b) => b.gain - a.gain || b.unlocks.length - a.unlocks.length);
  }

  /** Re-rank as if each offered augment were picked. */
  adviseAugments(state: GameState, offers: AugmentId[]): AugmentOutcome[] {
    const current = this.rank(state)[0]?.comp.slug;
    return offers.map((augment) => {
      const ranking = this.rank({ ...state, augments: [...state.augments, augment] });
      return { augment, ranking, topChanged: ranking[0]?.comp.slug !== current };
    });
  }

  /** What the player's economy says about each comp style; empty while it is unknown. */
  styleOutlooks(economy: Economy): Map<CompStyle, StyleOutlook> {
    const outlooks = new Map<CompStyle, StyleOutlook>();
    if (!this.economy) return outlooks;
    for (const style of COMP_STYLES) {
      const outlook = styleOutlook(style, economy, this.economy);
      if (outlook) outlooks.set(style, outlook);
    }
    return outlooks;
  }

  private rankWith(state: GameState, augments: AugmentId[]): Recommendation[] {
    const outlooks = this.styleOutlooks(state);
    return this.comps
      .map((comp) => this.evaluate(comp, state, augments, outlooks.get(comp.style) ?? null))
      .sort(
        (a, b) =>
          Number(isRuledOut(a)) - Number(isRuledOut(b)) ||
          b.score - a.score ||
          TIER_WEIGHT[b.tier] - TIER_WEIGHT[a.tier] ||
          a.comp.slug.localeCompare(b.comp.slug),
      );
  }

  private evaluate(
    comp: Comp,
    state: GameState,
    augments: AugmentId[],
    economy: StyleOutlook | null,
  ): Recommendation {
    const { allocation, heldWeight, rest, spare } = this.holdings(comp, state.components, state.items);
    const bound =
      heldWeight +
      optimisticBound(
        rest.map((t) => t.weight),
        bagSize(state.components),
      );
    const coverage = bound > 0 ? Math.min(1, allocation.value / bound) : 0;
    const { bonus, notes, unplayable } = augmentEffect(comp, augments);
    const held = heldItemEffect(comp, spare, this.catalog, this.itemStats);
    const orphanItems = spare.filter((id) => !hasGoodHolder(comp, id, this.catalog, this.itemStats, this.guideUse));
    const orphanPenalty = ORPHAN_ITEM_PENALTY * orphanItems.length;
    const penalty = scoutPenalty(comp, state.scout);
    const { fit: boardFit, matches } = this.boardFit(comp, state.board);
    const boardBonus = boardWeight(state.level) * boardFit;
    const starredCarry = this.starredCarry(comp, state.board, state.stars);
    const starred = starredCarry?.bonus ?? 0;
    const base =
      coverage * TIER_WEIGHT[comp.tier] + bonus + held.bonus + boardBonus + starred - penalty - orphanPenalty;
    const carried = this.missesRerollCarries(comp, state.board) ? demoteOneFit(base) : base;
    const rerollPenalty = base - carried;
    // A style the player's economy can only just reach drops a grade; one it cannot reach is ruled out.
    const playable = economy?.verdict === "stretch" ? demoteOneFit(carried) : carried;
    const ruledOut = unplayable.length > 0 || economy?.verdict === "unrealistic";
    const score = ruledOut ? playable - UNPLAYABLE_DROP : playable;
    return {
      comp,
      tier: comp.tier,
      score,
      fit: ruledOut ? "D" : fitFor(score),
      coverage,
      allocation,
      augmentBonus: bonus,
      augmentNotes: notes,
      itemBonus: held.bonus,
      itemNotes: held.notes,
      scoutPenalty: penalty,
      boardMatches: matches,
      boardBonus,
      rerollPenalty,
      starBonus: starred,
      starredCarry: starredCarry && { unit: starredCarry.unit, stars: starredCarry.stars },
      orphanItems,
      orphanPenalty,
      unplayable,
      economy,
      tags: [],
    };
  }

  /**
   * A reroll comp needs its carries early, so items alone should not sell it
   * to a board that has none of them. An empty board says nothing yet.
   */
  private missesRerollCarries(comp: Comp, board: string[]): boolean {
    return isReroll(comp) && board.length > 0 && !comp.carries.some((c) => board.includes(c));
  }

  /** The reroll comp's board carry whose star level adds the most, when it adds anything. */
  private starredCarry(
    comp: Comp,
    board: UnitId[],
    stars: Record<UnitId, StarLevel>,
  ): { unit: UnitId; stars: StarLevel; bonus: number } | null {
    if (!isReroll(comp)) return null;
    let best: { unit: UnitId; stars: StarLevel; bonus: number } | null = null;
    for (const unit of comp.carries) {
      if (!board.includes(unit)) continue;
      const level = stars[unit] ?? 1;
      const bonus = starBonus(level, this.catalog.unit(unit).cost);
      if (bonus > 0 && (!best || bonus > best.bonus)) best = { unit, stars: level, bonus };
    }
    return best;
  }

  /** Average credit per board unit: 1 if it is in the comp's opener or end board, 0.5 if it shares a trait. */
  private boardFit(comp: Comp, board: string[]): { fit: number; matches: string[] } {
    if (!board.length) return { fit: 0, matches: [] };
    const inComp = new Set([...comp.endBoard, ...comp.opener.units]);
    const compTraits = new Set(comp.endBoard.flatMap((u) => this.catalog.traitsOf(u)));
    const matches: string[] = [];
    let total = 0;
    for (const unit of board) {
      if (inComp.has(unit)) {
        matches.push(unit);
        total += 1;
      } else if (this.catalog.traitsOf(unit).some((t) => compTraits.has(t))) {
        total += TRAIT_MATCH;
      }
    }
    return { fit: total / board.length, matches };
  }

  /**
   * What the player can field for a comp. Held items claim their own targets
   * first. A held artifact or emblem the comp's unit would wear then takes one
   * of that unit's item slots, whichever leaves the components the most to
   * build. Components craft the rest.
   */
  private holdings(
    comp: Comp,
    bag: ComponentBag,
    held: string[],
  ): { allocation: Allocation; heldWeight: number; rest: TargetEntry[]; spare: string[] } {
    const { claimed, rest: unclaimed, spare } = claimHeld(this.targets.get(comp.slug)!, held);
    let rest = unclaimed;
    const fills: BuiltItem[] = [];
    for (const { item, unit } of slotFillers(comp, spare, this.catalog, this.itemStats)) {
      let best: { slot: TargetEntry; value: number } | undefined;
      for (const slot of rest.filter((t) => t.unit === unit)) {
        const value = slot.weight + this.allocationFor(comp.slug, rest.filter((t) => t !== slot), bag).value;
        if (!best || value > best.value) best = { slot, value };
      }
      if (!best) continue;
      const { slot } = best;
      // The artifact stands in for the slot's item, so it keeps that item's weight and recipe.
      fills.push({ ...slot, item, replaces: slot.item, uses: [], held: true });
      rest = rest.filter((t) => t !== slot);
    }
    const heldWeight = [...claimed, ...fills].reduce((sum, b) => sum + b.weight, 0);
    const crafted = this.allocationFor(comp.slug, rest, bag);
    return {
      allocation: { ...crafted, built: [...claimed, ...fills, ...crafted.built], value: crafted.value + heldWeight },
      heldWeight,
      rest,
      spare,
    };
  }

  private allocationFor(slug: string, targets: TargetEntry[], bag: ComponentBag): Allocation {
    const key = `${slug}|${bagKey(bag)}|${targets.map((t) => `${t.item}@${t.unit}`).join(",")}`;
    let result = this.allocations.get(key);
    if (!result) {
      result = allocate(targets, bag);
      this.allocations.set(key, result);
    }
    return result;
  }
}
