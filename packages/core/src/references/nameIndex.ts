export type NameSource = 'repo' | 'console';

export class NameIndex {
  private readonly scopes = new Map<string, Map<string, Set<NameSource>>>();

  add(kind: string, parents: readonly string[], name: string, source: NameSource): void {
    const key = scopeKey(kind, parents);
    const names = this.scopes.get(key) ?? new Map<string, Set<NameSource>>();
    this.scopes.set(key, names);
    names.set(name, (names.get(name) ?? new Set<NameSource>()).add(source));
  }

  list(kind: string, parents: readonly string[]): { name: string; sources: NameSource[] }[] {
    const names = this.scopes.get(scopeKey(kind, parents)) ?? new Map<string, Set<NameSource>>();
    return [...names]
      .map(([name, sources]) => ({ name, sources: (['repo', 'console'] as const).filter((s) => sources.has(s)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  has(kind: string, parents: readonly string[], name: string): boolean {
    return this.scopes.get(scopeKey(kind, parents))?.has(name) ?? false;
  }
}

export function describeSources(sources: readonly NameSource[]): string {
  return sources.map((s) => (s === 'console' ? 'Console' : 'repo')).join(' + ');
}

function scopeKey(kind: string, parents: readonly string[]): string {
  return [kind, ...parents].join('\0');
}
