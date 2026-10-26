"use client";

import { useMemo, useState } from "react";
import { catalog, economyModel, engine } from "@/data";
import { COMP_STYLES } from "@/data/schema";
import { stageLabels, type Verdict } from "@/engine/economy";
import { STAR_LEVELS } from "@/engine/types";
import { LEVELS, useGame } from "@/store/useGame";
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
  const outlooks = useMemo(
    () => engine.styleOutlooks({ level, gold, hp, stage }, board, stars),
    [level, gold, hp, stage, board, stars],
  );

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
        <StageField value={stage} onChange={setStage} />
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
        <p className="mb-3 text-xs text-muted">
          Add your {[stage === null && "stage", gold === null && "gold"].filter(Boolean).join(" and ")} to see which
          comp styles (reroll, fast 8, fast 9…) you can reach.
        </p>
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

/** Every round from 2-1 to 7-7. */
const STAGES = new Set(stageLabels(economyModel));
const FIRST_STAGE = "2-1";
const LAST_STAGE = [...STAGES].at(-1)!;

/**
 * A round typed as "3-2". Only a real round from 2-1 to the last stage is
 * saved; anything else stays in the box, marked, until it is fixed or cleared.
 */
function StageField({ value, onChange }: { value: string | null; onChange: (stage: string | null) => void }) {
  const [draft, setDraft] = useState(value ?? "");
  // The stage also changes from elsewhere ("next round", the quick bar); show it when it does.
  const [shown, setShown] = useState(value);
  if (value !== shown) {
    setShown(value);
    setDraft(value ?? "");
  }
  const text = draft.trim();
  const invalid = text !== "" && !STAGES.has(text);

  return (
    <label className="flex items-center gap-2">
      <span className="text-muted">Stage</span>
      <input
        value={draft}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          const t = next.trim();
          if (t === "") onChange(null);
          else if (STAGES.has(t)) onChange(t);
        }}
        onBlur={() => !invalid && setDraft(value ?? "")}
        placeholder="3-2"
        maxLength={3}
        autoComplete="off"
        aria-invalid={invalid}
        aria-describedby={invalid ? "stage-error" : undefined}
        className={`w-14 rounded-md border bg-ink px-2 py-1 text-sm placeholder:text-muted ${
          invalid ? "border-bad" : "border-line"
        }`}
      />
      {invalid && (
        <span id="stage-error" className="text-xs text-bad">
          A round like 3-2, from {FIRST_STAGE} to {LAST_STAGE}
        </span>
      )}
    </label>
  );
}

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
