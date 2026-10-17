import { readFileSync } from 'node:fs';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { buildSpec, type Resource, type ToolContext } from '@conduktor/core';

export const snapshotPath = new URL('../../core/snapshot/public-api-doc.yaml', import.meta.url);
const spec = buildSpec(readFileSync(snapshotPath, 'utf8'), 'snapshot');

export function fakeContext(): ToolContext {
  return {
    connectionName: 'fake',
    catalog: spec.catalog,
    schema: spec.schema,
    client: {
      list: () => Promise.resolve([]),
      get: () => Promise.resolve({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 'x' } }),
      upsert: (_target, resource: Resource) => Promise.resolve({ resource, upsertResult: 'Created' }),
    },
  };
}

/** A tool's answer, as the agent reads it. */
export const resultText = (result: unknown) =>
  CallToolResultSchema.parse(result)
    .content.map((part) => (part.type === 'text' ? part.text : ''))
    .join('');
