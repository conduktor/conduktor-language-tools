import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from 'node:http';
import type { CodeLens, CompletionList, Hover } from 'vscode-languageserver';
import { buildServer, fakeConsole, startServer, until, type FakeConsole, type Started } from './harness';

let directory: string;
let fake: FakeConsole;
const running: Started[] = [];

beforeAll(async () => {
  fake = await fakeConsole();
  directory = buildServer();
}, 60_000);

afterAll(() => {
  running.forEach((server) => server.stop());
  fake?.close();
});

async function start(settings: unknown, options: { zedSettings?: boolean; answer?: string } = {}): Promise<Started> {
  const server = await startServer(directory, { settings, ...options });
  running.push(server);
  return server;
}

const BAD_TOPIC = [
  'apiVersion: v2',
  'kind: Topic',
  'metadata: { name: orders, cluster: local }',
  'spec:',
  '  partitions: three',
  '  ',
].join('\n');
const CONFIG_MAP = 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n  ';

describe('the bundled language server over stdio', () => {
  it('checks, completes and hovers resources with the schema of the Console in the settings', async () => {
    const server = await start({ url: fake.url, name: 'fake' });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    server.open('file:///work/config.yaml', CONFIG_MAP);

    const diagnostics = await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(diagnostics).toContainEqual(expect.objectContaining({ source: 'Conduktor', range: expect.anything() }));
    expect(diagnostics.every((d) => d.range.start.line === 4)).toBe(true);
    expect(fake.requests).toContainEqual(
      expect.objectContaining({ url: '/api/public/docs/docs.yaml', authorization: undefined }),
    );

    const completion: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: 'file:///work/topic.yaml' },
      position: { line: 5, character: 2 },
    });
    expect(completion?.items.map((i) => i.label)).toContain('replicationFactor');

    const hover: Hover | null = await server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri: 'file:///work/topic.yaml' },
      position: { line: 3, character: 1 },
    });
    expect(JSON.stringify(hover?.contents)).toContain('TopicSpec');

    const other: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri: 'file:///work/config.yaml' },
      position: { line: 4, character: 2 },
    });
    expect(other).toBeNull();
  }, 30_000);

  it('works from the bundled schema without a Console in the settings', async () => {
    const server = await start(undefined);
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    const diagnostics = await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(diagnostics[0]?.source).toBe('Conduktor');
    expect(server.messages).toEqual([]);
  }, 30_000);

  it('warns when the Console cannot be reached, and checks with the schema it has', async () => {
    const server = await start({ url: 'http://127.0.0.1:9', name: 'down' });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(server.messages).toContainEqual({ type: 2, message: expect.stringMatching(/^down: using the snapshot/) });
  }, 30_000);

  it('says what is wrong with the settings, and keeps checking with the bundled schema', async () => {
    const server = await start({ url: 'http://localhost:8080', mode: 'apply' });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(server.messages).toContainEqual({
      type: 1,
      message: expect.stringMatching(/^lsp\.conduktor-console\.settings: "mode"/),
    });
  }, 30_000);

  it("offers, once, to open Zed's settings when a resource is opened without a Console", async () => {
    const server = await start(undefined, { zedSettings: true, answer: 'Open Settings' });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    server.open('file:///work/other.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/other.yaml', (d) => d.length > 0);
    await until(() => server.shown.length > 0);
    expect(server.prompts.map((p) => p.message)).toEqual([expect.stringMatching(/^Conduktor: no Console set/)]);
    expect(server.shown.map((s) => s.uri)).toEqual([expect.stringMatching(/\/\.config\/zed\/settings\.json$/)]);
  }, 30_000);

  it('connects to the Console as soon as the settings name it, without a restart', async () => {
    const server = await start(undefined);
    const uri = 'file:///work/live.yaml';
    server.open(uri, 'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: c-live }\n');
    await server.diagnostics(uri, () => true);
    expect(fake.requests.filter((r) => r.url.includes('/cluster/c-live/'))).toEqual([]);

    server.configure({ url: fake.url, name: 'later', mode: 'dev' });
    const titles = async () =>
      ((await server.connection.sendRequest('textDocument/codeLens', { textDocument: { uri } })) as CodeLens[]).map(
        (lens) => lens.command!.title,
      );
    await until(async () => (await titles()).includes('Apply'));
    await until(() => fake.requests.some((r) => r.url.includes('/cluster/c-live/') && r.url.includes('dryMode')));
  }, 30_000);

  it('completes from the bundled schema while the Console has not answered yet', async () => {
    const silent = createServer(() => undefined);
    await new Promise<void>((resolve) => silent.listen(0, '127.0.0.1', resolve));
    try {
      const server = await start({ url: `http://127.0.0.1:${(silent.address() as { port: number }).port}` });
      const uri = 'file:///work/slow.yaml';
      server.open(uri, 'apiVersion: v2\nkind: Topic\nspec:\n  p');
      const completion = await Promise.race([
        server.connection.sendRequest('textDocument/completion', {
          textDocument: { uri },
          position: { line: 3, character: 3 },
        }) as Promise<CompletionList | null>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('completion waited on the Console')), 5_000),
        ),
      ]);
      expect(completion?.items.map((i) => i.label)).toContain('partitions');
    } finally {
      silent.closeAllConnections();
      silent.close();
    }
  }, 30_000);
});
