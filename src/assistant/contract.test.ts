import { describe, expect, it } from "vitest";
import { StateUpdateSchema } from "./contract";

/** Labels from docs/ml-state-contract.md, keyed by the player's input. */
const valid: [input: string, label: unknown][] = [
  [
    "level 6, 32 gold, two bows and a sword",
    { level: 6, gold: 32, set: [{ name: "bows", count: 2 }, { name: "sword" }] },
  ],
  ["2 bows", { set: [{ name: "bows", count: 2 }] }],
  ["got 2 bows", { add: [{ name: "bows", count: 2 }] }],
  ["jinx 2", { set: [{ name: "jinx", stars: 2 }] }],
  ["2 jinx", { set: [{ name: "jinx", count: 2 }] }],
  ["took the 2-1 augment", {}],
  ["took cybernetic uplink at 2-1", { add: [{ name: "cybernetic uplink", at: "2-1" }] }],
  ["slammed IE on ashe", { craft: [{ name: "IE" }] }],
  ["sold jinx, put in vi", { remove: [{ name: "jinx" }], add: [{ name: "vi" }] }],
  [
    "my board is ashe 2, draven, taric",
    { clear: ["board"], set: [{ name: "ashe", stars: 2 }, { name: "draven" }, { name: "taric" }] },
  ],
  ["no components, I'm 7 at 4-1", { level: 7, stage: "4-1", clear: ["components"] }],
  ["45 hp, 0 gold", { gold: 0, hp: 45 }],
  ["level 10", { level: 10 }],
  ["2-1 cybernetic uplink", { stage: "2-1", set: [{ name: "cybernetic uplink" }] }],
  ["took gain 21 gold", { add: [{ name: "gain 21 gold" }] }],
  ["jinx and vi 2", { set: [{ name: "jinx" }, { name: "vi", stars: 2 }] }],
  ["sword sword bow", { set: [{ name: "sword", count: 2 }, { name: "bow" }] }],
  [
    "2-1 was uplink, 3-2 glass cannon 2",
    {
      set: [
        { name: "uplink", at: "2-1" },
        { name: "glass cannon 2", at: "3-2" },
      ],
    },
  ],
  // Same name, different star levels, are different mentions (the resolver reports the clash).
  [
    "vi 1 and vi 2",
    {
      set: [
        { name: "vi", stars: 1 },
        { name: "vi", stars: 2 },
      ],
    },
  ],
  // Quick-bar syntax: labeled as the quick bar reads it.
  ["52", { gold: 52 }],
  ["52 l7 n", { level: 7, next: true, gold: 52 }],
  ["n 38 h71 ie", { next: true, gold: 38, hp: 71, craft: [{ name: "ie" }] }],
  [
    "l8 bow -jinx +ie kog2",
    {
      level: 8,
      remove: [{ name: "jinx" }],
      add: [{ name: "ie" }],
      craft: [{ name: "bow" }, { name: "kog", stars: 2 }],
    },
  ],
  ["u", { undo: true }],
  ["next round", { next: true }],
];

/** Outputs a model might produce that must never reach the store. */
const invalid: [why: string, output: unknown][] = [
  ["not an object", "level 6"],
  ["level below 2", { level: 1 }],
  ["level above 10", { level: 11 }],
  ["gold above 200", { gold: 250 }],
  ["negative gold", { gold: -5 }],
  ["fractional gold", { gold: 12.5 }],
  ["HP above 100", { hp: 120 }],
  ["number as string", { level: "6" }],
  ["stage 1-x", { stage: "1-3" }],
  ["stage without a dash", { stage: "3.2" }],
  ["unknown field", { level: 6, opponents: ["ashe"] }],
  ["null instead of leaving a field out", { gold: null }],
  ["id instead of a name field", { add: [{ id: "DA_InfinityEdge" }] }],
  ["empty name", { set: [{ name: "  " }] }],
  ["count of 1 (left out instead)", { set: [{ name: "bow", count: 1 }] }],
  ["count of 0", { remove: [{ name: "bow", count: 0 }] }],
  ["4-star unit", { set: [{ name: "jinx", stars: 4 }] }],
  ["stars as string", { set: [{ name: "jinx", stars: "2" }] }],
  ["count and stars together", { set: [{ name: "jinx", count: 2, stars: 2 }] }],
  ["augment pick with stars", { add: [{ name: "glass cannon", at: "3-2", stars: 2 }] }],
  ["selection that has no augment", { add: [{ name: "cybernetic uplink", at: "3-1" }] }],
  ["empty list (left out instead)", { set: [] }],
  ["repeated name in one list", { set: [{ name: "bow" }, { name: "Bow" }] }],
  ["unknown category", { clear: ["bench"] }],
  ["repeated category", { clear: ["items", "items"] }],
  ["undo with anything else", { undo: true, gold: 30 }],
  ["undo: false (left out instead)", { undo: false }],
  ["next: false (left out instead)", { next: false }],
];

describe("StateUpdateSchema", () => {
  it.each(valid)("accepts the label for %j", (_, label) => {
    expect(StateUpdateSchema.safeParse(label).success).toBe(true);
  });

  it.each(invalid)("rejects %s", (_, output) => {
    expect(StateUpdateSchema.safeParse(output).success).toBe(false);
  });

  it("trims names", () => {
    expect(StateUpdateSchema.parse({ add: [{ name: " bow " }] })).toEqual({ add: [{ name: "bow" }] });
  });
});
