"use client";

import { bagSize } from "@/engine/catalog";
import { GameStatePanel } from "./GameStatePanel";
import { LiveSummary } from "./LiveSummary";
import { QuickBar } from "./QuickBar";
import { useRanking } from "./useRanking";

const SHOWN = 3;

/** The quick bar and the top comps, for a player alt-tabbing out of a game. */
export function QuickApp() {
  const { state, ranking, hits } = useRanking(SHOWN);
  const { components, items, board, augments, stage, gold } = state;

  // The quick bar can set any part of the game in any order, so the summary shows as soon as there is one.
  const started =
    bagSize(components) > 0 || items.length > 0 || board.length > 0 || augments.length > 0 || stage !== null || gold !== null;

  return (
    <main className="mx-auto max-w-7xl px-4 pb-8">
      <h1 className="sr-only">Quick bar</h1>
      <QuickBar />
      {started ? (
        <>
          <GameStatePanel />
          <LiveSummary ranking={ranking} hits={hits} />
        </>
      ) : (
        <p className="mx-auto max-w-5xl text-center text-sm text-muted">
          Type what you hold, like <code className="text-gold">bf glove</code>, or press Enter to start at 2-1.
        </p>
      )}
    </main>
  );
}
