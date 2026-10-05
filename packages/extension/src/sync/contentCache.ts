import { createHash } from 'node:crypto';

/** What was computed from a file, kept while its content (and anything it was compared with) stays the same. */
export class ContentCache<T> {
  private entries = new Map<string, { hash: string; value: T }>();

  get(key: string, content: readonly (string | undefined)[], compute: () => T): T {
    const hash = digest(content);
    const cached = this.entries.get(key);
    if (cached?.hash === hash) return cached.value;
    const value = compute();
    this.entries.set(key, { hash, value });
    return value;
  }

  retain(keys: Iterable<string>): void {
    const keep = new Set(keys);
    for (const key of this.entries.keys()) if (!keep.has(key)) this.entries.delete(key);
  }

  clear(): void {
    this.entries = new Map();
  }
}

// Each part is length-prefixed, so ['xb', 'ase'] and ['x', 'base'] differ, and a missing part differs from ''.
function digest(content: readonly (string | undefined)[]): string {
  const hash = createHash('sha1');
  for (const part of content) hash.update(part === undefined ? '-|' : `${part.length}|`).update(part ?? '');
  return hash.digest('base64');
}
