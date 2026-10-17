import type { Drift } from '@conduktor/core';

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
  return [...byIdentity.values()].flatMap((group) => {
    const [first] = group;
    return first && group.length > 1 ? [`${first.kind} ${first.name}: ${group.map((e) => e.path).join(', ')}`] : [];
  });
}

export function driftNotes(entries: readonly { path: string; drift?: Drift | undefined }[]): string[] {
  const paths = (drift: Drift) =>
    entries
      .filter((entry) => entry.drift === drift)
      .map((entry) => entry.path)
      .join(', ');
  return [
    paths('changed') && `Changed on the Console since they were synced, and will be overwritten: ${paths('changed')}.`,
    paths('deleted') &&
      `Deleted from the Console since they were synced, and will be created again: ${paths('deleted')}.`,
  ].filter((note) => note !== '');
}
