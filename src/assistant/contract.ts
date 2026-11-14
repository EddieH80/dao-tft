import { z } from "zod";

/**
 * What the on-device model outputs for one player message: a partial update to
 * the game state, never a full state. See docs/ml-state-contract.md for the
 * labeling rules and how an update is resolved and applied.
 *
 * Names are the player's own words, not ids: the app resolves them against the
 * current snapshot with the quick bar's lexicon, so the model never needs to
 * know ids or game facts.
 */

/** The three augment selections, in order (matches src/data/augments-*.json). */
export const AUGMENT_SELECTIONS = ["2-1", "3-2", "4-2"] as const;

/** Categories `clear` can empty. */
export const CATEGORIES = ["components", "items", "board", "augments"] as const;

/** Same limits as the quick bar (src/engine/quick.ts) and the store. */
export const LIMITS = {
  minLevel: 2,
  maxLevel: 10,
  maxGold: 200,
  maxHp: 100,
  maxCount: 20,
  maxMentions: 20,
} as const;

/** One thing the player named. */
export const MentionSchema = z
  .strictObject({
    /** The player's words for the thing, as typed: "bows", "IE", "kha", "sivir beast within". */
    name: z.string().trim().min(1).max(40),
    /** A number or "x2" before the name. Left out for one, so every label has one form. */
    count: z.int().min(2).max(LIMITS.maxCount).optional(),
    /** A 1-3 or "N star" after the name: "jinx 2", "2* jinx", "2 star jinx". */
    stars: z.literal([1, 2, 3]).optional(),
    /** The augment selection a pick was made at, when the player says so. */
    at: z.enum(AUGMENT_SELECTIONS).optional(),
  })
  .refine((m) => m.count === undefined || m.stars === undefined, {
    message: "A mention has a count or a star level, not both",
  })
  .refine((m) => m.at === undefined || (m.count === undefined && m.stars === undefined), {
    message: "An augment pick (at) has no count or star level",
  });
export type Mention = z.infer<typeof MentionSchema>;

/** Lowercased, trimmed name plus its star level and selection: two mentions with the same key must be merged. */
const mentionKey = (m: Mention) => `${m.name.trim().toLowerCase()}|${m.stars ?? ""}|${m.at ?? ""}`;

const Mentions = z
  .array(MentionSchema)
  .min(1)
  .max(LIMITS.maxMentions)
  .refine((ms) => new Set(ms.map(mentionKey)).size === ms.length, {
    message: "Repeated name in one list: merge it into one mention with a count",
  });

export const StateUpdateSchema = z
  .strictObject({
    /** Undo the last change: a lone "u" / "undo", as in the quick bar. Nothing else may be set with it. */
    undo: z.literal(true).optional(),
    level: z.int().min(LIMITS.minLevel).max(LIMITS.maxLevel).optional(),
    /** Move to the next round: "n", "next", "next round". The app projects the gold (`advanceRound`). */
    next: z.literal(true).optional(),
    gold: z.int().min(0).max(LIMITS.maxGold).optional(),
    hp: z.int().min(0).max(LIMITS.maxHp).optional(),
    /** The current round. */
    stage: z
      .string()
      .regex(/^[2-7]-[1-7]$/, "a stage like 4-2")
      .optional(),
    /**
     * Categories emptied before `set` is applied: ones the player has none of
     * ("no components"), or a board or augment list they give in full ("my board is ...").
     */
    clear: z
      .array(z.enum(CATEGORIES))
      .min(1)
      .refine((cs) => new Set(cs).size === cs.length, {
        message: "Repeated category",
      })
      .optional(),
    /**
     * What the player says they hold, with no event verb: a bare list, or "I have ...".
     * Replaces the components and the items if it names any; units and augments
     * named here are added (or have their stars set) and the rest stay.
     */
    set: Mentions.optional(),
    /** Sold, lost or used up: "sold jinx", "lost a bow". */
    remove: Mentions.optional(),
    /** Gained: "got", "hit", "took", "grabbed". Items come without using up components. */
    add: Mentions.optional(),
    /**
     * Crafted ("made", "built", "slammed"), and bare names in quick-bar syntax. Applied as the quick
     * bar applies a plain name: an item uses up both components when held; anything else is added.
     */
    craft: Mentions.optional(),
  })
  .refine((u) => !u.undo || Object.keys(u).length === 1, {
    message: "undo comes alone",
  });
export type StateUpdate = z.infer<typeof StateUpdateSchema>;
