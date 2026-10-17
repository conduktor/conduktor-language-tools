import { Document, isScalar, YAMLMap } from 'yaml';
import type { KindVersion } from '../openapi/kindCatalog';
import type { JsonSchema } from '../openapi/types';
import { isRecord } from '../util';
import { bodyOf, partsOf, propertiesOf, requiredOf, resolveNode, unionOf, type Answers } from './variants';

const MAX_DEPTH = 6;

interface Context {
  root: JsonSchema;
  answers: Answers;
  document: Document;
}

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
  const properties = propertiesOf(bodyOf(root));
  const document = new Document({ apiVersion: `v${kind.version}`, kind: kind.kind });
  const context = { root, answers, document };
  const metadata = properties.metadata
    ? renderObject(context, properties.metadata, ['metadata'], example.metadata, 0)
    : new YAMLMap();
  // A name the schema fixes to a list (Integration: Email, Slack…) is only taken when it is one of them.
  const allowed = fixedNames(root);
  if (!allowed || allowed.includes(name)) metadata.set('name', name);
  for (const [param, value] of Object.entries(parents)) metadata.set(param, value);
  (document.contents as YAMLMap).set('metadata', metadata);
  const spec = properties.spec && render(context, properties.spec, ['spec'], example.spec, 0);
  (document.contents as YAMLMap).set('spec', spec ?? new YAMLMap());
  return document.toString();
}

function render(context: Context, node: JsonSchema, path: string[], example: unknown, depth: number): unknown {
  const { root, answers, document } = context;
  const union = unionOf(root, node);
  if (union) {
    const key = path.join('.');
    // Unions inside list items are not asked for; they take their first variant.
    const chosen = key in answers ? answers[key] : union.options[0].value;
    const option = union.options.find((o) => o.value === chosen);
    if (!option) return undefined;
    const sameVariant = isRecord(example) && example[union.field] === chosen;
    const map = renderObject(context, option.schema, path, sameVariant ? example : undefined, depth);
    map.items = map.items.filter((pair) => String(isScalar(pair.key) ? pair.key.value : pair.key) !== union.field);
    map.items.unshift(document.createPair(union.field, chosen));
    return map;
  }
  const resolved = resolveNode(root, node);
  if (isObject(resolved)) return renderObject(context, resolved, path, example, depth);
  return placeholder(context, resolved, path, example, depth);
}

function renderObject(context: Context, node: JsonSchema, path: string[], example: unknown, depth: number): YAMLMap {
  const { root, answers, document } = context;
  const map = new YAMLMap();
  if (depth > MAX_DEPTH) return map;
  const optional: string[] = [];
  const seen = new Set<string>();
  for (const part of partsOf(root, node)) {
    const required = requiredOf(part);
    for (const [key, child] of Object.entries(propertiesOf(part))) {
      if (seen.has(key)) continue;
      seen.add(key);
      const answered = unionOf(root, child) && typeof answers[[...path, key].join('.')] === 'string';
      if (!required.has(key) && !answered) {
        optional.push(`${key}: ${typeName(root, child)}`);
        continue;
      }
      const childExample = isRecord(example) ? example[key] : undefined;
      const value = render(context, child, [...path, key], childExample, depth + 1);
      if (value !== undefined) map.items.push(document.createPair(key, value));
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

function placeholder(context: Context, node: JsonSchema, path: string[], example: unknown, depth: number): unknown {
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
      const first: unknown = Array.isArray(example) ? example[0] : undefined;
      const item = render(context, items, [...path, '0'], first, depth + 1);
      return item === undefined ? [] : [item];
    }
    default:
      return '';
  }
}

function shapeName(root: JsonSchema, node: JsonSchema): string {
  const reference = typeof node.$ref === 'string' ? node.$ref.split('/').pop() : undefined;
  const resolved = resolveNode(root, node);
  return typeof resolved.title === 'string' ? resolved.title : (reference ?? typeName(root, node));
}

/** The names a kind's metadata.name is limited to (Integration: Email, Slack…), if any. */
export function fixedNames(root: JsonSchema): string[] | undefined {
  const metadata = propertiesOf(bodyOf(root)).metadata;
  const field =
    metadata &&
    partsOf(root, metadata)
      .map((part) => propertiesOf(part).name)
      .find(Boolean);
  const name = field && resolveNode(root, field);
  return name && Array.isArray(name.enum) ? name.enum.map(String) : undefined;
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
  if (resolved.type === 'array') return `list of ${typeName(root, isRecord(resolved.items) ? resolved.items : {})}`;
  if (isRecord(resolved.additionalProperties)) return `map of ${typeName(root, resolved.additionalProperties)}`;
  if (typeof resolved.type === 'string') return resolved.type;
  return typeof resolved.title === 'string' ? resolved.title : 'object';
}
