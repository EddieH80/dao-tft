import { describe, expect, it } from "vitest";
import { buildVocab } from "../vocab";
import { isQuickBarLine, labelCategories } from "./categories";
import type { Predictions } from "./predictions";
import { parseOutput, score } from "./score";
import type { TestSet } from "./testsets";

const SHA = "a".repeat(64);

/** Eight examples; every expected number below was worked out by hand. */
const testSet: TestSet = {
  name: "fixture",
  sha256: SHA,
  examples: [
    { id: "e1", text: "lvl 6 32g 2 bows sword", label: { level: 6, gold: 32, set: [{ name: "bows", count: 2 }, { name: "sword" }] } },
    { id: "e2", text: "got IE", label: { add: [{ name: "IE" }] } },
    { id: "e3", text: "I'm 7 at 4-1", label: { level: 7, stage: "4-1" } },
    { id: "e4", text: "made IE", label: { craft: [{ name: "IE" }] } },
    { id: "e5", text: "52", label: { gold: 52 } },
    { id: "e6", text: "bow", label: { set: [{ name: "bow" }] } },
    { id: "e7", text: "should I roll?", label: {} },
    {
      id: "e8",
      text: "my board is akali 2 shen",
      label: { clear: ["board"], set: [{ name: "akali", stars: 2 }, { name: "shen" }] },
    },
  ],
};

const outputs: Record<string, string> = {
  // Keys and mentions in another order: still exact.
  e1: '{"set":[{"name":"sword"},{"name":"bows","count":2}],"gold":32,"level":6}',
  // Case differs: exact (the app normalizes names), not verbatim.
  e2: '{"add":[{"name":"ie"}]}',
  // Wrong level: one FP and one FN on level; stage right.
  e3: '{"level":8,"stage":"4-1"}',
  // An extra mention: craft P 1/2.
  e4: '{"craft":[{"name":"IE"},{"name":"bow"}]}',
  // Not JSON: invalid, scored as {}.
  e5: "gold: 52",
  // count 1 fails the schema: invalid, scored as {}.
  e6: '{"set":[{"name":"bow","count":1}]}',
  // Nothing to update, and nothing predicted: exact.
  e7: "{}",
  // Missed the clear and one unit.
  e8: '{"set":[{"name":"akali","stars":2}]}',
};

const predictions = (over: Partial<Predictions["header"]> = {}, rows = Object.entries(outputs).map(([id, output]) => ({ id, output }))): Predictions => ({
  header: { predictions: 1, system: "test", testSet: "fixture", testSetSha256: SHA, createdAt: "2026-11-19T00:00:00Z", ...over },
  rows,
});

const categorize = (ex: { id: string }) => (Number(ex.id.slice(1)) <= 4 ? ["a"] : ["b"]);

