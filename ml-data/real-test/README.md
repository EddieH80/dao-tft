# Real-world test set

Messages a player actually typed mid-match, each with its label under
`docs/ml-state-contract.md`. This is the only test set not written by the
generator, so it is the honest measure of the model.

**Evaluation only.** Never used for training, for tuning the generator's
templates, or as prompt examples (see the Project rules in `docs/ml-plan.md`).

## Format

`examples.jsonl`: one JSON object per line.

```json
{"id":"r0001","text":"lvl 6 32g 2 bows and a sword","label":{"level":6,"gold":32,"set":[{"name":"bows","count":2},{"name":"sword"}]},"status":"confirmed"}
{"id":"r0002","text":"jinx 2 lol","label":{"set":[{"name":"jinx","stars":2}]},"status":"draft","note":"Jinx isn't in Set 18"}
```

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | `r` plus four digits, unique, never reused |
| `text` | yes | Exactly what was typed: typos, case and punctuation kept |
| `label` | yes | The contract label (`StateUpdateSchema`); `{}` when there is nothing to update |
| `status` | yes | `draft` (proposed, not yet checked) or `confirmed` (checked by the player) |
| `note` | no | Why a label is what it is, or what's unusual |

Only `confirmed` examples count in evals. Claude may write `draft` labels but
never sets `confirmed`; the player does.

## Checking

```
npm run ml:check-real
```

**Errors** fail the check and must be fixed:

- the JSON or a field is malformed;
- the label fails the contract schema;
- an id or text repeats;
- a name isn't copied verbatim from the text (rule 1).

**Warnings** are worth a look, but can be right:

- a name that doesn't resolve (fine for a typo, rule 4) or is ambiguous;
- a number or stage in the label that isn't in the text;
- a star level on a non-unit, `at` on a non-augment, a count on an augment;
- an augment that isn't offered at its `at` selection;
- a level that's unlikely for the stage, a board bigger than the level allows, more than 3 augments;
- the same thing in two lists, or text that nearly repeats another example;
- text that matches generated synthetic data (`ml-data/v1/`), exactly or nearly.
