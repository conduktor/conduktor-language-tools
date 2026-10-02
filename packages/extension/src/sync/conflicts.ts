interface Described {
  kind: string;
  parents: readonly string[];
  name: string;
  path: string;
}

export function sharedIdentities(entries: readonly Described[]): string[] {
  const byIdentity = new Map<string, Described[]>();
  for (const entry of entries) {
    const key = [entry.kind, ...entry.parents, entry.name].join('\0');
    byIdentity.set(key, [...(byIdentity.get(key) ?? []), entry]);
  }
  return [...byIdentity.values()]
    .filter((group) => group.length > 1)
    .map((group) => `${group[0]!.kind} ${group[0]!.name}: ${group.map((e) => e.path).join(', ')}`);
}
