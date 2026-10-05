import type { KindCatalog } from '../openapi/kindCatalog';
import type { YamlPath } from '../resources/yamlPaths';
import { isRecord } from '../util';
import { patternTypeOf, type PatternReading, type PatternType } from './patterns';
import { REFERENCE_RULES, type ReferenceRule } from './table';

export interface Reference {
  rule: ReferenceRule;
  path: YamlPath;
  value: string;
  kind: string;
  parents: string[] | undefined;
  scope: (string | undefined)[];
  pattern?: { reading: PatternReading; type: PatternType };
  wildcard: boolean;
}

export function findReferences(resource: unknown, catalog: KindCatalog): Reference[] {
  if (!isRecord(resource) || typeof resource.kind !== 'string') return [];
  const found: Reference[] = [];
  for (const rule of REFERENCE_RULES.filter((r) => r.kind === resource.kind)) {
    for (const path of concretePaths(resource, rule.path)) {
      const reference = resolve(rule, resource, path, catalog);
      if (reference && reference.value !== '') found.push(reference);
    }
  }
  const order = documentOrder(resource);
  const position = (path: YamlPath) => order.get(path.join('\0')) ?? 0;
  return found.sort((a, b) => position(a.path) - position(b.path));
}

export function referenceAt(resource: unknown, catalog: KindCatalog, path: YamlPath): Reference | undefined {
  if (!isRecord(resource) || typeof resource.kind !== 'string') return undefined;
  const rule = REFERENCE_RULES.find((r) => r.kind === resource.kind && fits(r.path, path));
  return rule && resolve(rule, resource, path, catalog);
}

function resolve(
  rule: ReferenceRule,
  resource: Record<string, unknown>,
  path: YamlPath,
  catalog: KindCatalog,
): Reference | undefined {
  const raw = valueAtPath(resource, path);
  if (raw !== undefined && raw !== null && typeof raw !== 'string') return undefined;
  const item = valueAtPath(resource, path.slice(0, -1));
  const sibling = (field: string) => (isRecord(item) ? item[field] : undefined);
  const read = (where: string | undefined) =>
    where === undefined
      ? undefined
      : where.startsWith('.')
        ? sibling(where.slice(1))
        : valueAtPath(resource, where.split('.'));
  const kind = typeof rule.target === 'string' ? rule.target : rule.target.kinds[String(sibling(rule.target.by))];
  const target = kind ? catalog.latest(kind) : undefined;
  if (!kind || !target) return undefined;
  const value = raw ?? '';
  const scope: Record<string, unknown> = { cluster: read(rule.cluster), connectCluster: read(rule.connectCluster) };
  const parentValues = target.parentPathParams.map((param) => scope[param]);
  const known = parentValues.every((v) => typeof v === 'string' && v !== '' && v !== '*');
  return {
    rule,
    path,
    value,
    kind,
    parents: known ? (parentValues as string[]) : undefined,
    scope: parentValues.map((v) => (typeof v === 'string' && v !== '' ? v : undefined)),
    ...(rule.pattern && { pattern: { reading: rule.pattern, type: patternTypeOf(sibling('patternType')) } }),
    wildcard: !!rule.wildcard && value === '*',
  };
}

function concretePaths(resource: unknown, pattern: string): YamlPath[] {
  const segments = pattern.replace(/\[\]/g, '.[]').split('.');
  const walk = (node: unknown, i: number, at: YamlPath): YamlPath[] => {
    if (i === segments.length) return [at];
    const segment = segments[i]!;
    if (segment === '[]') return Array.isArray(node) ? node.flatMap((item, n) => walk(item, i + 1, [...at, n])) : [];
    return isRecord(node) && segment in node ? walk(node[segment], i + 1, [...at, segment]) : [];
  };
  return walk(resource, 0, []);
}

function fits(pattern: string, path: YamlPath): boolean {
  const segments = pattern.replace(/\[\]/g, '.[]').split('.');
  return (
    segments.length === path.length &&
    segments.every((s, i) => (s === '[]' ? typeof path[i] === 'number' : s === path[i]))
  );
}

function valueAtPath(node: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((at, key) => (isRecord(at) || Array.isArray(at) ? (at as never)[key] : undefined), node);
}

// Document order, so Problems and lenses read top to bottom.
function documentOrder(resource: unknown): Map<string, number> {
  const order = new Map<string, number>();
  const walk = (node: unknown, at: YamlPath) => {
    order.set(at.join('\0'), order.size);
    if (Array.isArray(node)) node.forEach((item, i) => walk(item, [...at, i]));
    else if (isRecord(node)) for (const [key, value] of Object.entries(node)) walk(value, [...at, key]);
  };
  walk(resource, []);
  return order;
}
