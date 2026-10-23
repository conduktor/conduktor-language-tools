export type PatternReading = 'selfServe' | 'dataQuality' | 'rbac' | 'kafkaAcl';
export type PatternType = 'LITERAL' | 'PREFIXED';

export interface OwnedResource {
  type: string;
  name: string;
  patternType: PatternType;
  connectCluster?: string;
}

export interface Instance {
  name: string;
  cluster: string;
  resources: OwnedResource[];
}

export function patternTypeOf(value: unknown): PatternType {
  return typeof value === 'string' && value.toUpperCase() === 'PREFIXED' ? 'PREFIXED' : 'LITERAL';
}

// The Console reads names three ways: self-serve ownership and data quality targets compare characters as written;
// RBAC permissions treat a trailing * as a prefix; service-account ACLs go to Kafka, where LITERAL * is a wildcard.
export function matcher(reading: PatternReading, type: PatternType, pattern: string): (name: string) => boolean {
  const everything = () => true;
  if (reading === 'rbac') {
    if (type === 'LITERAL' && pattern === '*') return everything;
    if (type === 'LITERAL' && pattern.endsWith('*')) return (name) => name.startsWith(pattern.slice(0, -1));
  }
  if (reading === 'kafkaAcl' && type === 'LITERAL' && pattern === '*') return everything;
  return type === 'PREFIXED' ? (name) => name.startsWith(pattern) : (name) => name === pattern;
}

export function patternTraps(
  reading: PatternReading,
  type: PatternType,
  pattern: string,
): { message: string; error: boolean }[] {
  if (!pattern.endsWith('*') || pattern === '*') return [];
  const base = pattern.slice(0, -1);
  switch (reading) {
    case 'selfServe':
      return [{ message: `Console rejects a name ending in *: use '${base}' with patternType PREFIXED.`, error: true }];
    case 'dataQuality':
      return [{ message: `The * is matched literally here: use '${base}' with patternType PREFIXED.`, error: false }];
    case 'rbac':
      return type === 'LITERAL'
        ? [{ message: `Console stores this as PREFIXED '${base}'.`, error: false }]
        : [{ message: `With PREFIXED the * is literal, so this matches nothing: use '${base}'.`, error: false }];
    case 'kafkaAcl':
      return [];
  }
}

export function collides(a: OwnedResource, b: OwnedResource): boolean {
  if (a.type !== b.type || (a.connectCluster ?? '') !== (b.connectCluster ?? '')) return false;
  return (
    a.name === b.name ||
    (a.patternType === 'PREFIXED' && b.name.startsWith(a.name)) ||
    (b.patternType === 'PREFIXED' && a.name.startsWith(b.name))
  );
}

export function overlapsOf(
  subject: Instance,
  others: readonly Instance[],
): { index: number; instance: string; resource: OwnedResource }[] {
  const found: { index: number; instance: string; resource: OwnedResource }[] = [];
  subject.resources.forEach((resource, index) => {
    subject.resources.forEach((other, j) => {
      if (j !== index && collides(resource, other)) found.push({ index, instance: subject.name, resource: other });
    });
    for (const instance of others) {
      if (instance.name === subject.name || instance.cluster !== subject.cluster) continue;
      for (const other of instance.resources)
        if (collides(resource, other)) found.push({ index, instance: instance.name, resource: other });
    }
  });
  return found;
}
