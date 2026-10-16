import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Hover, Location, MarkupContent } from 'vscode-languageserver';
import { buildServer, fakeConsole, startServer, type FakeConsole, type StartOptions, type Started } from './harness';

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

async function start(options: StartOptions = { settings: { url: fake.url, name: 'fake' } }): Promise<Started> {
  const server = await startServer(directory, options);
  running.push(server);
  return server;
}

const topic = (name: string, cluster: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: ${name}\n  cluster: ${cluster}\nspec:\n  partitions: 1\n  replicationFactor: 1\n`;
const cluster = (name: string) =>
  `apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: ${name}\nspec:\n  bootstrapServers: localhost:9092\n`;

async function hover(server: Started, uri: string, line: number, character: number): Promise<string> {
  const found: Hover | null = await server.connection.sendRequest('textDocument/hover', {
    textDocument: { uri },
    position: { line, character },
  });
  return (found?.contents as MarkupContent | undefined)?.value ?? '';
}

describe('docs on hover', () => {
  it("explain a field with the reference docs, and say where a reference's target is", async () => {
    const server = await start();
    const uri = 'file:///work/hover.yaml';
    server.open(uri, topic('orders', 'local-kafka'));
    const text = await hover(server, uri, 4, 4);
    expect(text).toMatch(/^\*\*`metadata\.cluster`\*\*/);
    expect(text).toMatch(/valid Kafka cluster/);
    expect(text).toMatch(/References KafkaCluster `local-kafka`: on the Console/);
  }, 30_000);

  it('summarise a kind', async () => {
    const server = await start();
    const uri = 'file:///work/kind.yaml';
    server.open(uri, topic('orders', 'local-kafka'));
    expect(await hover(server, uri, 1, 1)).toMatch(/^\*\*Topic\*\* — /);
  }, 30_000);
});

describe('reference problems', () => {
  it('flag a name that is neither in the open files nor on the Console', async () => {
    const server = await start();
    const uri = 'file:///work/nowhere.yaml';
    server.open(uri, topic('orders', 'nowhere'));
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => /nowhere/.test(x.message)));
    expect(diagnostics.find((d) => /nowhere/.test(d.message))).toMatchObject({
      message: "KafkaCluster 'nowhere' is not in the repository or on fake.",
      severity: 2,
      range: { start: { line: 4, character: 11 } },
    });
  }, 30_000);

  it('clear once another open file defines it', async () => {
    // Dry runs that never finish: only the other file's opening can publish this one again.
    const quiet = await fakeConsole({ silentWrites: true });
    afterAll(() => quiet.close());
    const server = await start({ settings: { url: quiet.url, name: 'quiet' } });
    // The session settled first, so no publish of this file is still in flight when the other one opens.
    server.open('file:///work/warm-up.yaml', topic('warm', 'nowhere'));
    await server.diagnostics('file:///work/warm-up.yaml', (d) => d.some((x) => /'nowhere'/.test(x.message)));
    const uri = 'file:///work/later.yaml';
    server.open(uri, topic('orders', 'later'));
    await server.diagnostics(uri, (d) => d.some((x) => /'later'/.test(x.message)));
    server.open('file:///work/later-cluster.yaml', cluster('later'));
    // Well before the dry run gives up on the Console (20 s), which would publish this file again on its own.
    await Promise.race([
      server.diagnostics(uri, (d) => !d.some((x) => /'later'/.test(x.message))),
      new Promise((_, reject) => setTimeout(() => reject(new Error('not published again')), 5_000)),
    ]);
  }, 30_000);
});

describe('navigation', () => {
  it('goes from a reference to the resource an open file defines', async () => {
    const server = await start();
    server.open('file:///work/mine-cluster.yaml', cluster('mine'));
    server.open('file:///work/mine-topic.yaml', topic('orders', 'mine'));
    const found: Location[] = await server.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: 'file:///work/mine-topic.yaml' },
      position: { line: 4, character: 12 },
    });
    expect(found).toEqual([
      {
        uri: 'file:///work/mine-cluster.yaml',
        range: { start: { line: 3, character: 8 }, end: { line: 3, character: 12 } },
      },
    ]);
  }, 30_000);

  it('finds what refers to a resource, from its name', async () => {
    const server = await start();
    server.open('file:///work/used-cluster.yaml', cluster('used'));
    server.open('file:///work/used-a.yaml', topic('a', 'used'));
    server.open('file:///work/used-b.yaml', topic('b', 'used'));
    const found: Location[] = await server.connection.sendRequest('textDocument/references', {
      textDocument: { uri: 'file:///work/used-cluster.yaml' },
      position: { line: 3, character: 9 },
      context: { includeDeclaration: false },
    });
    expect(found.map((l) => [l.uri, l.range.start.line])).toEqual([
      ['file:///work/used-a.yaml', 4],
      ['file:///work/used-b.yaml', 4],
    ]);
  }, 30_000);

  it('includes the resource itself when the editor asks for its declaration', async () => {
    const server = await start();
    server.open('file:///work/decl-cluster.yaml', cluster('decl'));
    server.open('file:///work/decl-a.yaml', topic('a', 'decl'));
    const found: Location[] = await server.connection.sendRequest('textDocument/references', {
      textDocument: { uri: 'file:///work/decl-cluster.yaml' },
      position: { line: 3, character: 9 },
      context: { includeDeclaration: true },
    });
    expect(found.map((l) => [l.uri, l.range.start.line])).toEqual([
      ['file:///work/decl-cluster.yaml', 3],
      ['file:///work/decl-a.yaml', 4],
    ]);
  }, 30_000);
});
