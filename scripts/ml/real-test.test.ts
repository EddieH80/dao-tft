import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Deduper } from "./dedupe";
import { REAL_TEST_FILE, checkRealExamples } from "./real-test";
import { buildVocab } from "./vocab";

const v = buildVocab();
const row = (o: Record<string, unknown>) => JSON.stringify({ id: "r0001", status: "confirmed", ...o });
const check = (...lines: string[]) => checkRealExamples(lines.join("\n"), v);
const messages = (...lines: string[]) => check(...lines).issues.map((i) => `${i.level}: ${i.message}`);

describe("real test set checker", () => {
  it("passes a clean confirmed example", () => {
    const r = check(
      row({ text: "lvl 6 32g 2 bows and a sword", label: { level: 6, gold: 32, set: [{ name: "bows", count: 2 }, { name: "sword" }] } }),
    );
    expect(r.issues).toEqual([]);
    expect(r.examples[0]).toMatchObject({ id: "r0001", status: "confirmed" });
  });

  it("accepts an empty file and blank lines", () => {
    expect(check("", "  ")).toEqual({ examples: [], issues: [] });
  });

  it("rejects malformed lines and rows", () => {
    expect(messages("{not json")[0]).toMatch(/^error: not valid JSON/);
    expect(messages(row({ id: "7", text: "l7", label: { level: 7 } }))).toEqual(['error: id: an id like "r0001"']);
    expect(messages(row({ text: "l7", label: { level: 7 }, status: "done" }))[0]).toMatch(/^error: status/);
    expect(messages(row({ text: "l7", label: { level: 7 }, extra: 1 }))[0]).toMatch(/^error: line: Unrecognized key/);
  });

  it("rejects a label the contract schema rejects", () => {
    expect(messages(row({ text: "lvl 11", label: { level: 11 } }))[0]).toMatch(/^error: label fails the contract schema: level/);
  });

  it("rejects repeated ids and texts", () => {
    const a = row({ text: "l7", label: { level: 7 } });
    const b = row({ id: "r0002", text: "l7", label: { level: 7 } });
    expect(messages(a, a)).toContain("error: id r0001 is used twice");
    expect(messages(a, b)).toEqual(["error: the same text is in another example"]);
    expect(messages(a, row({ id: "r0002", text: "L7!", label: { level: 7 } }))).toEqual(["warning: nearly the same text as another example"]);
  });

  it("requires names copied verbatim from the text (rule 1)", () => {
    expect(messages(row({ text: "got a bow", label: { add: [{ name: "Recurve Bow" }] } }))).toEqual([
      'error: "Recurve Bow" in add isn\'t copied from the text',
    ]);
    expect(messages(row({ text: "got a Bow", label: { add: [{ name: "bow" }] } }))).toEqual([
      'error: "bow" in add isn\'t copied from the text (the case differs; copy it as typed)',
    ]);
  });

  it("warns about names that don't resolve or could be several things", () => {
    expect(messages(row({ text: "jnx 2", label: { set: [{ name: "jnx", stars: 2 }] } }))).toEqual([
      `warning: "jnx" in set doesn't resolve; the app will suggest a match or drop it (fine if typed that way, rule 4)`,
    ]);
    expect(messages(row({ text: "took tons of stats", label: { add: [{ name: "tons of stats" }] } }))).toEqual([
      'warning: "tons of stats" in add could be Tons of Stats!, TONS of Stats!',
    ]);
  });

  it("warns about numbers on the wrong kind of thing", () => {
    expect(messages(row({ text: "bow 2", label: { set: [{ name: "bow", stars: 2 }] } }))).toEqual([
      "warning: \"bow\" in set has a star level, but Recurve Bow isn't a unit",
    ]);
    expect(messages(row({ text: "2 jinx kog", label: { set: [{ name: "kog", count: 2 }] } }))).toEqual([
      'warning: "kog" in set: a count on a unit is ignored when applied (A5)',
    ]);
    expect(messages(row({ text: "took ie at 2-1", label: { add: [{ name: "ie", at: "2-1" }] } }))).toEqual([
      "warning: \"ie\" in add has at 2-1, but Infinity Edge isn't an augment",
    ]);
    expect(messages(row({ text: "made bow", label: { craft: [{ name: "bow" }] } }))).toEqual([
      'warning: "bow" in craft: crafting a non-item is a plain add, right only in a quick-bar line',
    ]);
  });

  it("warns about an augment taken at a selection that doesn't offer it", () => {
    // Beast Within (Sivir) is only offered at 3-2.
    expect(messages(row({ text: "took sivir beast within at 2-1", label: { add: [{ name: "sivir beast within", at: "2-1" }] } }))).toEqual([
      "warning: Beast Within isn't offered at 2-1",
    ]);
  });

  it("warns about values the text doesn't contain, and unlikely ones", () => {
    expect(messages(row({ text: "lvl 6", label: { level: 7 } }))).toEqual(["warning: level 7 isn't in the text"]);
    expect(messages(row({ text: "on 3-2", label: { stage: "3-3" } }))).toEqual(["warning: stage 3-3 isn't in the text"]);
    expect(messages(row({ text: "stage 3 round 2", label: { stage: "3-2" } }))).toEqual([]);
    expect(messages(row({ text: "sold vi for 2", label: { goldChange: 2, remove: [{ name: "vi" }] } }))).toEqual([]);
    expect(messages(row({ text: "rolled 30", label: { goldChange: 30 } }))).toEqual([
      "warning: goldChange 30 is a gain, but the text doesn't sell anything or name a source (rule 16b)",
    ]);
    expect(messages(row({ text: "rolled 30", label: { goldChange: -20 } }))).toEqual([
      "warning: goldChange -20 isn't in the text (fine if it sums several amounts)",
    ]);
    expect(messages(row({ text: "lvl 9 at 2-1", label: { level: 9, stage: "2-1" } }))).toEqual(["warning: level 9 is unlikely at 2-1"]);
    expect(messages(row({ text: "undo the bow", label: { undo: true } }))).toEqual([
      'warning: undo is only for "u" / "undo" as a command, or undo of the last entry or round (rule 25)',
    ]);
    expect(messages(row({ text: "forgot my gold, undo", label: { undo: true } }))).toEqual([]);
    expect(messages(row({ text: "undo the last entry", label: { undo: true } }))).toEqual([]);
    expect(messages(row({ text: "5 gold from an orb", label: { goldChange: 5 } }))).toEqual([]);
    expect(messages(row({ text: "lost 15 hp", label: { hpChange: -12 } }))).toEqual(["warning: hpChange -12 isn't in the text"]);
    expect(messages(row({ text: "restart", label: { newGame: true } }))).toEqual([
      'warning: newGame is set, but the text doesn\'t say "new game" (rule 26)',
    ]);
    expect(messages(row({ text: "lvl 6, should I roll?", label: { level: 6 } }))).toEqual([
      "warning: the text asks a question: label only statements outside it (rule 21)",
    ]);
    expect(messages(row({ text: "what items given I have a guinsoo", label: { set: [{ name: "guinsoo" }] } }))).toEqual([
      "warning: the text asks a question: label only statements outside it (rule 21)",
    ]);
  });

  it("warns about impossible combinations", () => {
    expect(messages(row({ text: "got bow, lost bow", label: { add: [{ name: "bow" }], remove: [{ name: "bow" }] } }))).toEqual([
      "warning: Recurve Bow is in both remove and add",
    ]);
    const units = ["ashe", "draven", "taric", "vi", "kog", "sett", "ahri", "lux"];
    expect(
      messages(
        row({
          text: `my board is ${units.join(" ")}, lvl 5`,
          label: { level: 5, clear: ["board"], set: units.map((name) => ({ name })) },
        }),
      ),
    ).toEqual(["warning: the board has 8 units at level 5"]);
  });

  it("warns when a real example matches synthetic data", () => {
    const synthetic = new Deduper();
    synthetic.add("lvl 6, 32g");
    const r = checkRealExamples(row({ text: "Lvl 6 32g", label: { level: 6, gold: 32 } }), v, synthetic);
    expect(r.issues.map((i) => i.message)).toEqual(["nearly the same text is in the synthetic data"]);
  });

  it("passes the committed file", () => {
    const r = checkRealExamples(readFileSync(resolve(__dirname, "../..", REAL_TEST_FILE), "utf8"), v);
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
  });
});

describe("real test set isolation", () => {
  it("is never read by the generator (Project rules, docs/ml-plan.md)", () => {
    const allowed = new Set(["real-test.ts", "real-test.test.ts"]);
    for (const f of readdirSync(__dirname).filter((f) => f.endsWith(".ts") && !allowed.has(f))) {
      expect(readFileSync(resolve(__dirname, f), "utf8"), f).not.toMatch(/real-test/);
    }
  });
});
