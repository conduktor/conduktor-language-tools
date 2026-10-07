import { readFileSync } from 'node:fs';
import { buildSpec, type Resource, type ToolContext } from '@conduktor/vscode-core';

export const snapshotPath = new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url);
const spec = buildSpec(readFileSync(snapshotPath, 'utf8'), 'snapshot');

export function fakeContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    connectionName: 'fake',
    catalog: spec.catalog,
    schema: spec.schema,
    client: {
      list: async () => [],
      get: async () => ({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 'x' } }),
      upsert: async (_target, resource: Resource) => ({ resource, upsertResult: 'Created' }),
    },
    ...overrides,
  };
}
