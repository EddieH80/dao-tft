/**
 * Exact and near-duplicate detection. Two messages are near-duplicates when
 * they are equal after lowercasing and dropping punctuation ("Lvl 6, 32g" and
 * "lvl 6 32g"), or contain the same words in another order ("32g lvl 6").
 */

export function normText(text: string): string {
  return text
    .normalize("NFD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const wordSignature = (text: string) => normText(text).split(" ").sort().join(" ");

export type DupKind = "exact" | "near";

export class Deduper {
  private readonly exact = new Set<string>();
  private readonly near = new Set<string>();

  /** How `text` duplicates something already kept, or null if it doesn't. */
  check(text: string): DupKind | null {
    if (this.exact.has(text)) return "exact";
    if (this.near.has(normText(text)) || this.near.has(`~${wordSignature(text)}`)) return "near";
    return null;
  }

  add(text: string): void {
    this.exact.add(text);
    this.near.add(normText(text));
    this.near.add(`~${wordSignature(text)}`);
  }
}
