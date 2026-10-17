import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotPath } from './fakeContext';
import { readFileSync } from 'node:fs';

const requests: { method: string; url: string; authorization: string | undefined }[] = [];
const console_ = createServer((request: IncomingMessage, response) => {
  requests.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization });
  let body = '';
  request.on('data', (chunk: Buffer) => (body += chunk.toString()));
  request.on('end', () => {
    if (request.url === '/api/public/docs/docs.yaml') {
      response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(readFileSync(snapshotPath, 'utf8'));
    } else if (request.method === 'PUT' && request.url?.startsWith('/api/public/kafka/v2/cluster/local/topic')) {
      const resource: unknown = JSON.parse(body);
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ resource, upsertResult: 'Created' }));
    } else {
      response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"title":"Not found"}');
    }
  });
});
const client = new Client({ name: 'test', version: '0' });
let directory: string;

const text = (result: unknown) =>
  CallToolResultSchema.parse(result)
    .content.map((part) => (part.type === 'text' ? part.text : ''))
    .join('');

beforeAll(async () => {
  await new Promise<void>((resolve) => console_.listen(0, '127.0.0.1', resolve));
  const port = (console_.address() as { port: number }).port;

  directory = mkdtempSync(join(tmpdir(), 'conduktor-mcp-'));
  await build({
    entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: join(directory, 'mcp-server.js'),
    define: { CONDUKTOR_VERSION: '"0.0.0-test"' },
    logLevel: 'silent',
  });
  copyFileSync(snapshotPath, join(directory, 'public-api-doc.yaml'));
  writeFileSync(
    join(directory, 'topic.yaml'),
    'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: local }\nspec: { partitions: 1, replicationFactor: 1 }\n',
  );

  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: [join(directory, 'mcp-server.js')],
      cwd: directory,
      env: { CONDUKTOR_URL: `http://127.0.0.1:${port}`, CONDUKTOR_TOKEN: 'secret', CONDUKTOR_NAME: 'fake' },
    }),
  );
}, 30_000);

afterAll(async () => {
  await client.close();
  console_.close();
});

describe('the bundled MCP server over stdio', () => {
  it('dry-runs a workspace file against the Console named in its environment', async () => {
    const result = await client.callTool({ name: 'conduktor_dry_run', arguments: { path: 'topic.yaml' } });
    expect(JSON.parse(text(result))).toMatchObject({
      console: 'fake',
      documents: [{ name: 'orders', result: 'Created' }],
    });
    expect(requests).toContainEqual({
      method: 'PUT',
      url: '/api/public/kafka/v2/cluster/local/topic?dryMode=true',
      authorization: 'Bearer secret',
    });
  });

  it('reads only files inside its working directory', async () => {
    const outside = join(directory, '..', `${basename(directory)}-outside.yaml`);
    writeFileSync(outside, 'apiVersion: v2\nkind: Topic\n');
    try {
      for (const path of [`../${basename(outside)}`, join(directory, 'topic.yaml')]) {
        const result = await client.callTool({ name: 'conduktor_validate', arguments: { path } });
        expect(text(result)).toMatch(/outside the workspace|is absolute/);
      }
    } finally {
      rmSync(outside);
    }
  });

  it('never expands variables from its environment, which holds the Console token', async () => {
    const yaml = 'apiVersion: v2\nkind: Topic\nmetadata: { name: "${CONDUKTOR_TOKEN}", cluster: local }\n';
    const result = await client.callTool({ name: 'conduktor_validate', arguments: { yaml } });
    const output = text(result);
    expect(output).not.toContain('secret');
    expect(JSON.parse(output)).toHaveProperty(['documents', 0, 'variables'], ['CONDUKTOR_TOKEN']);
  });

  it('loaded the schema from the Console', () => {
    expect(requests.some((r) => r.url === '/api/public/docs/docs.yaml' && r.authorization === undefined)).toBe(true);
  });
});
