import { describe, expect, it } from "vitest";
import { buildPrompt, promptPreamble } from "../../../src/assistant/prompt";
import { serialize } from "../labels";
import { buildVocab } from "../vocab";
import { trainPromptRows } from "./prompts";

const lexicon = buildVocab().lexicon;

describe("trainPromptRows", () => {
  const label = { gold: 26, set: [{ name: "soraka" }] };
  const example = { id: "train-x", text: "I have soraka, 26 gold", label, target: serialize(label) };

  it("holds the app's own final user turn and the canonical target", () => {
    const { rows, normalized } = trainPromptRows([example], lexicon);
    const messages = buildPrompt(example.text, lexicon);
    expect(rows).toEqual([{ id: "train-x", user: messages.at(-1)!.content, target: '{"gold":26,"set":[{"name":"soraka"}]}' }]);
    expect(normalized).toEqual([]);
    // Preamble plus this user turn is exactly what the app sends.
    expect([...promptPreamble(lexicon), { role: "user", content: rows[0].user }]).toEqual(messages);
  });

  it("trains on the label as the schema reads it, and reports the change", () => {
    const spaced = { set: [{ name: "soraka " }] };
    const { rows, normalized } = trainPromptRows([{ ...example, label: spaced, target: serialize(spaced) }], lexicon);
    expect(rows[0].target).toBe('{"set":[{"name":"soraka"}]}');
    expect(normalized).toEqual(["train-x"]);
  });

  it("refuses a target that isn't the canonical label", () => {
    expect(() => trainPromptRows([{ ...example, target: '{"set":[{"name":"soraka"}],"gold":26}' }], lexicon)).toThrow(/canonical/);
  });
});
