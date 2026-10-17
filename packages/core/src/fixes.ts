import { stringify } from 'yaml';

/** Offsets in a document's text, and what replaces what lies between them. */
export interface TextEdit {
  start: number;
  end: number;
  newText: string;
}

/** A quick fix: one edit, under the title an editor shows. */
export interface Fix {
  title: string;
  edit: TextEdit;
}

/** The one edit that turns `before` into `after`: what lies between their common start and their common end. */
export function editBetween(before: string, after: string): TextEdit {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  return { start, end: before.length - end, newText: after.slice(start, after.length - end) };
}

/** A scalar's new value in the quotes the old one had, or quoted only where YAML would read it as something else. */
export function scalarYaml(value: string, written: string): string {
  if (written.startsWith("'")) return `'${value.replaceAll("'", "''")}'`;
  // In a flow map, a plain `a,b` would end at the comma.
  if (written.startsWith('"') || /[,[\]{}#]/.test(value)) return JSON.stringify(value);
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

/**
 * The candidates close enough to `name` to be what was meant, nearest first: a different case, or a few letters
 * typed wrong, missing, added or swapped. A name too short to have a typo in it gets none.
 */
export function closest(name: string, candidates: Iterable<string>, limit = 3): string[] {
  const allowed = Math.max(1, Math.floor(name.length / 4));
  const scored: [string, number, number][] = [];
  for (const candidate of new Set(candidates)) {
    if (candidate === name) continue;
    const distance = typoDistance(name.toLowerCase(), candidate.toLowerCase());
    if (distance <= allowed && distance < name.length)
      scored.push([candidate, distance, typoDistance(name, candidate)]);
  }
  return scored
    .sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([candidate]) => candidate);
}

// Edits to go from one to the other, a swap of two neighbours counting as one.
function typoDistance(a: string, b: string): number {
  const width = b.length + 1;
  const cells: number[] = [];
  const at = (i: number, j: number) => cells[i * width + j] ?? 0;
  for (let i = 0; i <= a.length; i++)
    for (let j = 0; j <= b.length; j++) {
      let best =
        i === 0 || j === 0
          ? i + j
          : Math.min(at(i - 1, j) + 1, at(i, j - 1) + 1, at(i - 1, j - 1) + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) best = Math.min(best, at(i - 2, j - 2) + 1);
      cells[i * width + j] = best;
    }
  return at(a.length, b.length);
}
