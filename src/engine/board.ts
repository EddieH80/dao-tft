import type { ItemId, StarLevel, UnitId } from "./types";

/**
 * Tactician's items: emblems crafted from two Spatulas / Frying Pans that each
 * raise the player's max team size by one while held. Ids match the snapshot.
 */
export const TEAM_SIZE_ITEMS: ReadonlySet<ItemId> = new Set([
  "DA_TacticiansCape", // Spatula + Frying Pan
  "DA_TacticiansCrown", // Spatula + Spatula
  "DA_TacticiansShield", // Frying Pan + Frying Pan
]);

export const isTeamSizeItem = (id: ItemId) => TEAM_SIZE_ITEMS.has(id);

/** Extra board slots from held Tactician's items, one per copy. */
export function extraSlots(items: ItemId[]): number {
  return items.filter(isTeamSizeItem).length;
}

/** How many units the player may field: their level plus one per Tactician's item. */
export function teamSize(level: number, items: ItemId[]): number {
  return level + extraSlots(items);
}

/** Star levels in board order, with only the units still on the board. */
export function starsOn(board: UnitId[], stars: Record<UnitId, StarLevel>): Record<UnitId, StarLevel> {
  return Object.fromEntries(board.filter((u) => (stars[u] ?? 1) > 1).map((u) => [u, stars[u]]));
}

/**
 * The board cut down to what `level` and `items` allow, dropping the units
 * added last. Returns the same arrays when nothing is dropped.
 */
export function fitBoard(
  board: UnitId[],
  stars: Record<UnitId, StarLevel>,
  level: number,
  items: ItemId[],
): { board: UnitId[]; stars: Record<UnitId, StarLevel>; dropped: UnitId[] } {
  const size = teamSize(level, items);
  if (board.length <= size) return { board, stars, dropped: [] };
  const kept = board.slice(0, size);
  return { board: kept, stars: starsOn(kept, stars), dropped: board.slice(size) };
}
