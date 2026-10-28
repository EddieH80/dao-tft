"use client";

import { useId, useMemo, useState, type ReactNode } from "react";
import { economyModel, engine } from "@/data";
import { COMP_STYLES } from "@/data/schema";
import { stageLabels, type Verdict } from "@/engine/economy";
import { LEVELS, useGame } from "@/store/useGame";
import { FlowNode } from "./flow";

/** Level, stage, gold and HP, and which comp styles that economy can reach. */
export function EconomyPicker() {
  const board = useGame((s) => s.board);
  const stars = useGame((s) => s.stars);
  const level = useGame((s) => s.level);
  const setLevel = useGame((s) => s.setLevel);
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

  return (
    <FlowNode
      step={2}
      title="Economy"
      hint="Keep this updated as you play; recommendations follow your level, gold, HP and stage"
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
  const id = useId();
  const set = (n: number) => onChange(Math.max(0, Math.min(max, Math.round(n))));
  const step = (by: number) => set((value ?? 0) + by);
  return (
    <div className="flex items-center gap-2" title={estimated ? "Estimated from last round's income; correct it" : undefined}>
      <label htmlFor={id} className="text-muted">
        {label}
        {estimated && <span className="text-warn"> ~</span>}
      </label>
      <div className="flex items-stretch overflow-hidden rounded-md border border-line bg-ink focus-within:border-gold">
        <Stepper label={`Decrease ${label}`} onClick={() => step(-1)} disabled={value === 0}>
          −
        </Stepper>
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={max}
          value={value ?? ""}
          onChange={(e) => {
            const n = e.target.valueAsNumber;
            if (Number.isNaN(n)) onChange(null);
            else set(n);
          }}
          placeholder="—"
          className="w-10 appearance-none bg-transparent py-1 text-center text-sm outline-none placeholder:text-muted [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none [-moz-appearance:textfield]"
        />
        <Stepper label={`Increase ${label}`} onClick={() => step(1)} disabled={value === max}>
          +
        </Stepper>
      </div>
    </div>
  );
}

/** A − or + button beside a number input; the arrow keys already step it from the keyboard. */
function Stepper({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="w-6 bg-panel-2 text-sm leading-none text-muted enabled:hover:text-gold-bright disabled:opacity-40"
    >
      {children}
    </button>
  );
}
