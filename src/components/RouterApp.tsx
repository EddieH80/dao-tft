"use client";

import { useEffect, useMemo } from "react";
import { engine } from "@/data";
import { bagSize } from "@/engine/catalog";
import { useGame, useScout } from "@/store/useGame";
import { AugmentPanel } from "./AugmentPanel";
import { BoardPicker } from "./BoardPicker";
import { ComponentPicker } from "./ComponentPicker";
import { HeldItemsPicker } from "./HeldItemsPicker";
import { LiveSummary } from "./LiveSummary";
import { QuickBar } from "./QuickBar";
import { Branch, Connector, FlowLabel, SideArrow } from "./flow";
import { RecommendationCard } from "./RecommendationCard";
import { ScoutPanel } from "./ScoutPanel";

const BRANCHES = 3;
const EXTRA = 2;

export function RouterApp() {
  const components = useGame((s) => s.components);
  const items = useGame((s) => s.items);
  const board = useGame((s) => s.board);
  const augments = useGame((s) => s.augments);
  const level = useGame((s) => s.level);
  const gold = useGame((s) => s.gold);
  const hp = useGame((s) => s.hp);
  const stage = useGame((s) => s.stage);
  const goldEstimated = useGame((s) => s.goldEstimated);
  const scout = useScout();
  const boardSkipped = useGame((s) => s.boardSkipped);
  const augmentSkipped = useGame((s) => s.augmentSkipped);

  // The saved game loads after the first render, so the static HTML matches it.
  useEffect(() => {
    void useGame.persist.rehydrate();
  }, []);

  // Each step appears once the one before it has an answer.
  const showBoard = bagSize(components) > 0 || items.length > 0;
  const showAugment = showBoard && (board.length > 0 || boardSkipped);
  const showResults = showAugment && (augments.length > 0 || augmentSkipped);
  // The quick bar can set any part of the game in any order, so the summary shows as soon as there is one.
  const started = showBoard || board.length > 0 || augments.length > 0 || stage !== null || gold !== null;

  const state = useMemo(
    () => ({ components, items, board, augments, scout, level, gold, hp, stage }),
    [components, items, board, augments, scout, level, gold, hp, stage],
  );
  const ranking = useMemo(() => engine.rank(state), [state]);
  const hits = useMemo(
    () => new Map(ranking.slice(0, BRANCHES + EXTRA).map((r) => [r.comp.slug, engine.hitNext(r.comp, state)])),
    [ranking, state],
  );

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
    <main className="mx-auto max-w-7xl px-4 pb-8">
      <QuickBar />
      {started && (
        <LiveSummary
          ranking={ranking}
          hits={hits}
          stage={stage}
          level={level}
          gold={gold}
          goldEstimated={goldEstimated}
          hp={hp}
        />
      )}

      {!showBoard && (
        <div className="mx-auto mb-6 max-w-2xl text-center">
          <h1 className="text-3xl font-semibold text-gold">What are you holding?</h1>
          <p className="mt-2 text-sm text-muted">
            Start with your item components and anything already built. Dao TFT builds the path from there: your
            board, your augment, then the compositions worth playing.
          </p>
        </div>
      )}

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
          <h1 className="sr-only">Your options</h1>
          <Connector />

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
