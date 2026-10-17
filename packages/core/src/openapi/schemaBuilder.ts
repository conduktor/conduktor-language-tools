import { isRecord } from '../util';
import { COMPONENT_REF, type BodyKind, type KindCatalog, type KindVersion } from './kindCatalog';
import { toJsPattern } from './patterns';
import type { JsonSchema, OpenApiDoc } from './types';

const OPENAPI_ONLY_KEYWORDS = new Set(['discriminator', 'example', 'externalDocs', 'xml']);
const NAME_MAP_KEYWORDS = new Set(['properties', 'patternProperties']);

type Include = (name: string) => void;

export function buildResourceSchema(doc: OpenApiDoc, catalog: KindCatalog): JsonSchema {
  const components = doc.components?.schemas ?? {};
  const definitions: Record<string, JsonSchema> = {};
  const include: Include = (name) => {
    const source = components[name];
    if (name in definitions || !source) return;
    definitions[name] = {};
    definitions[name] = convertSchema(source, include);
  };

  const kinds = catalog.kinds().filter((kv): kv is BodyKind => kv.bodySchema !== undefined);
  for (const kv of kinds) {
    include(kv.bodySchema);
    pinIdentity(definitions[kv.bodySchema], kv);
  }

  const versionsByKind = new Map<string, string[]>();
  for (const kv of kinds) versionsByKind.set(kv.kind, [...(versionsByKind.get(kv.kind) ?? []), ...apiVersionsOf(kv)]);

  const apiVersions = [...new Set(kinds.flatMap(apiVersionsOf))].sort();
  const kindNames = [...versionsByKind.keys()].sort();
  return {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: 'Conduktor Console resource',
    type: 'object',
    properties: {
      apiVersion: { type: 'string', examples: apiVersions },
      kind: { type: 'string', examples: kindNames },
    },
    // Mirrors catalogDocuments: other documents in the same file (ConfigMaps, namespaced Kubernetes kinds) pass.
    if: {
      properties: {
        apiVersion: { pattern: '^(?:[a-z][a-z-]*/)?v\\d+$' },
        kind: { enum: kindNames },
        metadata: { not: { required: ['namespace'] } },
      },
      required: ['kind'],
    },
    then: {
      required: ['apiVersion', 'kind', 'metadata'],
      properties: { apiVersion: { enum: apiVersions }, metadata: { type: 'object' } },
      allOf: [
        ...[...versionsByKind].map(([kind, versions]) => ({
          if: { properties: { kind: { const: kind } }, required: ['kind'] },
          then: { properties: { apiVersion: { enum: versions } } },
        })),
        ...kinds.map((kv) => ({
          if: {
            properties: { kind: { const: kv.kind }, apiVersion: { enum: apiVersionsOf(kv) } },
            required: ['kind', 'apiVersion'],
          },
          then: { $ref: `#/definitions/${kv.bodySchema}` },
        })),
      ],
    },
    definitions,
  };
}

// A kind version's apiVersion as written: `v2`, or the CLI's group-qualified `kafka/v2`, which the Console accepts.
function apiVersionsOf(kv: KindVersion): string[] {
  return [`v${kv.version}`, `${kv.group}/v${kv.version}`];
}

// The published apiVersion is an unanchored `pattern: v2`, which would accept "v21"; pin both identity fields.
function pinIdentity(definition: JsonSchema | undefined, kv: KindVersion): void {
  if (!definition || !isRecord(definition.properties)) return;
  definition.properties.apiVersion = { type: 'string', enum: apiVersionsOf(kv) };
  definition.properties.kind = { type: 'string', const: kv.kind };
}

function convertSchema(schema: JsonSchema, include: Include): JsonSchema {
  const converted: JsonSchema = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (OPENAPI_ONLY_KEYWORDS.has(keyword)) continue;
    if (keyword === 'oneOf' && Array.isArray(value) && isRecord(schema.discriminator)) {
      converted.oneOf = tagBranches(value, schema.discriminator, include);
      continue;
    }
    if (keyword === '$ref' && typeof value === 'string' && value.startsWith(COMPONENT_REF)) {
      const name = value.slice(COMPONENT_REF.length);
      include(name);
      converted.$ref = `#/definitions/${name}`;
    } else if (keyword === 'pattern' && typeof value === 'string') {
      const pattern = toJsPattern(value);
      if (pattern !== undefined) converted.pattern = pattern;
    } else if (NAME_MAP_KEYWORDS.has(keyword) && isRecord(value)) {
      converted[keyword] = Object.fromEntries(
        Object.entries(value).map(([name, sub]) => [name, convertValue(sub, include)]),
      );
    } else {
      converted[keyword] = convertValue(value, include);
    }
  }
  return converted;
}

// Some branches share an enum-typed tag instead of a const, so without the mapping several branches match at once.
// Only an explicit mapping is trusted: Tapir de-duplicates schema names (CONSUMER_GROUP1), so names are not tags.
function tagBranches(branches: unknown[], discriminator: Record<string, unknown>, include: Include): unknown[] {
  const property = discriminator.propertyName;
  if (typeof property !== 'string') return branches.map((branch) => convertValue(branch, include));
  const mapping = isRecord(discriminator.mapping) ? discriminator.mapping : {};
  const tagByRef = new Map(Object.entries(mapping).map(([tag, ref]) => [ref, tag]));
  return branches.map((branch) => {
    const ref = isRecord(branch) && typeof branch.$ref === 'string' ? branch.$ref : undefined;
    const tag = ref ? tagByRef.get(ref) : undefined;
    const converted = convertValue(branch, include);
    return tag === undefined
      ? converted
      : { allOf: [{ properties: { [property]: { const: tag } }, required: [property] }, converted] };
  });
}

function convertValue(value: unknown, include: Include): unknown {
  if (Array.isArray(value)) return value.map((item) => convertValue(item, include));
  return isRecord(value) ? convertSchema(value, include) : value;
}
