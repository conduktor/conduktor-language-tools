import type { KindCatalog } from '../openapi/kindCatalog';
import { findReferences, type Reference } from './extract';
import { matcher } from './patterns';
import { REFERENCE_RULES } from './table';

export interface ReferenceTarget {
  kind: string;
  parents: readonly string[];
  name: string;
}

export type Reach = 'names' | 'matches' | 'covers';

export function referrersOf(
  target: ReferenceTarget,
  resources: readonly unknown[],
  catalog: KindCatalog,
): { index: number; reference: Reference; how: Reach }[] {
  const found: { index: number; reference: Reference; how: Reach }[] = [];
  resources.forEach((resource, index) => {
    for (const reference of findReferences(resource, catalog)) {
      if (reference.kind !== target.kind) continue;
      const inScope = target.parents.every((parent, i) => reference.scope[i] === parent || reference.scope[i] === '*');
      const how = inScope ? reach(reference, target.name) : undefined;
      if (how) found.push({ index, reference, how });
    }
  });
  return found;
}

export function referencingKinds(kind: string): string[] {
  const refers = REFERENCE_RULES.filter((rule) =>
    typeof rule.target === 'string' ? rule.target === kind : Object.values(rule.target.kinds).includes(kind),
  );
  return [...new Set(refers.map((rule) => rule.kind))];
}

function reach(reference: Reference, name: string): Reach | undefined {
  if (reference.wildcard) return 'covers';
  const { pattern } = reference;
  // A permission's LITERAL foo* is a prefix; any other LITERAL names one resource.
  const isPattern = pattern?.type === 'PREFIXED' || (pattern?.reading === 'rbac' && reference.value.endsWith('*'));
  if (!pattern || !isPattern) return reference.value === name ? 'names' : undefined;
  return matcher(pattern.reading, pattern.type, reference.value)(name) ? 'matches' : undefined;
}
