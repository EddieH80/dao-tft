"use client";

import { useMemo, useState } from "react";
import { catalog, economyModel, engine } from "@/data";
import { COMP_STYLES } from "@/data/schema";
import { stageLabels, type Verdict } from "@/engine/economy";
import { STAR_LEVELS } from "@/engine/types";
import { LEVELS, useGame } from "@/store/useGame";
import { FlowNode } from "./flow";
import { traitStyle, type TraitStyle } from "@/engine/traits";
import { Icon } from "./Icon";
import { CollapsibleGroup } from "./ui";

const COSTS = [1, 2, 3, 4, 5];

export function BoardPicker() {
  const [filter, setFilter] = useState("");
  const [openCosts, setOpenCosts] = useState<Set<number>>(new Set());
  const board = useGame((s) => s.board);
  const level = useGame((s) => s.level);
  const setLevel = useGame((s) => s.setLevel);
  const toggle = useGame((s) => s.toggleUnit);
  const stars = useGame((s) => s.stars);
  const setStars = useGame((s) => s.setStars);
  const full = board.length >= level;
  const skip = useGame((s) => s.skipBoard);
  const gold = useGame((s) => s.gold);
  const goldEstimated = useGame((s) => s.goldEstimated);
  const hp = useGame((s) => s.hp);
  const stage = useGame((s) => s.stage);
  const setGold = useGame((s) => s.setGold);
  const setHp = useGame((s) => s.setHp);
  const setStage = useGame((s) => s.setStage);
  const outlooks = useMemo(() => engine.styleOutlooks({ level, gold, hp, stage }), [level, gold, hp, stage]);

  const traits = useMemo(() => boardTraits(board), [board]);

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
      hint="Keep this updated as you play; recommendations follow your board, level, gold, HP and stage"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-muted">Level</span>
        <div role="radiogroup" aria-label="Player level" className="flex flex-wrap gap-1">
          {LEVELS.map((l) => (
            <button
              key={l}
              role="radio"
              aria-checked={level === l}
              onClick={() => setLevel(l)}
              className={`h-7 w-7 rounded-md border text-xs font-semibold ${
                level === l ? "border-gold bg-panel-2 text-gold-bright" : "border-line text-muted hover:border-muted"
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <span className="ml-auto text-xs text-muted">
          {board.length}/{level} units
        </span>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-muted">Stage</span>
          <select
            value={stage ?? ""}
            onChange={(e) => setStage(e.target.value || null)}
            className="rounded-md border border-line bg-ink px-2 py-1 text-sm"
          >
            <option value="">—</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <NumberField label="Gold" value={gold} onChange={setGold} max={200} estimated={goldEstimated} />
        <NumberField label="HP" value={hp} onChange={setHp} max={100} />
      </div>
      {outlooks.size > 0 ? (
        <p className="mb-3 text-xs text-muted" aria-live="polite">
          At this economy:{" "}
          {VERDICTS.map(({ verdict, label, style }) => {
            const styles = COMP_STYLES.filter((s) => outlooks.get(s)?.verdict === verdict);
            if (!styles.length) return null;
            return (
              <span key={verdict} className="mr-2">
                <span className={style}>{label}</span> {styles.map((s) => economyModel.styles[s].label).join(", ")}.
              </span>
            );
          })}
        </p>
      ) : (
        <p className="mb-3 text-xs text-muted">Add your stage and gold to rule out comp styles you cannot reach.</p>
      )}

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

      {traits.length > 0 && (
        <ul className="mb-3 flex flex-wrap gap-1.5" aria-label="Board traits">
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
      )}

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

const STAGES = stageLabels(economyModel);

const VERDICTS: { verdict: Verdict; label: string; style: string }[] = [
  { verdict: "realistic", label: "Realistic:", style: "text-good" },
  { verdict: "stretch", label: "Stretch:", style: "text-warn" },
  { verdict: "unrealistic", label: "Not realistic:", style: "text-bad" },
];

/** A whole-number input where empty means "not given". */
function NumberField({
  label,
  value,
  onChange,
  max,
  estimated = false,
}: {
  label: string;
  value: number | null;
  onChange: (value: number | null) => void;
  max: number;
  /** The value was projected by "next round", not entered. */
  estimated?: boolean;
}) {
  return (
    <label className="flex items-center gap-2" title={estimated ? "Estimated from last round's income; correct it" : undefined}>
      <span className="text-muted">
        {label}
        {estimated && <span className="text-warn"> ~</span>}
      </span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={max}
        value={value ?? ""}
        onChange={(e) => {
          const n = e.target.valueAsNumber;
          onChange(Number.isNaN(n) ? null : Math.max(0, Math.min(max, Math.round(n))));
        }}
        placeholder="—"
        className="w-16 rounded-md border border-line bg-ink px-2 py-1 text-sm placeholder:text-muted"
      />
    </label>
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
