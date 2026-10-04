import { describeSources, type NameSource, type Reference } from '@conduktor/vscode-core';

type Lensable = Pick<Reference, 'value' | 'wildcard' | 'pattern'>;
type Match = { name: string; sources: NameSource[] };

export function lensTitle(kind: string, reference: Lensable, matched: readonly Match[]): string {
  if (reference.wildcard) return `$(search) all ${matched.length} ${kind} resources`;
  if (reference.pattern?.type === 'PREFIXED' || matched.length > 1)
    return `$(search) matches ${matched.length} ${kind} resources`;
  const [only] = matched;
  return only
    ? `$(search) ${only.name} · ${describeSources(only.sources)}`
    : `$(search) no ${kind} ${reference.value} yet`;
}
