import { describe, expect, it } from "vitest";
import economyJson from "@/data/economy.json";
import { COMP_STYLES, EconomyModelSchema, type CompStyle } from "@/data/schema";
import { isCarousel, nextStage, roundIncome, stageIndex, stageLabel, stageLabels, styleOutlook, type Economy } from "./economy";

const model = EconomyModelSchema.parse(economyJson);
const verdicts = (economy: Economy) =>
  Object.fromEntries(COMP_STYLES.map((s) => [s, styleOutlook(s, economy, model)?.verdict])) as Record<
    CompStyle,
    string | undefined
  >;

describe("styleOutlook", () => {
  it("rules out Fast 9 for a level 8 player on 4-2 with 30 gold and 20 HP", () => {
    const v = verdicts({ level: 8, gold: 30, hp: 20, stage: "4-2" });
    expect(v["fast-9"]).toBe("unrealistic");
    expect(v["fast-8"]).toBe("realistic");
    expect(styleOutlook("fast-9", { level: 8, gold: 30, hp: 20, stage: "4-2" }, model)!.note).toMatch(/HP/);
  });

  it("sends a poor level 5 player on 3-5 to a 1- or 2-cost reroll, whatever their HP", () => {
    for (const hp of [100, 20]) {
      const v = verdicts({ level: 5, gold: 60, hp, stage: "3-5" });
      expect(v["fast-8"]).toBe("unrealistic");
      expect(v["fast-9"]).toBe("unrealistic");
      expect(v["reroll-1"]).toBe("realistic");
      expect(v["reroll-2"]).toBe("realistic");
    }
    expect(verdicts({ level: 5, gold: 60, hp: 100, stage: "3-5" })["reroll-3"]).toBe("stretch");
  });

  it("lets a healthy, on-curve player go Fast 8", () => {
    expect(verdicts({ level: 7, gold: 50, hp: 80, stage: "4-1" })["fast-8"]).toBe("realistic");
  });

  it("keeps every style open at 2-1 with full HP", () => {
    const v = verdicts({ level: 4, gold: 10, hp: 100, stage: "2-1" });
    expect(COMP_STYLES.filter((s) => v[s] !== "realistic")).toEqual([]);
  });

  it("calls a reroll a stretch once the player is well above its level", () => {
    const outlook = styleOutlook("reroll-1", { level: 8, gold: 50, hp: 60, stage: "4-2" }, model)!;
    expect(outlook.verdict).toBe("stretch");
    expect(outlook.note).toMatch(/1-costs/);
  });

  it("ignores HP when it is unknown, and says nothing without gold or stage", () => {
    expect(verdicts({ level: 8, gold: 30, hp: null, stage: "4-2" })["fast-9"]).not.toBe("unrealistic");
    expect(styleOutlook("fast-8", { level: 8, gold: null, hp: 50, stage: "4-2" }, model)).toBeNull();
    expect(styleOutlook("fast-8", { level: 8, gold: 30, hp: 50, stage: null }, model)).toBeNull();
  });

  it("explains every verdict", () => {
    for (const style of COMP_STYLES) {
      expect(styleOutlook(style, { level: 6, gold: 25, hp: 40, stage: "3-3" }, model)!.note.length).toBeGreaterThan(10);
    }
  });
});

describe("stages", () => {
  it("round-trips labels and lists every round", () => {
    expect(stageLabel(stageIndex("4-2", model), model)).toBe("4-2");
    expect(stageIndex("2-1", model)).toBe(0);
    const labels = stageLabels(model);
    expect(labels[0]).toBe("2-1");
    expect(labels.at(-1)).toBe("7-7");
  });

  it("gives every style a deadline no earlier than its ideal stage", () => {
    for (const s of Object.values(model.styles)) {
      expect(stageIndex(s.deadline, model)).toBeGreaterThanOrEqual(stageIndex(s.ideal, model));
    }
  });

  it("steps to the next round, starting at 2-1 and stopping at the last", () => {
    expect(nextStage(null, model)).toBe("2-1");
    expect(nextStage("3-2", model)).toBe("3-3");
    expect(nextStage("3-7", model)).toBe("4-1");
    expect(nextStage("7-7", model)).toBe("7-7");
  });
});

describe("roundIncome", () => {
  it("pays base income plus capped interest, and knows the carousel round", () => {
    expect(roundIncome(9, model)).toBe(5);
    expect(roundIncome(34, model)).toBe(8);
    expect(roundIncome(120, model)).toBe(10);
    expect(isCarousel(stageIndex("3-4", model), model)).toBe(true);
    expect(isCarousel(stageIndex("3-5", model), model)).toBe(false);
  });
});