describe("score", () => {
  const r = score(testSet, predictions(), categorize);

  it("counts exact matches, verbatim matches and schema-valid outputs", () => {
    // Exact: e1, e2, e7. Verbatim: e1, e7. Invalid: e5, e6.
    expect(r.summary).toMatchObject({
      n: 8,
      exact: 3,
      exactRate: 3 / 8,
      exactVerbatim: 2,
      exactVerbatimRate: 2 / 8,
      schemaValid: 6,
      schemaValidRate: 6 / 8,
    });
  });

  it("gives per-field precision and recall", () => {
    // level: gold e1, e3; predicted e1, e3 (8 is wrong); tp e1.
    expect(r.fields.level).toMatchObject({ tp: 1, predicted: 2, gold: 2, precision: 0.5, recall: 0.5 });
    // gold: gold e1, e5; predicted e1 only (e5 invalid).
    expect(r.fields.gold).toMatchObject({ tp: 1, predicted: 1, gold: 2, precision: 1, recall: 0.5 });
    expect(r.fields.stage).toMatchObject({ tp: 1, predicted: 1, gold: 1, precision: 1, recall: 1 });
    // set: gold 2 (e1) + 1 (e6) + 2 (e8) = 5; predicted 2 (e1) + 1 (e8) = 3, all right.
    expect(r.fields.set).toMatchObject({ tp: 3, predicted: 3, gold: 5, precision: 1, recall: 0.6 });
    // add: "ie" matches "IE" after normalizing.
    expect(r.fields.add).toMatchObject({ tp: 1, predicted: 1, gold: 1, precision: 1, recall: 1 });
    expect(r.fields.craft).toMatchObject({ tp: 1, predicted: 2, gold: 1, precision: 0.5, recall: 1 });
    // clear: one gold, none predicted, so precision has no denominator.
    expect(r.fields.clear).toMatchObject({ tp: 0, predicted: 0, gold: 1, precision: null, recall: 0, f1: null });
    // Never in gold or predictions.
    expect(r.fields.undo).toMatchObject({ tp: 0, predicted: 0, gold: 0, precision: null, recall: null, f1: null });
  });

  it("micro-averages over all fields", () => {
    // tp 1+1+1+3+1+1 = 8; predicted 2+1+1+3+1+2 = 10; gold 2+2+1+5+1+1+1 = 13.
    expect(r.summary.micro.tp).toBe(8);
    expect(r.summary.micro.predicted).toBe(10);
    expect(r.summary.micro.gold).toBe(13);
    expect(r.summary.micro.precision).toBeCloseTo(0.8);
    expect(r.summary.micro.recall).toBeCloseTo(8 / 13);
    expect(r.summary.micro.f1).toBeCloseTo(16 / 23); // 2·tp / (predicted + gold)
  });

  it("breaks results down by category", () => {
    // a = e1-e4: exact e1, e2; all valid; tp 4+1+1+1, predicted 4+1+2+2, gold 4+1+2+1.
    expect(r.categories.a).toMatchObject({ n: 4, exact: 2, exactVerbatim: 1, schemaValid: 4 });
    expect(r.categories.a.micro).toMatchObject({ tp: 7, predicted: 9, gold: 8 });
    // b = e5-e8: exact e7; valid e7, e8; tp 1 (akali), predicted 1, gold 1+1+0+3.
    expect(r.categories.b).toMatchObject({ n: 4, exact: 1, exactVerbatim: 1, schemaValid: 2 });
    expect(r.categories.b.micro).toMatchObject({ tp: 1, predicted: 1, gold: 5, precision: 1, recall: 0.2 });
  });

  it("lists every row that isn't an exact verbatim match", () => {
    expect(r.mismatches.map((m) => m.id)).toEqual(["e2", "e3", "e4", "e5", "e6", "e8"]);
    const e2 = r.mismatches[0];
    expect(e2).toMatchObject({ exact: true, exactVerbatim: false });
    expect(r.mismatches.find((m) => m.id === "e5")!.prediction).toHaveProperty("error");
  });

  it("counts a repeated mention once per copy", () => {
    const one: TestSet = { ...testSet, examples: [{ id: "x", text: "", label: { craft: [{ name: "bow" }] } }] };
    const p = predictions({}, [{ id: "x", output: '{"craft":[{"name":"bow","count":2}]}' }]);
    // A count is part of the mention: bow ×2 isn't bow.
    expect(score(one, p, () => []).fields.craft).toMatchObject({ tp: 0, predicted: 1, gold: 1 });
  });

  it("refuses predictions for another test set or version, or with missing, extra or repeated ids", () => {
    expect(() => score(testSet, predictions({ testSet: "other" }), categorize)).toThrow(/for other/);
    expect(() => score(testSet, predictions({ testSetSha256: "b".repeat(64) }), categorize)).toThrow(/different version/);
    const rows = predictions().rows;
    expect(() => score(testSet, predictions({}, rows.slice(1)), categorize)).toThrow(/no prediction for 1 examples: e1/);
    expect(() => score(testSet, predictions({}, [...rows, { id: "e9", output: "{}" }]), categorize)).toThrow(/not in fixture: e9/);
    expect(() => score(testSet, predictions({}, [...rows, rows[0]]), categorize)).toThrow(/e1 is repeated/);
  });
});

describe("parseOutput", () => {
  it("rejects bad JSON and labels that fail the schema", () => {
    expect(parseOutput('{"gold":52}')).toEqual({ ok: true, update: { gold: 52 } });
    expect(parseOutput("{gold:52}")).toMatchObject({ ok: false, error: expect.stringMatching(/^not JSON/) });
    expect(parseOutput('{"gold":999}')).toMatchObject({ ok: false, error: expect.stringMatching(/^gold:/) });
    expect(parseOutput('{"undo":true,"gold":5}')).toMatchObject({ ok: false, error: expect.stringContaining("undo comes alone") });
  });
});

describe("categories", () => {
  const lexicon = buildVocab().lexicon;

  it("tags a label's shape and features", () => {
    expect(labelCategories({})).toEqual(["empty"]);
    expect(labelCategories({ undo: true })).toEqual(["command"]);
    expect(labelCategories({ next: true, gold: 38 })).toEqual(["scalars-only", "next"]);
    expect(labelCategories({ clear: ["board"], set: [{ name: "akali", stars: 2 }] })).toEqual(["lists-only", "clear", "stars"]);
    expect(labelCategories({ goldChange: 3, remove: [{ name: "shen" }], add: [{ name: "x", at: "2-1" }] })).toEqual([
      "scalars+lists",
      "change",
      "at",
    ]);
    expect(labelCategories({ set: [{ name: "bows", count: 2 }] })).toEqual(["lists-only", "count"]);
  });

  it("recognizes quick-bar lines (rule 22)", () => {
    for (const t of ["52", "u", "52 l7 n", "n 38 h71 ie", "bow sword -akali", "veigar2", "4-2 l7", "titans resolve tear of the goddess lv8"]) expect(isQuickBarLine(t, lexicon), t).toBe(true);
    for (const t of ["2 bows", "sword sword bow", "lvl 6 32 2 bows", "level 6 g30", "got IE", "Bow chain cloak", "crafted hextech. g45", ""]) {
      expect(isQuickBarLine(t, lexicon), t).toBe(false);
    }
  });
});
