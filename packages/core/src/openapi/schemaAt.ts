import type { YamlPath } from '../resources/yamlPaths';
import { bodyOf, partsOf, propertiesOf, requiredOf, resolveNode, unionOf } from '../templates/variants';
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
    const fields = parts.flatMap((part) => {
      const field = propertiesOf(part)[segment];
      return isRecord(field) ? [field] : [];
    });
    const [first, ...others] = fields;
    if (!first) return undefined;
    required = parts.some((part) => requiredOf(part).has(segment));
    node = others.length === 0 ? first : { allOf: fields };
    current = isRecord(current) ? current[segment] : undefined;
  }
  return { ...describe(root, node), required };
}

// A union's fields come from the options the document's values fit (its tag, or any field an option fixes), or from
// every option while nothing decides.
function variantParts(root: JsonSchema, node: JsonSchema, current: unknown): JsonSchema[] {
  const union = unionOf(root, node);
  const options = union
    ? union.options.map((option) => ({ parts: partsOf(root, option.schema), title: undefined }))
    : alternativesOf(resolveNode(root, node)).map((option) => ({
        parts: partsOf(root, option),
        title: resolveNode(root, option).title,
      }));
  if (options.length === 0) return partsOf(root, node);
  const fitting = options.filter((option) => fits(option.parts, option.title, current));
  return [...partsOf(root, node), ...(fitting.length > 0 ? fitting : options).flatMap((option) => option.parts)];
}

function fits(parts: readonly JsonSchema[], title: unknown, current: unknown): boolean {
  if (!isRecord(current)) return true;
  return parts.every((part) =>
    Object.entries(propertiesOf(part)).every(([key, property]) => {
      const fixed = fixedValue(property, title);
      return fixed === undefined || current[key] === undefined || current[key] === fixed;
    }),
  );
}

// An option is tagged by a const, a one-value enum, or (where the published discriminator has no mapping, as for
// permissions) by its title when the title is one of that field's values: Tapir keeps the name there (TOPIC1 → TOPIC).
function fixedValue(property: JsonSchema, title: unknown): unknown {
  if ('const' in property) return property.const;
  if (!Array.isArray(property.enum)) return undefined;
  if (property.enum.length === 1) return property.enum[0];
  return typeof title === 'string' && property.enum.includes(title) ? title : undefined;
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
      parts
        .flatMap((part): unknown[] => (Array.isArray(part.enum) ? part.enum : 'const' in part ? [part.const] : []))
        .map(String),
    ),
  ];
  if (values.length > 0) return { type: `one of ${values.join(', ')}`, values, ...fallback };
  if (typed.type === 'array' && isRecord(typed.items))
    return { type: `list of ${describe(root, typed.items).type}`, ...fallback };
  if (Array.isArray(typed.type)) return { type: typed.type.join(' or '), ...fallback };
  if (typeof typed.type === 'string') return { type: typed.type, ...fallback };
  const types = [...new Set(alternativesOf(resolved).map((option) => describe(root, option).type))];
  return { type: types.length > 0 ? types.join(' or ') : 'any', ...fallback };
}

function alternativesOf(resolved: JsonSchema): JsonSchema[] {
  const options = Array.isArray(resolved.oneOf) ? resolved.oneOf : Array.isArray(resolved.anyOf) ? resolved.anyOf : [];
  return options as JsonSchema[];
}
