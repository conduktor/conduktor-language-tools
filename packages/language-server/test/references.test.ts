import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompletionItem, CompletionList, TextEdit } from 'vscode-languageserver';
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

async function start(options: StartOptions): Promise<Started> {
  const server = await startServer(directory, options);
  running.push(server);
  return server;
}

const connected = () => start({ settings: { url: fake.url, name: 'fake' } });
const topic = (cluster: string) => `kind: Topic\napiVersion: v2\nmetadata:\n  name: toto\n  cluster:${cluster}`;
const CLUSTER =
  'apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: mine\nspec:\n  bootstrapServers: localhost:9092\n';

/** Completion at the end of the document, as Zed asks for it when a space is typed. */
async function afterSpace(server: Started, uri: string, text: string): Promise<CompletionItem[] | undefined> {
  server.open(uri, text);
  const lines = text.split('\n');
  const list: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
    textDocument: { uri },
    position: { line: lines.length - 1, character: lines.at(-1)!.length },
    context: { triggerKind: 2, triggerCharacter: ' ' },
  });
  return list?.items;
}

describe('reference completion', () => {
  it("offers a Topic's cluster from the Console's clusters, as soon as its value starts", async () => {
    const server = await connected();
    const items = await afterSpace(server, 'file:///work/topic.yaml', topic(' '));
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['local-kafka', 'KafkaCluster · Console'],
      ['prod-kafka', 'KafkaCluster · Console'],
    ]);
    expect(items![0]!.textEdit).toEqual({
      range: { start: { line: 4, character: 11 }, end: { line: 4, character: 11 } },
      newText: 'local-kafka',
    });
  }, 30_000);

  it('adds the space a value needs after a bare colon', async () => {
    const server = await connected();
    const uri = 'file:///work/bare.yaml';
    server.open(uri, topic(''));
    const list: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line: 4, character: 10 },
    });
    expect((list?.items[0]?.textEdit as TextEdit).newText).toBe(' local-kafka');
  }, 30_000);

  it('adds the clusters the open files define, and marks where each comes from', async () => {
    const server = await connected();
    server.open('file:///work/cluster.yaml', CLUSTER);
    const items = await afterSpace(server, 'file:///work/topic.yaml', topic(' '));
    expect(items?.map((i) => [i.label, i.detail])).toContainEqual(['mine', 'KafkaCluster · repo']);
  }, 30_000);

  it('offers the open files’ clusters without a Console', async () => {
    const server = await start({ env: {} });
    server.open('file:///work/cluster.yaml', CLUSTER);
    const items = await afterSpace(server, 'file:///work/topic.yaml', topic(' '));
    expect(items?.map((i) => i.label)).toEqual(['mine']);
  }, 30_000);

  it('opens nothing on a space typed anywhere else', async () => {
    const server = await connected();
    const text =
      'kind: Topic\napiVersion: v2\nmetadata:\n  name: toto\n  cluster: local-kafka\n  labels:\n    team: data ';
    expect(await afterSpace(server, 'file:///work/space.yaml', text)).toBeUndefined();
  }, 30_000);

  it("offers the names that already exist for a resource's own name, once a letter is typed", async () => {
    const server = await connected();
    const uri = 'file:///work/existing.yaml';
    server.open(uri, 'kind: Topic\napiVersion: v2\nmetadata:\n  cluster: local-kafka\n  name: o');
    const list: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line: 4, character: 9 },
    });
    expect(list?.items.map((i) => [i.label, i.detail])).toEqual([
      ['orders', 'Topic · Console'],
      ['payments', 'Topic · Console'],
    ]);
  }, 30_000);

  it('does not open the existing names on a space, where a new name is as likely', async () => {
    const server = await connected();
    const text = 'kind: Topic\napiVersion: v2\nmetadata:\n  cluster: local-kafka\n  name: ';
    expect(await afterSpace(server, 'file:///work/new-name.yaml', text)).toBeUndefined();
  }, 30_000);
});
