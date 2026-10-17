import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Writes a fetched data file, keeping the old `fetchedAt` if nothing else
 * changed. The daily refresh (.github/workflows/refresh-data.yml) commits only
 * when the tree changes, so a new date alone must not count as new data.
 */
export function writeData(path: string, file: { fetchedAt: string } & Record<string, unknown>) {
  if (existsSync(path)) {
    const old = JSON.parse(readFileSync(path, "utf8")) as { fetchedAt?: string };
    if (old.fetchedAt && JSON.stringify({ ...file, fetchedAt: old.fetchedAt }) === JSON.stringify(old)) {
      file = { ...file, fetchedAt: old.fetchedAt };
    }
  }
  writeFileSync(path, JSON.stringify(file, null, 2) + "\n");
}
