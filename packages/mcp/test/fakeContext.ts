import { readFileSync } from 'node:fs';
import { buildSpec, type Resource, type ToolContext } from '@conduktor/core';

export const snapshotPath = new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url);
const spec = buildSpec(readFileSync(snapshotPath, 'utf8'), 'snapshot');

export function fakeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    connectionName: 'fake',
    catalog: spec.catalog,
    schema: spec.schema,
    client: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 'x' } }),
      upsert: (_target, resource: Resource) => Promise.resolve({ resource, upsertResult: 'Created' }),
    },
    ...overrides,
  };
}
