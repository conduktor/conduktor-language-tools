import { readFileSync } from 'node:fs';
import { KindCatalog } from '../src/openapi/kindCatalog';
import { parseOpenApi } from '../src/openapi/parseOpenApi';
import { isRecord } from '../src/util';

interface CliKindVersion {
  ListPath: string;
  ParentPathParam: string[] | null;
  ParentQueryParam: string[] | null;
  Order: number;
}

const snapshotText = readFileSync(new URL('../snapshot/public-api-doc.yaml', import.meta.url), 'utf8');
export const snapshotDoc = parseOpenApi(snapshotText);
export const snapshotCatalog = KindCatalog.fromOpenApi(snapshotDoc);
export const cliKinds = JSON.parse(
  readFileSync(new URL('./fixtures/cliKind-v0.3.4.json', import.meta.url), 'utf8'),
) as Record<string, { Versions: Record<string, CliKindVersion> }>;

/** The value at `path` in parsed YAML or JSON; undefined where the path leads nowhere. */
export function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((node, key) => {
    if (typeof key === 'number') return Array.isArray(node) ? node[key] : undefined;
    return isRecord(node) ? node[key] : undefined;
  }, value);
}
