import { createHash } from 'node:crypto';
import { describeError } from '../client/errors';
import { KindCatalog } from './kindCatalog';
import { parseOpenApi } from './parseOpenApi';
import { buildResourceSchema } from './schemaBuilder';
import type { JsonSchema } from './types';

export interface SpecCache {
  read(key: string): Promise<string | undefined>;
  write(key: string, text: string): Promise<void>;
}

export type SpecSource = 'live' | 'cache' | 'snapshot';

export interface LoadedSpec {
  source: SpecSource;
  version: string;
  catalog: KindCatalog;
  schema: JsonSchema;
  liveError?: string;
}

export interface LoadSpecOptions {
  cacheKey: string;
  fetchText: () => Promise<string>;
  cache: SpecCache;
  snapshotText: () => Promise<string>;
}

export async function loadSpec(options: LoadSpecOptions): Promise<LoadedSpec> {
  let liveError: string;
  try {
    const text = await options.fetchText();
    const spec = buildSpec(text, 'live');
    await options.cache.write(options.cacheKey, text).catch(() => undefined);
    return spec;
  } catch (error) {
    liveError = describeError(error);
  }

  const cached = await options.cache.read(options.cacheKey).catch(() => undefined);
  if (cached !== undefined) {
    try {
      return { ...buildSpec(cached, 'cache'), liveError };
    } catch {
      // fall through to the snapshot
    }
  }
  return { ...buildSpec(await options.snapshotText(), 'snapshot'), liveError };
}

export function buildSpec(text: string, source: SpecSource): LoadedSpec {
  const doc = parseOpenApi(text);
  const catalog = KindCatalog.fromOpenApi(doc);
  return {
    source,
    version: createHash('sha1').update(text).digest('hex').slice(0, 12),
    catalog,
    schema: buildResourceSchema(doc, catalog),
  };
}
