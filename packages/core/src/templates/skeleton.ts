import { Document, YAMLMap, type Pair } from 'yaml';
import type { KindVersion } from '../openapi/kindCatalog';
import type { JsonSchema } from '../openapi/types';
import { isRecord } from '../util';
import { bodyOf, partsOf, resolveNode, unionOf, type Answers } from './variants';

const MAX_DEPTH = 6;

/**
 * A new resource from its kind's schema: required fields with placeholders (the published example's value where the
 * example has the same variant), optional fields listed as comments, the chosen variant of each union.
 */
export function skeletonYaml(
  root: JsonSchema,
  kind: KindVersion,
  parents: Readonly<Record<string, string>>,
  name: string,
  answers: Answers,
): string {
  const example = isRecord(kind.applyExample) ? kind.applyExample : {};
  const body = bodyOf(root);
  const properties = isRecord(body.properties) ? (body.properties as Record<string, JsonSchema>) : {};
  const document = new Document({ apiVersion: `v${kind.version}`, kind: kind.kind });
  const metadata = properties.metadata
    ? renderObject(root, properties.metadata, ['metadata'], example.metadata, answers, document, 0)
    : new YAMLMap();
  // A name the schema fixes to a list (Integration: Email, Slack…) is only taken when it is one of them.
  const allowed = fixedNames(root);
  if (!allowed || allowed.includes(name)) metadata.set('name', name);
  for (const [param, value] of Object.entries(parents)) metadata.set(param, value);
  (document.contents as YAMLMap).set('metadata', metadata);
  const spec = properties.spec && render(root, properties.spec, ['spec'], example.spec, answers, document, 0);
  (document.contents as YAMLMap).set('spec', spec ?? new YAMLMap());
  return document.toString();
}

function render(
  root: JsonSchema,
  node: JsonSchema,
  path: string[],
  example: unknown,
  answers: Answers,
  document: Document,
  depth: number,
): unknown {
  const union = unionOf(root, node);
  if (union) {
    const key = path.join('.');
    // Unions inside list items are not asked for; they take their first variant.
    const chosen = key in answers ? answers[key] : union.options[0]!.value;
    const option = union.options.find((o) => o.value === chosen);
    if (!option) return undefined;
    const sameVariant = isRecord(example) && example[union.field] === chosen;
    const map = renderObject(root, option.schema, path, sameVariant ? example : undefined, answers, document, depth);
    map.items = map.items.filter(
      (pair) => String((pair.key as { value?: unknown })?.value ?? pair.key) !== union.field,
    );
    map.items.unshift(document.createPair(union.field, chosen) as Pair);
    return map;
  }
  const resolved = resolveNode(root, node);
  if (isObject(resolved)) return renderObject(root, resolved, path, example, answers, document, depth);
  return placeholder(root, resolved, example, path, answers, document, depth);
}

function renderObject(
  root: JsonSchema,
  node: JsonSchema,
  path: string[],
  example: unknown,
  answers: Answers,
  document: Document,
  depth: number,
): YAMLMap {
  const map = new YAMLMap();
  if (depth > MAX_DEPTH) return map;
  const optional: string[] = [];
  const seen = new Set<string>();
  for (const part of partsOf(root, node)) {
    const properties = isRecord(part.properties) ? (part.properties as Record<string, JsonSchema>) : {};
    const required = new Set(Array.isArray(part.required) ? (part.required as string[]) : []);
    for (const [key, child] of Object.entries(properties)) {
      if (seen.has(key)) continue;
      seen.add(key);
      const answered = unionOf(root, child) && typeof answers[[...path, key].join('.')] === 'string';
      if (!required.has(key) && !answered) {
        optional.push(`${key}: ${typeName(root, child)}`);
        continue;
      }
      const childExample = isRecord(example) ? example[key] : undefined;
      const value = render(root, child, [...path, key], childExample, answers, document, depth + 1);
      if (value !== undefined) map.items.push(document.createPair(key, value) as Pair);
    }
  }
  // An empty object stays `key: {}` with its optional fields on the same line: a field uncommented under a bare
  // `{}` would not parse.
  if (map.items.length === 0) {
    map.flow = true;
    if (optional.length > 0)
      map.comment = ` optional: ${optional.map((line) => line.replace(': ', ' (') + ')').join(', ')}`;
  } else if (optional.length > 0) {
    map.comment = optional.map((line) => ` ${line}`).join('\n');
  }
  return map;
}

function placeholder(
  root: JsonSchema,
  node: JsonSchema,
  example: unknown,
  path: string[],
  answers: Answers,
  document: Document,
  depth: number,
): unknown {
  if (example !== undefined && example !== null && typeof example !== 'object') return example;
  if (Array.isArray(node.enum)) return node.enum[0];
  if (node.const !== undefined) return node.const;
  switch (node.type) {
    case 'integer':
    case 'number':
      if (typeof node.exclusiveMinimum === 'number') return node.exclusiveMinimum + 1;
      return typeof node.minimum === 'number' ? node.minimum : 0;
    case 'boolean':
      return false;
    case 'array': {
      const items = isRecord(node.items) ? (node.items as JsonSchema) : {};
      const first = Array.isArray(example) ? example[0] : undefined;
      const item = render(root, items, [...path, '0'], first, answers, document, depth + 1);
      return item === undefined ? [] : [item];
    }
    default:
      return '';
  }
}

function shapeName(root: JsonSchema, node: JsonSchema): string {
  const reference = typeof node.$ref === 'string' ? node.$ref.split('/').pop()! : undefined;
  const resolved = resolveNode(root, node);
  return typeof resolved.title === 'string' ? resolved.title : (reference ?? typeName(root, node));
}

/** The names a kind's metadata.name is limited to (Integration: Email, Slack…), if any. */
export function fixedNames(root: JsonSchema): string[] | undefined {
  const body = bodyOf(root);
  const metadata = isRecord(body.properties) ? (body.properties as Record<string, JsonSchema>).metadata : undefined;
  const name = metadataField(root, metadata, 'name');
  return name && Array.isArray(name.enum) ? name.enum.map(String) : undefined;
}

function metadataField(root: JsonSchema, metadata: JsonSchema | undefined, field: string): JsonSchema | undefined {
  if (!metadata) return undefined;
  for (const part of partsOf(root, metadata)) {
    const properties = isRecord(part.properties) ? (part.properties as Record<string, JsonSchema>) : {};
    if (properties[field]) return resolveNode(root, properties[field]);
  }
  return undefined;
}

function isObject(node: JsonSchema): boolean {
  return node.type === 'object' || isRecord(node.properties) || Array.isArray(node.allOf);
}

function typeName(root: JsonSchema, node: JsonSchema): string {
  const union = unionOf(root, node);
  if (union) return `one of ${union.options.map((o) => o.value).join(', ')}`;
  const resolved = resolveNode(root, node);
  const shapes = resolved.oneOf ?? resolved.anyOf;
  if (Array.isArray(shapes))
    return `one of ${(shapes as JsonSchema[]).map((option) => shapeName(root, option)).join(', ')}`;
  if (Array.isArray(resolved.enum)) return resolved.enum.join(' | ');
  if (resolved.type === 'array')
    return `list of ${typeName(root, isRecord(resolved.items) ? (resolved.items as JsonSchema) : {})}`;
  if (isRecord(resolved.additionalProperties))
    return `map of ${typeName(root, resolved.additionalProperties as JsonSchema)}`;
  if (typeof resolved.type === 'string') return resolved.type;
  return typeof resolved.title === 'string' ? resolved.title : 'object';
}
