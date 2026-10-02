import { isRecord } from '../util';
import type { KindVersion } from './kindCatalog';
import type { JsonSchema } from './types';

const DEFINITION_REF = '#/definitions/';

export function kindSchema(resourceSchema: JsonSchema, kind: KindVersion & { bodySchema: string }): JsonSchema {
  const definitions = isRecord(resourceSchema.definitions)
    ? (resourceSchema.definitions as Record<string, JsonSchema>)
    : {};
  const picked: Record<string, JsonSchema> = {};
  const visit = (name: string): void => {
    const definition = definitions[name];
    if (name in picked || !definition) return;
    picked[name] = definition;
    refsIn(definition).forEach(visit);
  };
  visit(kind.bodySchema);
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `${kind.kind} v${kind.version}`,
    allOf: [{ $ref: `${DEFINITION_REF}${kind.bodySchema}` }],
    definitions: picked,
  };
}

function refsIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(refsIn);
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === '$ref' && typeof child === 'string' && child.startsWith(DEFINITION_REF)
      ? [child.slice(DEFINITION_REF.length)]
      : refsIn(child),
  );
}
