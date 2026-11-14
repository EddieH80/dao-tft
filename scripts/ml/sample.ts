/**
 * Plausible game states: level, gold and HP that fit the stage, components and
 * items in amounts a player holds at that point, a board no bigger than the
 * level, and augments taken in order from each selection's real pool.
 * A message describes only part of a state; the state keeps the parts consistent.
 */
import { AUGMENT_SELECTIONS } from "../../src/assistant/contract";
import type { Rng } from "./rng";
import type { Entity, Selection, Vocab } from "./vocab";

export interface BoardUnit {
  unit: Entity;
  stars: 1 | 2 | 3;
}

export interface GameSample {
  stage: string;
  level: number;
  gold: number;
  hp: number;
  /** One entry per copy. */
  components: Entity[];
  items: Entity[];
  board: BoardUnit[];
  augments: { augment: Entity; at: Selection }[];
}

const LEVEL_BY_STAGE: Record<number, [number, number]> = {
  2: [3, 5],
  3: [5, 7],
  4: [6, 8],
  5: [7, 9],
  6: [8, 10],
  7: [8, 10],
};
const HP_BY_STAGE: Record<number, [number, number]> = {
  2: [70, 100],
  3: [50, 100],
  4: [30, 95],
  5: [10, 80],
  6: [1, 60],
  7: [1, 40],
};
/** Total components held at once, by stage. */
const COMPONENTS_BY_STAGE: Record<number, [number, number]> = {
  2: [1, 5],
  3: [0, 5],
  4: [0, 4],
  5: [0, 3],
  6: [0, 3],
  7: [0, 2],
};
const ITEMS_BY_STAGE: Record<number, [number, number]> = {
  2: [0, 1],
  3: [0, 3],
  4: [1, 4],
  5: [2, 6],
  6: [2, 7],
  7: [3, 8],
};
/** Relative odds of seeing each unit cost on the board, by stage. */
const COST_ODDS: Record<number, number[]> = {
  2: [60, 35, 5, 0, 0],
  3: [35, 40, 20, 5, 0],
  4: [15, 30, 35, 18, 2],
  5: [8, 20, 32, 30, 10],
  6: [5, 12, 28, 35, 20],
  7: [3, 10, 25, 37, 25],
};

const stageNumber = (stage: string) => Number(stage.split("-")[0]);
/** Whether `stage` is at or past a selection ("3-2" is past "2-1" and at "3-2"). */
const reached = (stage: string, selection: string) => {
  const [s, r] = stage.split("-").map(Number);
  const [ss, sr] = selection.split("-").map(Number);
  return s > ss || (s === ss && r >= sr);
};

export function sampleGame(rng: Rng, v: Vocab): GameSample {
  const s = rng.weighted([
    [2, 25],
    [3, 28],
    [4, 25],
    [5, 14],
    [6, 7],
    [7, 1],
  ] as const);
  const stage = `${s}-${rng.int(1, 7)}`;
  const level = rng.int(...LEVEL_BY_STAGE[s]);
  const gold = rng.weighted([
    [rng.int(0, 20), 30],
    [rng.int(20, 55), 45],
    [rng.int(55, 100), 20],
    [rng.int(100, 160), 5],
  ] as const);
  const hp = rng.int(...HP_BY_STAGE[s]);

  const components = Array.from({ length: rng.int(...COMPONENTS_BY_STAGE[s]) }, () =>
    rng.weighted(v.byKind.component.map((c) => [c, c.id === "Spatula" || c.id === "FryingPan" ? 1 : 5] as const)),
  );

  const itemWeight = (e: Entity) => (e.sub === "item" ? 20 : e.sub === "emblem" ? 2 : s >= 3 ? 1.5 : 0);
  const items = Array.from({ length: rng.int(...ITEMS_BY_STAGE[s]) }, () =>
    rng.weighted(v.byKind.item.map((e) => [e, itemWeight(e)] as const)),
  );

  const size = Math.max(1, level - rng.weighted([[0, 6], [1, 3], [2, 1]] as const));
  const odds = COST_ODDS[s];
  // Weighted draws without replacement, so cheap units dominate early boards.
  let left = v.byKind.unit.filter((u) => odds[u.cost! - 1] > 0);
  const units: Entity[] = [];
  while (units.length < size && left.length) {
    const u = rng.weighted(left.map((x) => [x, odds[x.cost! - 1]] as const));
    units.push(u);
    left = left.filter((x) => x !== u);
  }
  const board = units.map((unit): BoardUnit => {
    const cost = unit.cost!;
    const two = cost <= 3 ? 0.45 : cost === 4 ? 0.25 : 0.08;
    const three = s >= 3 && cost <= 2 ? 0.06 : s >= 4 && cost === 3 ? 0.03 : 0;
    const r = rng.next();
    return { unit, stars: r < three ? 3 : r < three + two ? 2 : 1 };
  });

  const augments: GameSample["augments"] = [];
  for (const at of AUGMENT_SELECTIONS) {
    if (!reached(stage, at)) break;
    const pool = v.pools[at].filter((id) => v.byId.has(id) && !augments.some((a) => a.augment.id === id));
    augments.push({ augment: v.byId.get(rng.pick(pool))!, at });
  }

  return { stage, level, gold, hp, components, items, board, augments };
}

export { stageNumber };
