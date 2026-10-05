import type { YamlPath } from '../resources/yamlPaths';
import { bodyOf, partsOf, resolveNode, unionOf } from '../templates/variants';
import { isRecord } from '../util';
import type { JsonSchema } from './types';

export interface FieldSchema {
  type: string;
  required: boolean;
  values?: string[];
  default?: unknown;
}

/** What the kind's schema says about the field at `path`, inside the variants the document has chosen. */
export function schemaAt(root: JsonSchema, value: unknown, path: YamlPath): FieldSchema | undefined {
  let node = bodyOf(root);
  let current = value;
  let required = false;
  for (const segment of path) {
    if (typeof segment === 'number') {
      const items = partsOf(root, node).find((part) => isRecord(part.items))?.items as JsonSchema | undefined;
      if (!items) return undefined;
      node = items;
      current = Array.isArray(current) ? current[segment] : undefined;
      required = false;
      continue;
    }
    const union = unionOf(root, node);
    if (union?.field === segment) {
      const values = union.options.map((option) => option.value);
      return { type: `one of ${values.join(', ')}`, required: true, values };
    }
    const parts = variantParts(root, node, current);
    const fields = parts.flatMap((part) =>
      isRecord(part.properties) && segment in part.properties
        ? [(part.properties as Record<string, JsonSchema>)[segment]!]
        : [],
    );
    if (fields.length === 0) return undefined;
    required = parts.some((part) => Array.isArray(part.required) && part.required.includes(segment));
    node = fields.length === 1 ? fields[0]! : { allOf: fields };
    current = isRecord(current) ? current[segment] : undefined;
  }
  return { ...describe(root, node), required };
}

// A union's fields come from the options the document's values fit (its tag, or any field an option fixes), or from
// every option while nothing decides.
function variantParts(root: JsonSchema, node: JsonSchema, current: unknown): JsonSchema[] {
  const union = unionOf(root, node);
  const resolved = resolveNode(root, node);
  const plain = Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : [];
  const options = union
    ? union.options.map((option) => partsOf(root, option.schema))
    : (plain as JsonSchema[]).map((option) => partsOf(root, option));
  if (options.length === 0) return partsOf(root, node);
  const fitting = options.filter((parts) => fits(parts, current));
  return [...partsOf(root, node), ...(fitting.length > 0 ? fitting : options).flat()];
}

function fits(parts: readonly JsonSchema[], current: unknown): boolean {
  if (!isRecord(current)) return true;
  return parts.every((part) =>
    Object.entries(isRecord(part.properties) ? (part.properties as Record<string, JsonSchema>) : {}).every(
      ([key, property]) => {
        const fixed = fixedValue(property);
        return fixed === undefined || current[key] === undefined || current[key] === fixed;
      },
    ),
  );
}

function fixedValue(property: JsonSchema): unknown {
  if ('const' in property) return property.const;
  return Array.isArray(property.enum) && property.enum.length === 1 ? property.enum[0] : undefined;
}

function describe(root: JsonSchema, node: JsonSchema): Omit<FieldSchema, 'required'> {
  const union = unionOf(root, node);
  if (union) {
    const tags = union.options.map((option) => option.value);
    return { type: `one of ${tags.join(', ')} (by ${union.field})` };
  }
  const resolved = resolveNode(root, node);
  const parts = partsOf(root, node);
  const typed = parts.find((part) => part.type !== undefined) ?? resolved;
  const fallback = 'default' in resolved ? { default: resolved.default } : {};
  const values = [
    ...new Set(
      parts.flatMap((part) => (Array.isArray(part.enum) ? part.enum : 'const' in part ? [part.const] : [])).map(String),
    ),
  ];
  if (values.length > 0) return { type: `one of ${values.join(', ')}`, values, ...fallback };
  if (typed.type === 'array' && isRecord(typed.items))
    return { type: `list of ${describe(root, typed.items as JsonSchema).type}`, ...fallback };
  if (Array.isArray(typed.type)) return { type: typed.type.join(' or '), ...fallback };
  if (typeof typed.type === 'string') return { type: typed.type, ...fallback };
  const options = Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : [];
  const types = [...new Set((options as JsonSchema[]).map((option) => describe(root, option).type))];
  return { type: types.length > 0 ? types.join(' or ') : 'any', ...fallback };
}
