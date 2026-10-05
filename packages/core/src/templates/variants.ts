import type { JsonSchema } from '../openapi/types';
import { isRecord } from '../util';

export type Answers = Readonly<Record<string, string | null>>;

export interface Choice {
  path: string[];
  field: string;
  options: string[];
  optional: boolean;
}

interface Union {
  field: string;
  options: { value: string; schema: JsonSchema }[];
}

const MAX_DEPTH = 3;

export function resolveNode(root: JsonSchema, node: JsonSchema): JsonSchema {
  const definitions = (isRecord(root.definitions) ? root.definitions : {}) as Record<string, JsonSchema>;
  let current = node;
  for (let hops = 0; typeof current.$ref === 'string' && hops < 20; hops++)
    current = definitions[current.$ref.split('/').pop()!] ?? {};
  return current;
}

// A discriminated union as the schema builder writes it: each option is allOf [{ <field>: const }, <variant>].
export function unionOf(root: JsonSchema, node: JsonSchema): Union | undefined {
  const resolved = resolveNode(root, node);
  if (!Array.isArray(resolved.oneOf)) return undefined;
  let field: string | undefined;
  const options: Union['options'] = [];
  for (const option of resolved.oneOf as JsonSchema[]) {
    const parts = Array.isArray(option.allOf) ? (option.allOf as JsonSchema[]) : [];
    const tag = parts.find((p) => isRecord(p.properties) && Object.keys(p.properties).length === 1 && !p.$ref);
    const [name, value] = tag ? Object.entries(tag.properties as Record<string, JsonSchema>)[0]! : [];
    if (!name || !isRecord(value) || typeof value.const !== 'string') return undefined;
    field ??= name;
    if (name !== field) return undefined;
    options.push({ value: value.const, schema: { allOf: parts } });
  }
  return field && options.length > 0 ? { field, options } : undefined;
}

export function partsOf(root: JsonSchema, node: JsonSchema): JsonSchema[] {
  const resolved = resolveNode(root, node);
  return Array.isArray(resolved.allOf)
    ? (resolved.allOf as JsonSchema[]).flatMap((part) => partsOf(root, part))
    : [resolved];
}

export function bodyOf(root: JsonSchema): JsonSchema {
  return resolveNode(root, Array.isArray(root.allOf) ? ((root.allOf as JsonSchema[])[0] ?? root) : root);
}

/** The first union under `spec` not yet answered, walking chosen variants in document order. */
export function nextChoice(root: JsonSchema, answers: Answers): Choice | undefined {
  const body = bodyOf(root);
  const spec = isRecord(body.properties) ? (body.properties as Record<string, JsonSchema>).spec : undefined;
  return spec && walk(root, spec, ['spec'], false, answers, 0, new Set());
}

function walk(
  root: JsonSchema,
  node: JsonSchema,
  path: string[],
  optional: boolean,
  answers: Answers,
  depth: number,
  seen: ReadonlySet<JsonSchema>,
): Choice | undefined {
  const resolved = resolveNode(root, node);
  if (seen.has(resolved) || depth > MAX_DEPTH) return undefined;
  const inside = new Set(seen).add(resolved);
  const union = unionOf(root, node);
  if (!union) return walkObject(root, resolved, path, answers, depth, inside);
  const key = path.join('.');
  if (!(key in answers)) return { path, field: union.field, options: union.options.map((o) => o.value), optional };
  const option = union.options.find((o) => o.value === answers[key]);
  return option ? walkObject(root, option.schema, path, answers, depth, inside) : undefined;
}

function walkObject(
  root: JsonSchema,
  node: JsonSchema,
  path: string[],
  answers: Answers,
  depth: number,
  seen: ReadonlySet<JsonSchema>,
): Choice | undefined {
  for (const part of partsOf(root, node)) {
    const properties = isRecord(part.properties) ? (part.properties as Record<string, JsonSchema>) : {};
    const required = new Set(Array.isArray(part.required) ? (part.required as string[]) : []);
    for (const [name, child] of Object.entries(properties)) {
      const found = walk(root, child, [...path, name], !required.has(name), answers, depth + 1, seen);
      if (found) return found;
    }
  }
  return undefined;
}
