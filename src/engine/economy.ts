import type { CompStyle, EconomyModel } from "@/data/schema";

export type Verdict = "realistic" | "stretch" | "unrealistic";

export interface Economy {
  level: number;
  gold: number | null;
  hp: number | null;
  /** The round the player is in, like "4-2". */
  stage: string | null;
}

export interface StyleOutlook {
  verdict: Verdict;
  note: string;
  /** The stretch is only that the player has out-levelled a reroll's shop odds. */
  overlevelled?: boolean;
}

/** How long to keep projecting a style the player is already levelled for, waiting on roll gold. */
const AT_LEVEL_ROUNDS = 4;
/** A reroll style this many levels below the player's level has poor shop odds for its carries. */
const OVERLEVELLED = 2;
/** Spending more than this share of the player's HP to get there makes a style a stretch. */
const HP_STRETCH = 0.5;
/**
 * Further out than this, streaks and board strength decide more than the
 * projection can, so a style is only ruled out if it is truly out of reach,
 * never called a stretch. Keeps every style open at 2-1 with full HP.
 */
const FAR_ROUNDS = 10;

/** Rounds since 2-1, so stages compare and step. */
export function stageIndex(stage: string, model: EconomyModel): number {
  const [s, r] = stage.split("-").map(Number);
  return (s - 2) * model.rounds.perStage + (r - 1);
}

export function stageLabel(index: number, model: EconomyModel): string {
  return `${Math.floor(index / model.rounds.perStage) + 2}-${(index % model.rounds.perStage) + 1}`;
}

/** Every round from 2-1 to the last stage the model has loss damage for. */
export function stageLabels(model: EconomyModel): string[] {
  const stages = Object.keys(model.lossDamage).map(Number);
  const last = (Math.max(...stages) - 1) * model.rounds.perStage;
  return Array.from({ length: last }, (_, i) => stageLabel(i, model));
}

/** The round after `stage`, or 2-1 when the stage is unknown; the last round stays put. */
export function nextStage(stage: string | null, model: EconomyModel): string {
  const labels = stageLabels(model);
  if (stage === null) return labels[0];
  return stageLabel(Math.min(stageIndex(stage, model) + 1, labels.length - 1), model);
}

/** Whether `round` (rounds since 2-1) is a carousel, which pays no income. */
export function isCarousel(round: number, model: EconomyModel): boolean {
  return (round % model.rounds.perStage) + 1 === model.rounds.carousel;
}

/** Base income plus interest on `gold`, paid at the start of every round but the carousel. */
export function roundIncome(gold: number, model: EconomyModel): number {
  return model.income.base + Math.min(model.income.interestMax, Math.floor(gold / model.income.interestPer));
}

/** XP to climb from `from` to `to`, less what the player has likely banked toward the next level (the app does not ask). */
function xpBetween(from: number, to: number, model: EconomyModel): number {
  let xp = 0;
  for (let level = from + 1; level <= to; level++) xp += model.xpToLevel[level] ?? 0;
  const banked = from < to ? (model.xpToLevel[from + 1] ?? 0) * model.bankedXpShare : 0;
  return Math.max(0, xp - banked);
}

/**
 * Whether the player can still play a comp style: walk forward round by round,
 * saving gold and taking passive XP, until they can buy up to the style's roll
 * level and still have its roll-down gold. They are assumed to lose most player
 * rounds on the way. Returns null while gold or stage is unknown.
 */
export function styleOutlook(style: CompStyle, economy: Economy, model: EconomyModel): StyleOutlook | null {
  if (economy.gold === null || economy.stage === null) return null;
  const { label, rollLevel, rollGold, ideal, deadline } = model.styles[style];
  const start = stageIndex(economy.stage, model);
  const idealAt = stageIndex(ideal, model);
  const deadlineAt = stageIndex(deadline, model);
  const levelled = economy.level >= rollLevel;
  const lastRound = levelled ? start + AT_LEVEL_ROUNDS : Math.max(deadlineAt, start);

  const xpNeeded = xpBetween(economy.level, rollLevel, model);
  const cost = (passive: number) =>
    Math.ceil(Math.max(0, xpNeeded - passive) / model.buyXp.xp) * model.buyXp.gold + rollGold;

  let gold = economy.gold;
  let passive = 0;
  let damage = 0;
  let round = start;
  const target = `level ${rollLevel}`;
  const dies = () => economy.hp !== null && damage >= economy.hp;
  while (gold < cost(passive)) {
    // Play out this round, then collect what the next one brings.
    const r = (round % model.rounds.perStage) + 1;
    const stage = Math.floor(round / model.rounds.perStage) + 2;
    if (r !== model.rounds.carousel && r !== model.rounds.pve) {
      damage += (model.lossDamage[stage] ?? 0) * model.lossRate;
    }
    round++;
    if (dies()) {
      return {
        verdict: "unrealistic",
        note: `Getting to ${target} and rolling takes about ${cost(passive)} gold, but losing until then costs about ${Math.round(damage)} HP and you have ${economy.hp}.`,
      };
    }
    if (round > lastRound) {
      return {
        verdict: "unrealistic",
        note: levelled
          ? `You need about ${rollGold} gold to roll for ${label} and won't have it soon.`
          : start > deadlineAt
            ? `Getting to ${target} and rolling takes about ${cost(passive)} gold, and ${label} usually spikes by ${ideal}.`
            : `Getting to ${target} and rolling takes about ${cost(passive)} gold, which you won't have before ${deadline}.`,
      };
    }
    if (!isCarousel(round, model)) {
      gold += roundIncome(gold, model);
      passive += model.passiveXp;
    }
  }

  const when = round === start ? "now" : `around ${stageLabel(round, model)}`;
  const reach = levelled ? `roll for ${label} ${when}` : `get to ${target} and roll ${when}`;
  const far = round - start > FAR_ROUNDS;
  const cheapCost = Number(style.match(/^reroll-(\d)$/)?.[1]);
  if (cheapCost && economy.level >= rollLevel + OVERLEVELLED) {
    return {
      verdict: "stretch",
      note: `At level ${economy.level} your shop rarely shows ${cheapCost}-costs, so three-starring them is slow.`,
      overlevelled: true,
    };
  }
  if (!levelled && round > deadlineAt) {
    // Already past the cutoff, but it can be afforded right away.
    return { verdict: "stretch", note: `You can still ${reach}, but ${label} usually spikes by ${ideal}.` };
  }
  // Waiting for gold past the usual spike makes it late; being able to go right away does not.
  if (!far && !levelled && round > start && round > idealAt) {
    return { verdict: "stretch", note: `You can ${reach}, later than the usual ${ideal}.` };
  }
  if (!far && economy.hp && damage / economy.hp > HP_STRETCH) {
    return {
      verdict: "stretch",
      note: `You can ${reach}, but losing until then costs about ${Math.round(damage)} of your ${economy.hp} HP.`,
    };
  }
  return {
    verdict: "realistic",
    note: `You can ${reach}.`,
  };
}
