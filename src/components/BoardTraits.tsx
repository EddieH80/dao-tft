"use client";

import { useMemo } from "react";
import { catalog } from "@/data";
import { traitStyle, type TraitStyle } from "@/engine/traits";
import { Icon } from "./Icon";

/** The board's traits with unit counts and breakpoints, highest style first. */
export function BoardTraits({ board, className = "mb-3" }: { board: string[]; className?: string }) {
  const traits = useMemo(() => boardTraits(board), [board]);
  if (!traits.length) return null;
  return (
    <ul className={`${className} flex flex-wrap gap-1.5`} aria-label="Board traits">
      {traits.map((t) => (
        <li
          key={t.name}
          title={t.style ? `${t.style[0].toUpperCase()}${t.style.slice(1)} ${t.name}` : `${t.name} (inactive)`}
          className={`flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-xs ${
            t.style ? STYLE_CLASS[t.style] : "border-line text-muted"
          }`}
        >
          {t.icon && <Icon src={t.icon} label={t.name} size={16} />}
          <span className={t.style ? "font-medium" : ""}>{t.name}</span>
          <span>
            {t.breakpoints.map((b, i) => (
              <span key={b}>
                {i > 0 && <span className="text-muted">/</span>}
                <span className={t.count >= b ? "font-semibold text-gold-bright" : "text-muted"}>{b}</span>
              </span>
            ))}
          </span>
          <span className="text-muted">({t.count})</span>
        </li>
      ))}
    </ul>
  );
}

const STYLE_CLASS: Record<TraitStyle, string> = {
  bronze: "border-[#b4774a] bg-[#b4774a]/15",
  silver: "border-slate-300 bg-slate-300/15",
  gold: "border-amber-400 bg-amber-400/15",
  prismatic: "border-fuchsia-300 bg-gradient-to-r from-sky-400/20 via-fuchsia-400/20 to-amber-300/20",
};

interface BoardTrait {
  name: string;
  icon: string;
  count: number;
  breakpoints: number[];
  style: TraitStyle | null;
}

const STYLE_RANK: Record<TraitStyle, number> = { prismatic: 4, gold: 3, silver: 2, bronze: 1 };

/** Traits on the board with unit counts, highest style first. */
function boardTraits(board: string[]): BoardTrait[] {
  const counts = new Map<string, number>();
  for (const id of board) for (const t of catalog.traitsOf(id)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts]
    .map(([name, count]) => {
      const trait = catalog.trait(name);
      const breakpoints = trait?.breakpoints ?? [];
      return { name, icon: trait?.icon ?? "", count, breakpoints, style: traitStyle(count, breakpoints) };
    })
    .sort(
      (a, b) =>
        (b.style ? STYLE_RANK[b.style] : 0) - (a.style ? STYLE_RANK[a.style] : 0) ||
        b.count - a.count ||
        a.name.localeCompare(b.name),
    );
}
