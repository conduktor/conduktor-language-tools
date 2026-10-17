import { readFileSync } from 'node:fs';
import { KindCatalog, type BodyKind } from '../src/openapi/kindCatalog';
import { kindSchema } from '../src/openapi/kindSchema';
import { parseOpenApi } from '../src/openapi/parseOpenApi';
import { buildResourceSchema } from '../src/openapi/schemaBuilder';
import type { JsonSchema } from '../src/openapi/types';
import { valueAtPath } from '../src/util';

interface CliKindVersion {
  ListPath: string;
  ParentPathParam: string[] | null;
  ParentQueryParam: string[] | null;
  Order: number;
}

const snapshotText = readFileSync(new URL('../snapshot/public-api-doc.yaml', import.meta.url), 'utf8');
const snapshotDoc = parseOpenApi(snapshotText);
export const snapshotCatalog = KindCatalog.fromOpenApi(snapshotDoc);
export const snapshotSchema = buildResourceSchema(snapshotDoc, snapshotCatalog);

export const cliKinds = JSON.parse(
  readFileSync(new URL('./fixtures/cliKind-v0.3.4.json', import.meta.url), 'utf8'),
) as Record<string, { Versions: Record<string, CliKindVersion> }>;

/** The schema of a kind at its latest version. */
export function rootOf(kind: string): JsonSchema {
  return kindSchema(snapshotSchema, snapshotCatalog.latest(kind) as BodyKind);
}

/** The value at `path` in parsed YAML or JSON; undefined where the path leads nowhere. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  return valueAtPath(value, path);
}
