"use client";

import { useEffect, useMemo } from "react";
import { engine } from "@/data";
import { useGame, useScout } from "@/store/useGame";

/** The saved game and the comps ranked for it, shared by the guided and quick pages. */
export function useRanking(shown: number) {
  const components = useGame((s) => s.components);
  const items = useGame((s) => s.items);
  const board = useGame((s) => s.board);
  const stars = useGame((s) => s.stars);
  const augments = useGame((s) => s.augments);
  const level = useGame((s) => s.level);
  const gold = useGame((s) => s.gold);
  const hp = useGame((s) => s.hp);
  const stage = useGame((s) => s.stage);
  const scout = useScout();

  // The saved game loads after the first render, so the static HTML matches it.
  useEffect(() => {
    void useGame.persist.rehydrate();
  }, []);

  const state = useMemo(
    () => ({ components, items, board, stars, augments, scout, level, gold, hp, stage }),
    [components, items, board, stars, augments, scout, level, gold, hp, stage],
  );
  const ranking = useMemo(() => engine.rank(state), [state]);
  const hits = useMemo(
    () => new Map(ranking.slice(0, shown).map((r) => [r.comp.slug, engine.hitNext(r.comp, state)])),
    [ranking, state, shown],
  );

  return { state, ranking, hits };
}
