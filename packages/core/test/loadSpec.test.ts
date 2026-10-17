import { describe, expect, it } from 'vitest';
import { loadSpec, type SpecCache } from '../src/openapi/loadSpec';

const spec = (kind: string) => `openapi: 3.1.0
paths:
  /public/x/v1/${kind.toLowerCase()}:
    get: {}
    put:
      tags: [cli_${kind.toLowerCase()}_x_v1_1]
      requestBody:
        content:
          application/json:
            schema: { $ref: '#/components/schemas/${kind}' }
components:
  schemas:
    ${kind}: { type: object, properties: { spec: { type: object } } }
`;

function memoryCache(initial?: string): SpecCache & { written?: string } {
  const cache: SpecCache & { written?: string } = {
    read: () => Promise.resolve(cache.written ?? initial),
    write: (_key, text) => {
      cache.written = text;
      return Promise.resolve();
    },
  };
  return cache;
}

const options = (fetchText: () => Promise<string>, cache: SpecCache) => ({
  cacheKey: 'http://console:8080',
  fetchText,
  cache,
  snapshotText: () => Promise.resolve(spec('Snapshot')),
});

describe('loadSpec', () => {
  it('uses the live document and caches it', async () => {
    const cache = memoryCache();
    const loaded = await loadSpec(options(() => Promise.resolve(spec('Live')), cache));
    expect(loaded.source).toBe('live');
    expect([...loaded.catalog.kindNames()]).toEqual(['Live']);
    expect(cache.written).toBe(spec('Live'));
    expect(loaded.liveError).toBeUndefined();
  });

  it('falls back to the cache when the Console is unreachable', async () => {
    const loaded = await loadSpec(
      options(
        () => Promise.reject(new Error('Cannot reach http://console:8080: ECONNREFUSED')),
        memoryCache(spec('Cached')),
      ),
    );
    expect(loaded).toMatchObject({ source: 'cache', liveError: 'Cannot reach http://console:8080: ECONNREFUSED' });
    expect([...loaded.catalog.kindNames()]).toEqual(['Cached']);
  });

  it('treats an HTML page served in place of the document as a failure', async () => {
    const loaded = await loadSpec(options(() => Promise.resolve('<!doctype html><html></html>'), memoryCache()));
    expect(loaded).toMatchObject({ source: 'snapshot', liveError: 'Not an OpenAPI document' });
  });

  it('skips a corrupt cache entry and uses the snapshot', async () => {
    const loaded = await loadSpec(options(() => Promise.reject(new Error('down')), memoryCache('not: [valid')));
    expect(loaded.source).toBe('snapshot');
    expect([...loaded.catalog.kindNames()]).toEqual(['Snapshot']);
  });

  it('versions the spec by content', async () => {
    const a = await loadSpec(options(() => Promise.resolve(spec('A')), memoryCache()));
    const b = await loadSpec(options(() => Promise.resolve(spec('B')), memoryCache()));
    expect(a.version).toMatch(/^[0-9a-f]{12}$/);
    expect(a.version).not.toBe(b.version);
  });
});
