"use client";

import { useMemo, useState } from "react";
import { compBySlug, comps } from "@/data";
import { useGame } from "@/store/useGame";
import { Panel } from "./ui";

const byName = [...comps].sort((a, b) => a.name.localeCompare(b.name));

export function ScoutPanel() {
  const opponents = useGame((s) => s.opponents);
  const setOpponent = useGame((s) => s.setOpponent);

  return (
    <Panel title="Opponent Compositions" hint="Contested comps rank lower">
      <ul className="space-y-2">
        {opponents.map((slug, i) => {
          const label = `Opponent ${i + 1}`;
          return (
            <li key={i} className="flex items-center gap-2">
              <label htmlFor={`opponent-${i}`} className="w-20 shrink-0 text-sm text-muted">
                {label}
              </label>
              <CompCombobox id={`opponent-${i}`} value={slug} onChange={(next) => setOpponent(i, next)} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** A text box that searches the comps as you type, with the full list a click away. */
function CompCombobox({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string | null;
  onChange: (slug: string | null) => void;
}) {
  // While the box has focus this holds its text; otherwise it shows the chosen comp.
  const [query, setQuery] = useState<string | null>(null);
  // The list stays unfiltered until something is typed, so focusing shows every comp.
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(0);
  const open = query !== null;
  const name = value ? (compBySlug(value)?.name ?? "") : "";

  // Comps whose name starts with the search come first, then any that contain it.
  const options = useMemo(() => {
    const q = typed ? (query ?? "").trim().toLowerCase() : "";
    if (!q) return [null, ...byName.map((c) => c.slug)];
    const starts = byName.filter((c) => c.name.toLowerCase().startsWith(q));
    const contains = byName.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q));
    return [...starts, ...contains].map((c) => c.slug);
  }, [query, typed]);

  const choose = (slug: string | null) => {
    onChange(slug);
    setQuery(null);
  };

  const listId = `${id}-list`;
  const optionId = (i: number) => `${id}-option-${i}`;

  return (
    <div className="relative min-w-0 flex-1">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && options.length ? optionId(active) : undefined}
        autoComplete="off"
        value={query ?? name}
        placeholder="Unknown"
        onFocus={(e) => {
          setQuery(name);
          setTyped(false);
          setActive(0);
          // Keep the chosen name visible but selected, so typing replaces it.
          e.currentTarget.select();
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setTyped(true);
          setActive(0);
        }}
        onBlur={() => {
          // Clearing the box marks the opponent unknown; a half-typed search is dropped.
          if (typed && query?.trim() === "") choose(null);
          else setQuery(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setQuery(name);
              setTyped(false);
            }
            const step = e.key === "ArrowDown" ? 1 : -1;
            setActive((i) => (options.length ? (i + step + options.length) % options.length : 0));
          } else if (e.key === "Enter" && open && options.length) {
            e.preventDefault();
            choose(options[active]);
          } else if (e.key === "Escape") {
            setQuery(null);
          }
        }}
        className={`w-full rounded-md border bg-ink px-2 py-1.5 text-sm placeholder:text-muted ${
          value ? "border-gold/60 text-gold-bright" : "border-line"
        }`}
      />
      {open && (
        <ul
          id={listId}
          role="listbox"
          // Keep focus in the box while clicking an option.
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-line bg-panel-2 py-1 text-sm shadow-lg shadow-black/40"
        >
          {options.map((slug, i) => (
            <li
              key={slug ?? "unknown"}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => choose(slug)}
              className={`cursor-pointer px-2 py-1 ${i === active ? "bg-gold/20 text-gold-bright" : ""} ${
                slug === value ? "font-semibold text-gold" : slug ? "" : "text-muted"
              }`}
            >
              {slug ? compBySlug(slug)?.name : "Unknown"}
            </li>
          ))}
          {!options.length && <li className="px-2 py-1 text-muted">No match.</li>}
        </ul>
      )}
    </div>
  );
}
