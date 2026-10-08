import { isRecord } from '../util';
import type { Resource } from './types';

// Schema Registry reads a schema without a format as Avro; protobuf is text, already over lines.
const JSON_FORMATS = new Set(['AVRO', 'JSON']);

/**
 * A Subject with its JSON or Avro schema laid out over lines, keys in their order, so the YAML shows it as a readable
 * block. Schema Registry compares parsed schemas, so the layout never makes a change. Anything else comes back as is.
 */
export function prettySchema(resource: Resource): Resource {
  const spec = resource.spec;
  if (resource.kind !== 'Subject' || !isRecord(spec) || typeof spec.schema !== 'string') return resource;
  if (!JSON_FORMATS.has(typeof spec.format === 'string' ? spec.format.toUpperCase() : 'AVRO')) return resource;
  let parsed: unknown;
  try {
    parsed = JSON.parse(spec.schema);
  } catch {
    return resource;
  }
  return { ...resource, spec: { ...spec, schema: `${JSON.stringify(parsed, null, 2)}\n` } };
}
