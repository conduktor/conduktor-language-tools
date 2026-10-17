import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CompletionItem, CompletionList, TextEdit } from 'vscode-languageserver';
import {
  buildServer,
  fakeConsole,
  startServer,
  until,
  type FakeConsole,
  type StartOptions,
  type Started,
} from './harness';

let directory: string;
let fake: FakeConsole;
const running: Started[] = [];

beforeAll(async () => {
  directory = buildServer();
  fake = await fakeConsole();
  return () => fake.close();
}, 60_000);

afterAll(() => {
  running.forEach((server) => server.stop());
});

async function start(options: StartOptions = { settings: { url: fake.url, name: 'fake' } }): Promise<Started> {
  const server = await startServer(directory, options);
  running.push(server);
  return server;
}

let files = 0;
/** Completion at the end of the text, typed or after a space as Zed asks for it. */
async function completeAtEnd(server: Started, text: string, space = false): Promise<CompletionItem[] | undefined> {
  const uri = `file:///work/labels-${++files}.yaml`;
  server.open(uri, text);
  const lines = text.split('\n');
  const list: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
    textDocument: { uri },
    position: { line: lines.length - 1, character: lines.at(-1)!.length },
    ...(space && { context: { triggerKind: 2, triggerCharacter: ' ' } }),
  });
  return list?.items;
}

const topic = (labels: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: invoices\n  cluster: local-kafka\n  labels:\n${labels}`;

describe('label completion', () => {
  it('offers the label keys in use, most used first, without the ones the Console manages', async () => {
    const items = await completeAtEnd(await start(), topic('    t'));
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['team', 'label on 2 resources'],
      ['domain', 'label on 1 resource'],
    ]);
    expect((items![0]!.textEdit as TextEdit).newText).toBe('team: ');
    expect((items![0]!.textEdit as TextEdit).range).toEqual({
      start: { line: 6, character: 4 },
      end: { line: 6, character: 5 },
    });
  }, 30_000);

  it('leaves out the keys the labels already have', async () => {
    const items = await completeAtEnd(await start(), topic('    team: data\n    d'));
    expect(items?.map((i) => i.label)).toEqual(['domain']);
  }, 30_000);

  it('offers the values a key takes, once its value starts', async () => {
    const items = await completeAtEnd(await start(), topic('    team: '), true);
    expect(items?.map((i) => i.label)).toEqual(['data', 'payments']);
  }, 30_000);

  it("adds the labels of the open files' resources, whatever their kind", async () => {
    const server = await start();
    server.open(
      'file:///work/group.yaml',
      'apiVersion: v2\nkind: Group\nmetadata:\n  name: core\n  labels:\n    owner: core-team\n',
    );
    const items = await completeAtEnd(server, topic('    o'));
    expect(items?.map((i) => i.label)).toContain('owner');
  }, 30_000);

  it('works from the open files alone, without a Console', async () => {
    const server = await start({ env: {} });
    server.open(
      'file:///work/group.yaml',
      'apiVersion: v2\nkind: Group\nmetadata:\n  name: core\n  labels:\n    owner: core-team\n',
    );
    expect((await completeAtEnd(server, topic('    owner: '), true))?.map((i) => i.label)).toEqual(['core-team']);
  }, 30_000);

  it('says the list is incomplete while the Console connects, so the editor asks again', async () => {
    const slow = await fakeConsole({ delayMs: 4_000 });
    try {
      const server = await start({ settings: { url: slow.url, name: 'slow' } });
      const uri = 'file:///work/slow-labels.yaml';
      server.open(uri, topic('    t'));
      const ask = (): Promise<CompletionList | null> =>
        server.connection.sendRequest('textDocument/completion', {
          textDocument: { uri },
          position: { line: 6, character: 5 },
        });
      const early = await ask();
      expect(early?.isIncomplete).toBe(true);
      await until(async () => (await ask())?.items.some((i) => i.label === 'team') === true, 20_000);
    } finally {
      slow.close();
    }
  }, 40_000);
});
