"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { aliases, augmentStages, catalog, economyModel } from "@/data";
import { isCarousel, stageIndex } from "@/engine/economy";
import { QuickLexicon, runQuick, type QuickContext } from "@/engine/quick";
import { quickStateOf, useGame } from "@/store/useGame";

const ctx: QuickContext = {
  catalog,
  lexicon: new QuickLexicon(catalog, aliases),
  model: economyModel,
  augmentRounds: augmentStages.map((s) => s.stage),
};

const HELP: [string, string][] = [
  ["Enter", "next round"],
  ["38", "gold"],
  ["l7", "level"],
  ["h64", "HP"],
  ["4-2", "round"],
  ["ie jinx", "add"],
  ["-bf", "remove"],
  ["+ie", "add without using components"],
  ["u", "undo"],
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** One line for every update, so a round between fights takes a few keystrokes. */
export function QuickBar() {
  const [text, setText] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const state = useGame(useShallow(quickStateOf));
  const canUndo = useGame((s) => s.history.length > 0);
  const { apply, nextRound, undo, reset } = useGame(
    useShallow((s) => ({ apply: s.apply, nextRound: s.nextRound, undo: s.undo, reset: s.reset })),
  );
  const result = useMemo(() => (text.trim() ? runQuick(text, state, ctx) : null), [text, state]);

  // Alt-tabbing back into the browser lands in the bar.
  useEffect(() => {
    const focus = () => input.current?.focus();
    const onVisible = () => document.visibilityState === "visible" && focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isTyping(e.target)) {
        e.preventDefault();
        focus();
      }
    };
    focus();
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", onVisible);
    document.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", onVisible);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  const submit = () => {
    if (!result) nextRound();
    else if (result.undo) undo();
    else if (result.ok) apply(result.state);
    else return;
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    } else if (e.key === "Escape") {
      setText("");
    } else if (text === "" && e.key.toLowerCase() === "z" && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      undo();
    } else if (text === "" && e.key === "N" && e.shiftKey) {
      e.preventDefault();
      if (window.confirm("Start a new game? This clears everything (you can still undo).")) reset();
    }
  };

  return (
    <div className="sticky top-0 z-20 -mx-4 mb-4 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-center gap-3">
          <label htmlFor="quick" className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gold">
            {state.stage ?? "Quick"}
          </label>
          <input
            id="quick"
            ref={input}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Enter = next round · 38 l7 h64 · ie jinx · -bf · u = undo"
            autoComplete="off"
            spellCheck={false}
            className="min-w-0 flex-1 rounded-md border border-line bg-panel px-3 py-2 font-mono text-sm placeholder:text-muted focus:border-gold"
          />
          <button
            type="button"
            onClick={undo}
            disabled={!canUndo}
            className="shrink-0 rounded-md border border-line px-2 py-2 text-xs text-muted hover:text-gold-bright disabled:opacity-40"
            title="Undo the last change (u, or Ctrl/Cmd+Z in an empty bar)"
          >
            Undo
          </button>
        </div>

        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5 text-xs">
          {result ? (
            <>
              {result.steps.map((s, i) => (
                <span
                  key={i}
                  className={`rounded-full border px-2 py-0.5 ${s.ok ? "border-line text-gold-bright" : "border-bad text-bad"}`}
                >
                  {s.text}
                </span>
              ))}
              <span className="text-muted">{result.ok ? "Enter to apply" : "Fix the red words to apply"}</span>
            </>
          ) : (
            <RoundHint stage={state.stage} picked={state.augments.length} />
          )}
        </div>
      </div>
    </div>
  );
}

/** What this round usually asks for, or the grammar when there is nothing to say. */
function RoundHint({ stage, picked }: { stage: string | null; picked: number }) {
  const augmentAt = stage ? ctx.augmentRounds.indexOf(stage) : -1;
  if (augmentAt >= picked) {
    return <span className="text-gold">Augment round: type the augment you take.</span>;
  }
  if (stage && isCarousel(stageIndex(stage, economyModel), economyModel)) {
    return <span className="text-gold">Carousel: type the component or item you take.</span>;
  }
  return (
    <span className="text-muted">
      {HELP.map(([keys, what]) => (
        <span key={keys} className="mr-3 whitespace-nowrap">
          <kbd className="font-mono text-gold-bright">{keys}</kbd> {what}
        </span>
      ))}
      <span className="whitespace-nowrap">
        <kbd className="font-mono text-gold-bright">Shift+N</kbd> new game
      </span>
    </span>
  );
}
