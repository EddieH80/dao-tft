/** Builds labels in the contract's canonical form (docs/ml-state-contract.md section 1). */
import type { CATEGORIES, Mention, StateUpdate } from "../../src/assistant/contract";

export type ListKey = "set" | "remove" | "add" | "craft";
export type Category = (typeof CATEGORIES)[number];
type Scalars = Pick<StateUpdate, "undo" | "level" | "next" | "gold" | "hp" | "stage">;

/** Key order of a serialized label. */
export const KEY_ORDER = ["undo", "level", "next", "gold", "hp", "stage", "clear", "set", "remove", "add", "craft"] as const;
const MENTION_ORDER = ["name", "count", "stars", "at"] as const;

const mentionKey = (m: Mention) => `${m.name.trim().toLowerCase()}|${m.stars ?? ""}|${m.at ?? ""}`;

export class LabelBuilder {
  private scalars: Scalars = {};
  private cleared: Category[] = [];
  private lists: Record<ListKey, Mention[]> = { set: [], remove: [], add: [], craft: [] };

  /** A later value replaces an earlier one (rule 20). */
  scalar<K extends keyof Scalars>(key: K, value: Scalars[K]): this {
    this.scalars[key] = value;
    return this;
  }

  clear(category: Category): this {
    if (!this.cleared.includes(category)) this.cleared.push(category);
    return this;
  }

  /** Adds a mention; the same name (with the same stars and selection) merges into a count (rule 5). */
  mention(list: ListKey, m: Mention): this {
    const same = this.lists[list].find((x) => mentionKey(x) === mentionKey(m));
    if (same) same.count = (same.count ?? 1) + (m.count ?? 1);
    else this.lists[list].push({ ...m });
    return this;
  }

  build(): StateUpdate {
    return canonical({ ...this.scalars, clear: this.cleared, ...this.lists } as StateUpdate);
  }
}

/** The label with keys in contract order, empty lists and `count: 1` left out. */
export function canonical(u: StateUpdate): StateUpdate {
  const out: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = u[key];
    if (value === undefined || (Array.isArray(value) && !value.length)) continue;
    out[key] =
      key === "set" || key === "remove" || key === "add" || key === "craft"
        ? (value as Mention[]).map((m) => {
            const o: Record<string, unknown> = {};
            for (const k of MENTION_ORDER) if (m[k] !== undefined && !(k === "count" && m[k] === 1)) o[k] = m[k];
            return o;
          })
        : value;
  }
  return out as StateUpdate;
}

/** The training target: compact JSON in canonical key order. */
export const serialize = (u: StateUpdate) => JSON.stringify(canonical(u));
