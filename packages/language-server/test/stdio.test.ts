import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildServer, matching, until, useServers } from './harness';

const servers = useServers();

const BAD_TOPIC = [
  'apiVersion: v2',
  'kind: Topic',
  'metadata: { name: orders, cluster: local-kafka }',
  'spec:',
  '  partitions: three',
  '  ',
].join('\n');

describe('the bundled language server over stdio', () => {
  it('checks, completes and hovers resources with the schema of the Console in the settings', async () => {
    const server = await servers.start();
    server.open('file:///work/topic.yaml', BAD_TOPIC);

    const diagnostics = await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(diagnostics).toContainEqual(expect.objectContaining({ source: 'Conduktor' }));
    expect(diagnostics.every((d) => d.range.start.line === 4)).toBe(true);
    expect(servers.fake.requests).toContainEqual(
      expect.objectContaining({ url: '/api/public/docs/docs.yaml', authorization: undefined }),
    );
    expect((await server.completeAtEnd(BAD_TOPIC))?.map((i) => i.label)).toContain('replicationFactor');
    expect(await server.hover('file:///work/topic.yaml', 3, 1)).toContain('TopicSpec');
    expect(await server.completeAtEnd('apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cfg\n  ')).toBeUndefined();
  }, 30_000);

  it('works from the bundled schema without a Console, and publishes each file as soon as it opens', async () => {
    const server = await servers.start({});
    server.open('file:///work/first.yaml', BAD_TOPIC);
    expect((await server.diagnostics('file:///work/first.yaml', (d) => d.length > 0))[0]?.source).toBe('Conduktor');
    server.open('file:///work/second.yaml', BAD_TOPIC);
    const diagnostics = await server.diagnostics('file:///work/second.yaml', (d) => d.length > 0);
    expect(diagnostics[0]?.range.start.line).toBe(4);
    expect(server.messages).toEqual([]);
  }, 30_000);

  it('warns when the Console cannot be reached, and checks with the schema it has', async () => {
    const server = await servers.start({ settings: { url: 'http://127.0.0.1:9', name: 'down' } });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(server.messages).toContainEqual({ type: 2, message: matching(/^down: using the snapshot/) });
  }, 30_000);

  it('says what is wrong with the settings, and keeps checking with the bundled schema', async () => {
    const server = await servers.start({ settings: { url: 'http://localhost:8080', mode: 'apply' } });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/topic.yaml', (d) => d.length > 0);
    expect(server.messages).toContainEqual({ type: 1, message: matching(/^lsp\.conduktor-console\.settings: "mode"/) });
  }, 30_000);

  it("offers, once, to open Zed's settings when a resource is opened without a Console", async () => {
    const server = await servers.start({ zedSettings: true, answer: 'Open Settings' });
    server.open('file:///work/topic.yaml', BAD_TOPIC);
    server.open('file:///work/other.yaml', BAD_TOPIC);
    await server.diagnostics('file:///work/other.yaml', (d) => d.length > 0);
    await until(() => server.shown.length > 0);
    expect(server.prompts.map((p) => p.message)).toEqual([expect.stringMatching(/^Conduktor: no Console set/)]);
    expect(server.shown.map((s) => s.uri)).toEqual([expect.stringMatching(/\/\.config\/zed\/settings\.json$/)]);
  }, 30_000);

  it('connects to the Console as soon as the settings name it, without a restart', async () => {
    const server = await servers.start({});
    const uri = 'file:///work/live.yaml';
    server.open(uri, 'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: c-live }\n');
    await server.diagnostics(uri, () => true);
    expect(servers.fake.requests.filter((r) => r.url.includes('/cluster/c-live/'))).toEqual([]);

    server.configure({ url: servers.fake.url, name: 'later', mode: 'dev' });
    await until(async () => (await server.lenses(uri)).includes('Apply'));
    await until(() =>
      servers.fake.requests.some((r) => r.url.includes('/cluster/c-live/') && r.url.includes('dryMode')),
    );
  }, 30_000);

  it('completes from the bundled schema while the Console has not answered yet', async () => {
    const silent = await servers.startConsole({ unanswered: 'all' });
    const server = await servers.start({ settings: { url: silent.url } });
    const completion = await Promise.race([
      server.completeAtEnd('apiVersion: v2\nkind: Topic\nspec:\n  p'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('completion waited on the Console')), 5_000)),
    ]);
    expect(completion?.map((i) => i.label)).toContain('partitions');
  }, 30_000);

  it('stays up, and says why, when its bundled schema cannot be read', async () => {
    const broken = buildServer();
    rmSync(join(broken, 'dist', 'public-api-doc.yaml'));
    const server = await servers.start({}, broken);
    expect((await server.message((m) => m.type === 1)).message).toContain('public-api-doc.yaml');
    expect(await server.hover('file:///work/none.yaml', 0, 0)).toBeNull();
  }, 60_000);
});
