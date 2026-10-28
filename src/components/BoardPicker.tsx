"use client";

import { useMemo, useState } from "react";
import { catalog } from "@/data";
import { STAR_LEVELS } from "@/engine/types";
import { useGame } from "@/store/useGame";
import { FlowNode } from "./flow";
import { BoardTraits } from "./BoardTraits";
import { Icon } from "./Icon";
import { CollapsibleGroup } from "./ui";

const COSTS = [1, 2, 3, 4, 5];

export function BoardPicker() {
  const [filter, setFilter] = useState("");
  const [openCosts, setOpenCosts] = useState<Set<number>>(new Set());
  const board = useGame((s) => s.board);
  const level = useGame((s) => s.level);
  const toggle = useGame((s) => s.toggleUnit);
  const stars = useGame((s) => s.stars);
  const setStars = useGame((s) => s.setStars);
  const full = board.length >= level;
  const skip = useGame((s) => s.skipBoard);

  const options = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return catalog.snapshot.units.filter((u) => !q || u.name.toLowerCase().includes(q));
  }, [filter]);

  const groups = useMemo(
    () => COSTS.map((cost) => ({ cost, units: options.filter((u) => u.cost === cost) })),
    [options],
  );
  const searching = filter.trim() !== "";

  const pick = (id: string) => {
    toggle(id);
    setFilter("");
  };

  const toggleCost = (cost: number) =>
    setOpenCosts((s) => {
      const next = new Set(s);
      if (!next.delete(cost)) next.add(cost);
      return next;
    });

  return (
    <FlowNode
      step={2}
      title="Current Board"
      hint="Keep this updated as you play; recommendations follow your units and their star levels"
    >
      {board.length > 0 && (
        <>
          <ul className="mb-1 flex flex-wrap gap-2">
            {board.map((id) => {
              const u = catalog.unit(id);
              const level = stars[id] ?? 1;
              return (
                <li
                  key={id}
                  className="flex items-center gap-1.5 rounded-full border border-gold bg-panel-2 py-0.5 pl-0.5 pr-1 text-sm"
                >
                  <Icon src={u.icon} label={u.name} size={24} rounded="full" />
                  {u.name}
                  <span role="radiogroup" aria-label={`${u.name} star level`} className="flex">
                    {STAR_LEVELS.map((n) => (
                      <button
                        key={n}
                        role="radio"
                        aria-checked={level === n}
                        aria-label={`${n}-star`}
                        title={`${n}-star`}
                        onClick={() => setStars(id, n)}
                        className={`px-px leading-none ${n <= level ? "text-gold-bright" : "text-line hover:text-muted"}`}
                      >
                        ★
                      </button>
                    ))}
                  </span>
                  <button
                    onClick={() => toggle(id)}
                    className="rounded-full px-1 text-muted hover:text-bad"
                    aria-label={`Remove ${u.name}`}
                    title={`Remove ${u.name}`}
                  >
                    ×
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mb-3 text-xs text-muted">
            Click the stars to set a unit&apos;s star level. A 2- or 3-star carry pulls toward its reroll comp.
          </p>
        </>
      )}

      <BoardTraits board={board} />

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        onKeyDown={(e) => {
          // Enter adds the first match that is not already on the board.
          const first = groups.flatMap((g) => g.units).find((u) => !board.includes(u.id));
          if (e.key === "Enter" && first && !full) pick(first.id);
          if (e.key === "Escape") setFilter("");
        }}
        placeholder="Search units"
        aria-label="Search units"
        className="mb-2 w-full rounded-md border border-line bg-ink px-3 py-1.5 text-sm placeholder:text-muted"
      />
      <div className="max-h-96 space-y-1.5 overflow-y-auto">
        {groups.map(({ cost, units }) =>
          searching && !units.length ? null : (
            <CollapsibleGroup
              key={cost}
              title={`${cost}-cost`}
              count={units.length}
              open={searching || openCosts.has(cost)}
              onToggle={() => toggleCost(cost)}
            >
              <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {units.map((u) => {
                  const on = board.includes(u.id);
                  return (
                    <li key={u.id}>
                      <button
                        disabled={!on && full}
                        onClick={() => pick(u.id)}
                        aria-pressed={on}
                        className={`flex w-full items-center gap-2 rounded-md border px-1.5 py-1 text-left text-sm ${
                          on ? "border-gold bg-panel-2" : "border-line enabled:hover:border-muted disabled:opacity-40"
                        }`}
                      >
                        <Icon src={u.icon} label={u.name} size={26} rounded="full" />
                        <span className="min-w-0 flex-1 truncate">{u.name}</span>
                        <span className="text-xs text-muted">{u.cost}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </CollapsibleGroup>
          ),
        )}
        {searching && !options.length && <p className="text-sm text-muted">No match.</p>}
      </div>

      {board.length === 0 && (
        <button onClick={skip} className="mt-3 text-sm text-muted underline decoration-line hover:text-gold-bright">
          I have no units yet — continue
        </button>
      )}
    </FlowNode>
  );
}
