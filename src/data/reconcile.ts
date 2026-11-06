import type { Snapshot } from "./schema";

/**
 * Repairs hand-kept data files after a Community Dragon refresh, so a patch
 * that renames or removes an id does not block the daily refresh
 * (scripts/reconcile-data.ts, run by .github/workflows/refresh-data.yml).
 *
 * Only ids that were in the previous snapshot and are gone from the new one are
 * touched, so a typo (an id no snapshot ever had) still fails validation.
 */

const SECTIONS = ["components", "items", "uncraftables", "units", "traits", "augments"] as const;

export interface SnapshotDiff {
  /** Old id -> new id: the only id new to its section with the same name. */
  renamed: Map<string, string>;
  /** Gone ids with no single same-name replacement, with their old names. */
  removed: Map<string, string>;
  /** Names of every gone id, for the report. */
  names: Map<string, string>;
}

export function diffSnapshots(old: Snapshot, next: Snapshot): SnapshotDiff {
  const ids = (s: Snapshot) => new Set(SECTIONS.flatMap((k) => s[k].map((e) => e.id)));
  const oldIds = ids(old);
  const nextIds = ids(next);
  const renamed = new Map<string, string>();
  const removed = new Map<string, string>();
  const names = new Map<string, string>();

  for (const section of SECTIONS) {
    const added = next[section].filter((e) => !oldIds.has(e.id));
    for (const { id, name } of old[section]) {
      if (nextIds.has(id)) continue;
      names.set(id, name);
      const same = added.filter((e) => e.name === name);
      if (same.length === 1) renamed.set(id, same[0].id);
      else removed.set(id, name);
    }
  }
  return { renamed, removed, names };
}

/** How removed ids may be dropped from a file; files not listed here are never trimmed. */
export type FileKind = "stage-augments" | "comp-augments" | "aliases" | "other";

export function fileKind(name: string): FileKind {
  if (/^augments-\d-\d\.json$/.test(name)) return "stage-augments";
  if (name === "comp-augments.json") return "comp-augments";
  if (name === "aliases.json") return "aliases";
  return "other";
}

const quoted = (id: string) => JSON.stringify(id);

/** One-line entries that can be dropped whole: `{"augment": "ID", ...},` and `"alias": "ID",`. */
const droppable: Record<"comp-augments" | "aliases", (line: string, id: string) => boolean> = {
  "comp-augments": (line, id) => /^\s*\{.*\},?\s*$/.test(line) && line.includes(`"augment": ${quoted(id)}`),
  aliases: (line, id) => new RegExp(`^\\s*"[a-z0-9]+": ${escape(quoted(id))},?\\s*$`).test(line),
};

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Removes whole lines, then drops the comma left dangling before a closing bracket. */
function dropLines(text: string, drop: (line: string) => boolean): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if (!drop(line)) {
      out.push(line);
      continue;
    }
    // The last entry in a list has no comma, so the entry before it must lose its own.
    if (!line.trimEnd().endsWith(",")) {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].trim() === "") continue;
        if (out[i].trimEnd().endsWith(",")) out[i] = out[i].replace(/,(\s*)$/, "$1");
        break;
      }
    }
  }
  return out.join("\n");
}

const label = (id: string, diff: SnapshotDiff) => {
  const name = diff.names.get(id);
  return name ? `${id} (${name})` : id;
};

/** Applies the diff to one file's text; returns it unchanged, with no changes, when nothing applies. */
export function reconcileFile(name: string, text: string, diff: SnapshotDiff): { text: string; changes: string[] } {
  const changes: string[] = [];
  let next = text;

  for (const [from, to] of diff.renamed) {
    if (!next.includes(quoted(from))) continue;
    next = next.split(quoted(from)).join(quoted(to));
    changes.push(`${name}: renamed ${label(from, diff)} to ${to}`);
  }

  const kind = fileKind(name);
  if (kind === "other") return { text: next, changes };

  for (const id of diff.removed.keys()) {
    if (!next.includes(quoted(id))) continue;
    let trimmed: string;
    if (kind === "stage-augments") {
      const pool = JSON.parse(next) as { augments: { id: string }[] };
      pool.augments = pool.augments.filter((a) => a.id !== id);
      trimmed = JSON.stringify(pool, null, 2) + "\n";
    } else {
      const drop = droppable[kind];
      trimmed = dropLines(next, (line) => drop(line, id));
    }
    // Leave anything that would not parse, or that still mentions the id, for a person to fix.
    try {
      JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (trimmed.includes(quoted(id))) continue;
    next = trimmed;
    changes.push(`${name}: dropped ${label(id, diff)}, no longer in the game`);
  }
  return { text: next, changes };
}
