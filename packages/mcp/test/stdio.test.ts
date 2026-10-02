import { copyFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { build } from 'esbuild';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { snapshotPath } from './fakeContext';
import { readFileSync } from 'node:fs';

const requests: { method: string; url: string; authorization?: string }[] = [];
let console_: Server;
let directory: string;
let client: Client;

beforeAll(async () => {
  console_ = createServer((request: IncomingMessage, response) => {
    requests.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization });
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      if (request.url === '/api/public/docs/docs.yaml') {
        response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(readFileSync(snapshotPath, 'utf8'));
      } else if (request.method === 'PUT' && request.url?.startsWith('/api/public/kafka/v2/cluster/local/topic')) {
        response
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ resource: JSON.parse(body), upsertResult: 'Created' }));
      } else {
        response.writeHead(404, { 'Content-Type': 'application/json' }).end('{"title":"Not found"}');
      }
    });
  });
  await new Promise<void>((resolve) => console_.listen(0, '127.0.0.1', resolve));
  const port = (console_.address() as { port: number }).port;

  directory = mkdtempSync(join(tmpdir(), 'conduktor-mcp-'));
  await build({
    entryPoints: [fileURLToPath(new URL('../src/main.ts', import.meta.url))],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    outfile: join(directory, 'mcp-server.js'),
    define: { CONDUKTOR_VERSION: '"0.0.0-test"' },
    logLevel: 'silent',
  });
  copyFileSync(snapshotPath, join(directory, 'public-api-doc.yaml'));
  writeFileSync(
    join(directory, 'topic.yaml'),
    'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: local }\nspec: { partitions: 1, replicationFactor: 1 }\n',
  );

  client = new Client({ name: 'test', version: '0' });
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
  await client?.close();
  console_?.close();
});

describe('the bundled MCP server over stdio', () => {
  it('dry-runs a workspace file against the Console named in its environment', async () => {
    const result = await client.callTool({ name: 'conduktor_dry_run', arguments: { path: 'topic.yaml' } });
    const output = JSON.parse((result.content as { text: string }[])[0]!.text);
    expect(output).toMatchObject({ console: 'fake', documents: [{ name: 'orders', result: 'Created' }] });
    expect(requests).toContainEqual({
      method: 'PUT',
      url: '/api/public/kafka/v2/cluster/local/topic?dryMode=true',
      authorization: 'Bearer secret',
    });
  });

  it('never expands variables from its environment, which holds the Console token', async () => {
    const yaml = 'apiVersion: v2\nkind: Topic\nmetadata: { name: "${CONDUKTOR_TOKEN}", cluster: local }\n';
    const result = await client.callTool({ name: 'conduktor_validate', arguments: { yaml } });
    const text = (result.content as { text: string }[])[0]!.text;
    expect(text).not.toContain('secret');
    expect(JSON.parse(text).documents[0].variables).toEqual(['CONDUKTOR_TOKEN']);
  });

  it('loaded the schema from the Console', async () => {
    expect(requests.some((r) => r.url === '/api/public/docs/docs.yaml' && r.authorization === undefined)).toBe(true);
  });
});
