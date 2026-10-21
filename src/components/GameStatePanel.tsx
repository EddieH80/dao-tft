"use client";

import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { augmentStages, catalog } from "@/data";
import { STAR_LEVELS } from "@/engine/types";
import { useGame } from "@/store/useGame";
import { BoardTraits } from "./BoardTraits";
import { Icon } from "./Icon";

/** What the player has right now, read-only, so the quick page shows the game and not just the bar. */
export function GameStatePanel() {
  const { board, stars, components, items, augments, level, gold, goldEstimated, hp, stage } = useGame(
    useShallow((s) => ({
      board: s.board,
      stars: s.stars,
      components: s.components,
      items: s.items,
      augments: s.augments,
      level: s.level,
      gold: s.gold,
      goldEstimated: s.goldEstimated,
      hp: s.hp,
      stage: s.stage,
    })),
  );

  const held = useMemo(() => {
    const counts = new Map<string, number>();
    for (const id of items) counts.set(id, (counts.get(id) ?? 0) + 1);
    return [...counts];
  }, [items]);
  const bag = catalog.componentIds.filter((id) => components[id] > 0);

  return (
    <section className="mx-auto mb-4 max-w-5xl rounded-lg border border-line bg-panel p-3" aria-label="Game state">
      <dl className="grid grid-cols-4 gap-2">
        <Stat label="Stage" value={stage ?? "—"} />
        <Stat label="Level" value={level} sub={`${board.length}/${level} units`} />
        <Stat
          label="Gold"
          value={gold === null ? "—" : `${goldEstimated ? "~" : ""}${gold}`}
          sub={goldEstimated ? "estimated, type it to correct" : undefined}
          warn={goldEstimated}
        />
        <Stat label="HP" value={hp ?? "—"} />
      </dl>

      <Section title="Board">
        {board.length ? (
          <>
            <ul className="mb-2 flex flex-wrap gap-3">
              {board.map((id) => {
                const u = catalog.unit(id);
                const level = stars[id] ?? 1;
                return (
                  <li key={id} className="flex w-16 flex-col items-center gap-0.5 text-center">
                    <Icon src={u.icon} label={u.name} size={40} rounded="full" />
                    <span className="w-full truncate text-xs">{u.name}</span>
                    <span className="text-xs leading-none" aria-label={`${level}-star`}>
                      {STAR_LEVELS.map((n) => (
                        <span key={n} className={n <= level ? "text-gold-bright" : "text-line"}>
                          ★
                        </span>
                      ))}
                    </span>
                  </li>
                );
              })}
            </ul>
            <BoardTraits board={board} className="" />
          </>
        ) : (
          <None>No units yet</None>
        )}
      </Section>

      <div className="grid gap-x-4 sm:grid-cols-3">
        <Section title="Components">
          {bag.length ? (
            <ul className="flex flex-wrap gap-2.5">
              {bag.map((id) => {
                const name = catalog.componentName(id);
                return <Counted key={id} icon={catalog.componentIcon(id)} name={name} count={components[id]} />;
              })}
            </ul>
          ) : (
            <None>None</None>
          )}
        </Section>
        <Section title="Items">
          {held.length ? (
            <ul className="flex flex-wrap gap-2.5">
              {held.map(([id, count]) => {
                const item = catalog.holdable(id);
                return <Counted key={id} icon={item?.icon ?? ""} name={item?.name ?? id} count={count} />;
              })}
            </ul>
          ) : (
            <None>None</None>
          )}
        </Section>
        <Section title="Augments">
          {augments.length ? (
            <ul className="space-y-1">
              {augments.map((id, i) => {
                const name = catalog.augmentName(id);
                return (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <Icon src={catalog.augmentIcon(id)} label={name} size={24} />
                    <span className="min-w-0 truncate">{name}</span>
                    <span className="text-xs text-muted">{augmentStages[i]?.stage}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <None>None</None>
          )}
        </Section>
      </div>
    </section>
  );
}

function Stat({ label, value, sub, warn = false }: { label: string; value: ReactNode; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-md border border-line bg-panel-2 px-3 py-1.5">
      <dt className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</dt>
      <dd className={`text-xl font-bold leading-tight ${warn ? "text-warn" : "text-gold-bright"}`}>{value}</dd>
      {sub && <dd className={`text-[11px] leading-tight ${warn ? "text-warn" : "text-muted"}`}>{sub}</dd>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-3">
      <h2 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-gold">{title}</h2>
      {children}
    </div>
  );
}

function None({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

/** An icon with a count badge when there is more than one. */
function Counted({ icon, name, count }: { icon: string; name: string; count: number }) {
  return (
    <li className="relative" title={count > 1 ? `${name} ×${count}` : name}>
      <Icon src={icon} label={name} size={36} />
      {count > 1 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1 text-xs font-bold text-ink">
          {count}
        </span>
      )}
    </li>
  );
}
