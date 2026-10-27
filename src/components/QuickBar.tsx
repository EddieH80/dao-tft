"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { aliases, augmentStages, catalog, economyModel } from "@/data";
import { isCarousel, stageIndex } from "@/engine/economy";
import {
  QuickLexicon,
  applyCompletion,
  augmentProblem,
  quickCompletions,
  runQuick,
  type CompletionOption,
  type QuickContext,
} from "@/engine/quick";
import { quickStateOf, useGame } from "@/store/useGame";

const ctx: QuickContext = {
  catalog,
  lexicon: new QuickLexicon(catalog, aliases),
  model: economyModel,
  augmentRounds: augmentStages.map((s) => ({ stage: s.stage, augments: new Set(s.augments.map((a) => a.id)) })),
};

const HELP: [string, string][] = [
  ["Enter", "next round"],
  ["38", "gold"],
  ["l7", "level"],
  ["h64", "HP"],
  ["4-2", "round"],
  ["ie jinx", "add"],
  ["Tab", "complete a name"],
  ["jinx2", "star level"],
  ["-bf", "remove"],
  ["+ie", "add without using components"],
  ["u", "undo"],
];

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

/** One line for every update, so a round between fights takes a few keystrokes. */
export function QuickBar() {
  const [text, setText] = useState("");
  /** The command list is pinned open with `?` + Enter or the ? button. */
  const [help, setHelp] = useState(false);
  const asking = text.trim() === "?";
  const input = useRef<HTMLInputElement>(null);
  const state = useGame(useShallow(quickStateOf));
  const canUndo = useGame((s) => s.history.length > 0);
  const { apply, nextRound, undo, reset } = useGame(
    useShallow((s) => ({ apply: s.apply, nextRound: s.nextRound, undo: s.undo, reset: s.reset })),
  );
  const result = useMemo(() => (text.trim() && !asking ? runQuick(text, state, ctx) : null), [text, asking, state]);
  // Augments the next selection cannot take are not suggested.
  const completion = useMemo(() => {
    const accept = (o: CompletionOption) => o.type !== "augment" || !augmentProblem(state, o.id, ctx);
    return quickCompletions(text, ctx.lexicon, 3, accept);
  }, [text, state]);

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
    if (asking) setHelp((h) => !h);
    else if (!result) nextRound();
    else if (result.undo) undo();
    else if (result.ok) apply(result.state);
    else return;
    setText("");
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const atEnd = e.currentTarget.selectionStart === text.length;
    if (e.key === "Tab" && !e.shiftKey && completion && atEnd) {
      e.preventDefault();
      setText(applyCompletion(text, completion, completion.options[0].name));
    } else if (e.key === "Enter") {
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
    <div className="sticky top-14 z-20 -mx-4 mb-4 border-b border-line bg-ink/95 px-4 py-3 backdrop-blur">
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
            placeholder="Type a command, or ? for help"
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
          <button
            type="button"
            onClick={() => setHelp((h) => !h)}
            aria-expanded={help}
            aria-controls="quick-help"
            className={`shrink-0 rounded-md border px-2.5 py-2 text-xs ${
              help ? "border-gold text-gold-bright" : "border-line text-muted hover:text-gold-bright"
            }`}
            title={help ? "Hide commands" : "Show commands"}
          >
            ?
          </button>
        </div>

        <div className="mt-2 flex min-h-6 flex-wrap items-center gap-1.5 text-xs">
          {completion && (
            <span className="mr-1 flex items-center gap-1.5" aria-live="polite">
              <kbd className="rounded border border-gold px-1 font-mono text-[10px] text-gold">Tab</kbd>
              {completion.options.map((o, i) => (
                <span key={o.name} className={i === 0 ? "font-semibold text-gold-bright" : "text-muted"}>
                  {o.name}
                  {i < completion.options.length - 1 && <span className="font-normal text-muted"> ·</span>}
                </span>
              ))}
            </span>
          )}
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
          ) : asking ? (
            <span className="text-muted">Enter to {help ? "hide" : "keep"} the commands</span>
          ) : (
            <RoundHint stage={state.stage} picked={state.augments.length} />
          )}
        </div>
        {(help || asking) && <Commands />}
      </div>
    </div>
  );
}

/** What this round usually asks for, or where to find the commands when there is nothing to say. */
function RoundHint({ stage, picked }: { stage: string | null; picked: number }) {
  const augmentAt = stage ? ctx.augmentRounds.findIndex((r) => r.stage === stage) : -1;
  if (augmentAt >= picked) {
    return <span className="text-gold">Augment round: type the augment you take.</span>;
  }
  if (stage && isCarousel(stageIndex(stage, economyModel), economyModel)) {
    return <span className="text-gold">Carousel: type the component or item you take.</span>;
  }
  return (
    <span className="text-muted">
      Type <kbd className="font-mono">?</kbd> for commands
    </span>
  );
}

/** The bar's grammar, framed as help so it is not mistaken for the game state. */
function Commands() {
  return (
    <div id="quick-help" className="mt-2 rounded-md border border-dashed border-line px-3 py-2 text-xs text-muted">
      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider">Commands</p>
      {HELP.map(([keys, what]) => (
        <span key={keys} className="mr-3 inline-block whitespace-nowrap">
          <kbd className="font-mono text-gold">{keys}</kbd> {what}
        </span>
      ))}
      <span className="inline-block whitespace-nowrap">
        <kbd className="font-mono text-gold">Shift+N</kbd> new game
      </span>
    </div>
  );
}
