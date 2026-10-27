"use client";

import { bagSize } from "@/engine/catalog";
import { useGame } from "@/store/useGame";
import { AugmentPanel } from "./AugmentPanel";
import { BoardPicker } from "./BoardPicker";
import { ComponentPicker } from "./ComponentPicker";
import { HeldItemsPicker } from "./HeldItemsPicker";
import { Branch, Connector, ElbowConnector, FlowLabel, SideArrow } from "./flow";
import { RecommendationCard } from "./RecommendationCard";
import { ScoutPanel } from "./ScoutPanel";
import { useRanking } from "./useRanking";

const BRANCHES = 3;
const EXTRA = 2;

// On wide screens the opponents take a left column (lg:w-72 panel, w-10 side arrow, gap-4),
// so the compositions column is centred half that far right of the page centre.
const RESULTS_SHIFT = "calc((18rem + 2.5rem + 1rem) / 2)";

export function RouterApp() {
  const { state, ranking, hits } = useRanking(BRANCHES + EXTRA);
  const { components, items, board, augments, scout, stage, gold } = state;
  const boardSkipped = useGame((s) => s.boardSkipped);
  const augmentSkipped = useGame((s) => s.augmentSkipped);

  // Each step appears once the one before it has an answer.
  // A game started from the quick bar may have no components yet, so anything entered opens the board step.
  const showBoard =
    bagSize(components) > 0 || items.length > 0 || board.length > 0 || augments.length > 0 || stage !== null || gold !== null;
  const showAugment = showBoard && (board.length > 0 || boardSkipped);
  const showResults = showAugment && (augments.length > 0 || augmentSkipped);

  const extra = ranking.slice(BRANCHES, BRANCHES + EXTRA);

  const card = (i: number) => (
    <RecommendationCard
      rec={ranking[i]}
      rank={i + 1}
      ranking={ranking}
      contested={scout.contested}
      hits={hits.get(ranking[i].comp.slug) ?? []}
      taken={augments}
    />
  );

  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <div className="mx-auto mb-6 max-w-2xl text-center">
        <h1 className="text-3xl font-semibold text-gold">What are you holding?</h1>
        <p className="mt-2 text-sm text-muted">
          Start with your item components and anything already built. Dao TFT builds the path from there: your
          board, your augment, then the compositions worth playing.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl items-start gap-4 lg:grid-cols-2">
        <ComponentPicker />
        <HeldItemsPicker />
      </div>

      {showBoard && (
        <>
          <Connector />
          <BoardPicker />
        </>
      )}

      {showAugment && (
        <>
          <Connector />
          <AugmentPanel />
        </>
      )}

      {showResults && (
        <>
          <h2 className="sr-only">Your options</h2>
          <ElbowConnector shift={RESULTS_SHIFT} />

          {/* Opponents feed into the recommendations: contested comps rank lower. */}
          <div className="grid items-start gap-4 lg:grid-cols-[auto_minmax(0,1fr)]">
            <div className="animate-pop flex flex-col items-center lg:flex-row">
              <div className="w-full max-w-2xl lg:w-72">
                <ScoutPanel />
              </div>
              <SideArrow />
            </div>

            <div className="min-w-0">
              <FlowLabel>Compositions you can play</FlowLabel>
              <Branch>
                {Array.from({ length: BRANCHES }, (_, i) => (
                  <div key={ranking[i].comp.slug}>{card(i)}</div>
                ))}
              </Branch>

              <details className="mt-6 rounded-lg border border-line bg-panel/60 p-4">
                <summary className="cursor-pointer text-sm text-muted hover:text-gold-bright">
                  {extra.length} more option{extra.length === 1 ? "" : "s"}
                </summary>
                <div className="mt-4 grid gap-4 md:grid-cols-2">
                  {extra.map((rec, i) => (
                    <div key={rec.comp.slug}>{card(BRANCHES + i)}</div>
                  ))}
                </div>
              </details>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
