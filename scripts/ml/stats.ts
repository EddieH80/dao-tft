/** Coverage and size statistics for a generated split. */
import type { Mention, StateUpdate } from "../../src/assistant/contract";
import { KEY_ORDER } from "./labels";
import type { Example } from "./render";
import { resolveName, type Vocab } from "./vocab";

export interface SplitStats {
  examples: number;
  emptyLabels: number;
  byMode: Record<string, number>;
  byScenario: Record<string, number>;
  /** Examples whose label has each top-level field. */
  examplesPerField: Record<string, number>;
  /** Share of examples with each field, in percent. */
  fieldCoverage: Record<string, number>;
  mentions: {
    total: number;
    perList: Record<string, number>;
    withCount: number;
    withStars: number;
    withAt: number;
    /** What each mention's name resolves to; "unresolved" is mostly typos. */
    byKind: Record<string, number>;
  };
  examplesWithTypos: number;
  length: { chars: Distribution; words: Distribution; wordHistogram: Record<string, number> };
  templates: number;
}

export interface Distribution {
  min: number;
  p10: number;
  p50: number;
  p90: number;
  max: number;
  mean: number;
}

function distribution(xs: number[]): Distribution {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    min: s[0],
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    max: s[s.length - 1],
    mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 10) / 10,
  };
}

const WORD_BUCKETS: [string, number][] = [
  ["1", 1],
  ["2-3", 3],
  ["4-6", 6],
  ["7-10", 10],
  ["11-15", 15],
  ["16-25", 25],
  ["26+", Infinity],
];

const bump = (o: Record<string, number>, k: string, n = 1) => (o[k] = (o[k] ?? 0) + n);

export function splitStats(examples: Example[], v: Vocab): SplitStats {
  const byMode: Record<string, number> = {};
  const byScenario: Record<string, number> = {};
  const examplesPerField = Object.fromEntries(KEY_ORDER.map((k) => [k, 0])) as Record<string, number>;
  const perList: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  const wordHistogram = Object.fromEntries(WORD_BUCKETS.map(([b]) => [b, 0])) as Record<string, number>;
  const templates = new Set<string>();
  let total = 0,
    withCount = 0,
    withStars = 0,
    withAt = 0,
    empty = 0,
    typos = 0;
  const chars: number[] = [];
  const words: number[] = [];

  for (const ex of examples) {
    bump(byMode, ex.meta.mode);
    bump(byScenario, ex.meta.scenario);
    ex.meta.templates.forEach((t) => templates.add(t));
    if (ex.meta.typos) typos++;
    const label = ex.label as StateUpdate;
    if (!Object.keys(label).length) empty++;
    for (const k of Object.keys(label)) bump(examplesPerField, k);
    for (const list of ["set", "remove", "add", "craft"] as const) {
      for (const m of (label[list] ?? []) as Mention[]) {
        total++;
        bump(perList, list);
        if (m.count) withCount++;
        if (m.stars) withStars++;
        if (m.at) withAt++;
        const id = resolveName(v.lexicon, m.name);
        bump(byKind, id ? (v.byId.get(id)?.kind ?? "other") : "unresolved");
      }
    }
    chars.push(ex.text.length);
    const n = ex.text.split(/\s+/).filter(Boolean).length;
    words.push(n);
    bump(wordHistogram, WORD_BUCKETS.find(([, max]) => n <= max)![0]);
  }

  const pct = (n: number) => Math.round((n / examples.length) * 1000) / 10;
  return {
    examples: examples.length,
    emptyLabels: empty,
    byMode,
    byScenario,
    examplesPerField,
    fieldCoverage: Object.fromEntries(Object.entries(examplesPerField).map(([k, n]) => [k, pct(n)])),
    mentions: { total, perList, withCount, withStars, withAt, byKind },
    examplesWithTypos: typos,
    length: { chars: distribution(chars), words: distribution(words), wordHistogram },
    templates: templates.size,
  };
}

/** The stats as a markdown report. */
export function statsMarkdown(stats: Record<string, SplitStats>): string {
  const splits = Object.keys(stats);
  const row = (label: string, f: (s: SplitStats) => string | number) => `| ${label} | ${splits.map((s) => f(stats[s])).join(" | ")} |`;
  const head = `| | ${splits.join(" | ")} |\n|---|${splits.map(() => "---:").join("|")}|`;
  const keys = (pick: (s: SplitStats) => Record<string, number>) => [...new Set(splits.flatMap((s) => Object.keys(pick(stats[s]))))];
  const lines = [
    "# Generated data stats",
    "",
    "## Overview",
    head,
    row("examples", (s) => s.examples),
    row("empty labels `{}`", (s) => s.emptyLabels),
    row("examples with a typo", (s) => s.examplesWithTypos),
    row("distinct templates", (s) => s.templates),
    ...keys((s) => s.byMode).map((k) => row(`mode: ${k}`, (s) => s.byMode[k] ?? 0)),
    ...keys((s) => s.byScenario).map((k) => row(`scenario: ${k}`, (s) => s.byScenario[k] ?? 0)),
    "",
    "## Field coverage (examples with the field, and % of the split)",
    head,
    ...KEY_ORDER.map((k) => row(`\`${k}\``, (s) => `${s.examplesPerField[k]} (${s.fieldCoverage[k]}%)`)),
    "",
    "## Mentions",
    head,
    row("total", (s) => s.mentions.total),
    ...["set", "remove", "add", "craft"].map((k) => row(`in \`${k}\``, (s) => s.mentions.perList[k] ?? 0)),
    row("with `count`", (s) => s.mentions.withCount),
    row("with `stars`", (s) => s.mentions.withStars),
    row("with `at`", (s) => s.mentions.withAt),
    ...keys((s) => s.mentions.byKind).map((k) => row(`resolves to ${k}`, (s) => s.mentions.byKind[k] ?? 0)),
    "",
    "## Length",
    head,
    ...(["min", "p10", "p50", "p90", "max", "mean"] as const).map((q) =>
      row(`chars ${q} / words ${q}`, (s) => `${s.length.chars[q]} / ${s.length.words[q]}`),
    ),
    ...WORD_BUCKETS.map(([b]) => row(`${b} words`, (s) => s.length.wordHistogram[b])),
    "",
  ];
  return lines.join("\n");
}
