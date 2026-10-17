import type { KindCatalog } from '../openapi/kindCatalog';
import { rangeOf } from '../resources/yamlPaths';
import type { Resource } from '../resources/types';
import { isRecord } from '../util';
import { findReferences } from './extract';
import type { NameSource } from './nameIndex';
import { matcher, overlapsOf, patternTraps, patternTypeOf, type Instance } from './patterns';

/** Where an editor finds the names a reference can take. */
export interface NameLookup {
  /** `checked` is true only when the Console answered: a missing name is only missing then. */
  lookup(
    kind: string,
    parents: readonly string[],
  ): Promise<{ names: { name: string; sources: NameSource[] }[]; checked: boolean }>;
  /** The ApplicationInstances of the Console, then of the repository, which win over the Console's of the same name. */
  instances(): Promise<Resource[]>;
}

export interface ReferenceProblem {
  /** Offsets in the document's text. */
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning' | 'information';
}

/**
 * What is wrong with one resource's references: pattern traps, names that exist neither in the repository nor on the
 * Console (`consoleName`), patterns that match nothing yet, and, for an ApplicationInstance, resources another instance
 * already owns.
 */
export async function referenceProblems(
  text: string,
  resource: Resource,
  catalog: KindCatalog,
  consoleName: string,
  names: NameLookup,
): Promise<ReferenceProblem[]> {
  const found: ReferenceProblem[] = [];
  for (const reference of findReferences(resource, catalog)) {
    const range = rangeOf(text, reference.path);
    if (!range) continue;
    const problem = (message: string, severity: ReferenceProblem['severity']) =>
      found.push({ start: range[0], end: range[1], message, severity });
    const { pattern } = reference;
    if (pattern)
      for (const trap of patternTraps(pattern.reading, pattern.type, reference.value))
        problem(trap.message, trap.error ? 'error' : 'warning');
    if (reference.wildcard || !reference.parents) continue;
    const { names: known, checked } = await names.lookup(reference.kind, reference.parents);
    if (!checked) continue;
    // A permission's LITERAL foo* is a prefix too; any other LITERAL names one resource.
    const isPattern = pattern?.type === 'PREFIXED' || (pattern?.reading === 'rbac' && reference.value.endsWith('*'));
    if (isPattern) {
      const matches = matcher(pattern.reading, pattern.type, reference.value);
      if (!known.some((n) => matches(n.name))) problem(`Matches no ${reference.kind} yet.`, 'information');
    } else if (!known.some((n) => n.name === reference.value)) {
      problem(`${reference.kind} '${reference.value}' is not in the repository or on ${consoleName}.`, 'warning');
    }
  }
  if (resource.kind === 'ApplicationInstance') found.push(...(await overlaps(text, resource, names)));
  return found;
}

async function overlaps(text: string, resource: Resource, names: NameLookup): Promise<ReferenceProblem[]> {
  const subject = instanceOf(resource);
  if (!subject) return [];
  const byName = new Map<string, Instance>();
  for (const other of await names.instances()) {
    const instance = instanceOf(other);
    if (instance) byName.set(instance.name, instance);
  }
  return overlapsOf(subject, [...byName.values()]).flatMap(({ index, instance, resource: owned }) => {
    const range = rangeOf(text, ['spec', 'resources', index, 'name']);
    const owner = instance === subject.name ? 'this instance' : instance;
    const message = `Overlaps ${owned.type} ${owned.name} (${owned.patternType}) owned by ${owner}.`;
    return range ? [{ start: range[0], end: range[1], message, severity: 'warning' as const }] : [];
  });
}

/** An ApplicationInstance's cluster and owned resources, or `undefined` while it has neither. */
export function instanceOf(resource: Resource): Instance | undefined {
  const spec = isRecord(resource.spec) ? resource.spec : {};
  if (typeof spec.cluster !== 'string' || !Array.isArray(spec.resources)) return undefined;
  return {
    name: resource.metadata.name,
    cluster: spec.cluster,
    resources: spec.resources.filter(isRecord).map((r) => ({
      type: String(r.type),
      name: scalarText(r.name),
      patternType: patternTypeOf(r.patternType),
      ...(typeof r.connectCluster === 'string' && { connectCluster: r.connectCluster }),
    })),
  };
}

// A name YAML read as a number or a boolean, as written; anything but a scalar is no name.
function scalarText(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? String(value) : '';
}
