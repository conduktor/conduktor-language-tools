import { describe, expect, it } from 'vitest';
import type { Location } from 'vscode-languageserver';
import { useServers } from './harness';

const { start, startConsole } = useServers();

const topic = (name: string, cluster: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: ${name}\n  cluster: ${cluster}\nspec:\n  partitions: 1\n  replicationFactor: 1\n`;
const cluster = (name: string) =>
  `apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: ${name}\nspec:\n  bootstrapServers: localhost:9092\n`;

describe('docs on hover', () => {
  it("explain a field with the reference docs, and say where a reference's target is", async () => {
    const server = await start();
    const uri = 'file:///work/hover.yaml';
    server.open(uri, topic('orders', 'local-kafka'));
    const text = await server.hover(uri, 4, 4);
    expect(text).toMatch(/^\*\*`metadata\.cluster`\*\*/);
    expect(text).toMatch(/valid Kafka cluster/);
    expect(text).toMatch(/References KafkaCluster `local-kafka`: on the Console/);
  }, 30_000);

  it('summarise a kind', async () => {
    const server = await start();
    const uri = 'file:///work/kind.yaml';
    server.open(uri, topic('orders', 'local-kafka'));
    expect(await server.hover(uri, 1, 1)).toMatch(/^\*\*Topic\*\* — /);
  }, 30_000);
});

describe('reference problems', () => {
  it('flag a name that is neither in the open files nor on the Console', async () => {
    const server = await start();
    const uri = 'file:///work/nowhere.yaml';
    server.open(uri, topic('orders', 'nowhere'));
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => x.message.includes('nowhere')));
    expect(diagnostics.find((d) => d.message.includes('nowhere'))).toMatchObject({
      message: "KafkaCluster 'nowhere' is not in the repository or on fake.",
      severity: 2,
      range: { start: { line: 4, character: 11 } },
    });
  }, 30_000);

  it('clear once another open file defines it', async () => {
    // Dry runs that never finish: only the other file's opening can publish this one again.
    const quiet = await startConsole({ unanswered: 'writes' });
    const server = await start({ settings: { url: quiet.url, name: 'quiet' } });
    // The session settled first, so no publish of this file is still in flight when the other one opens.
    server.open('file:///work/warm-up.yaml', topic('warm', 'nowhere'));
    await server.diagnostics('file:///work/warm-up.yaml', (d) => d.some((x) => x.message.includes("'nowhere'")));
    const uri = 'file:///work/later.yaml';
    server.open(uri, topic('orders', 'later'));
    await server.diagnostics(uri, (d) => d.some((x) => x.message.includes("'later'")));
    server.open('file:///work/later-cluster.yaml', cluster('later'));
    // Well before the dry run gives up on the Console (20 s), which would publish this file again on its own.
    const published = await Promise.race([
      server.diagnostics(uri, (d) => !d.some((x) => x.message.includes("'later'"))),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('not published again')), 5_000)),
    ]);
    expect(published.filter((d) => d.message.includes("'later'"))).toEqual([]);
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

  it.each([
    [false, []],
    [true, [['file:///work/used-cluster.yaml', 3]]],
  ])(
    'finds what refers to a resource from its name, and the resource itself if asked for its declaration (%s)',
    async (includeDeclaration, declaration) => {
      const server = await start();
      server.open('file:///work/used-cluster.yaml', cluster('used'));
      server.open('file:///work/used-a.yaml', topic('a', 'used'));
      server.open('file:///work/used-b.yaml', topic('b', 'used'));
      const found: Location[] = await server.connection.sendRequest('textDocument/references', {
        textDocument: { uri: 'file:///work/used-cluster.yaml' },
        position: { line: 3, character: 9 },
        context: { includeDeclaration },
      });
      expect(found.map((l) => [l.uri, l.range.start.line])).toEqual([
        ...declaration,
        ['file:///work/used-a.yaml', 4],
        ['file:///work/used-b.yaml', 4],
      ]);
    },
    30_000,
  );
});
