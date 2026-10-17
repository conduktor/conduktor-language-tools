import { describe, expect, it } from 'vitest';
import type { CompletionList } from 'vscode-languageserver';
import { until, useServers } from './harness';

const { start, startConsole } = useServers();

const topic = (labels: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: invoices\n  cluster: local-kafka\n  labels:\n${labels}`;
const GROUP = 'apiVersion: v2\nkind: Group\nmetadata:\n  name: core\n  labels:\n    owner: core-team\n';

describe('label completion', () => {
  it('offers the label keys in use, most used first, without the ones the Console manages', async () => {
    const items = await (await start()).completeAtEnd(topic('    t'));
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['team', 'label on 2 resources'],
      ['domain', 'label on 1 resource'],
    ]);
    expect(items![0]!.textEdit).toEqual({
      range: { start: { line: 6, character: 4 }, end: { line: 6, character: 5 } },
      newText: 'team: ',
    });
  }, 30_000);

  it('leaves out the keys the labels already have', async () => {
    const items = await (await start()).completeAtEnd(topic('    team: data\n    d'));
    expect(items?.map((i) => i.label)).toEqual(['domain']);
  }, 30_000);

  it('offers the values a key takes, once its value starts', async () => {
    const items = await (await start()).completeAtEnd(topic('    team: '), true);
    expect(items?.map((i) => i.label)).toEqual(['data', 'payments']);
  }, 30_000);

  it("adds the labels of the open files' resources, whatever their kind", async () => {
    const server = await start();
    server.open('file:///work/group.yaml', GROUP);
    expect((await server.completeAtEnd(topic('    o')))?.map((i) => i.label)).toContain('owner');
  }, 30_000);

  it('works from the open files alone, without a Console', async () => {
    const server = await start({ env: {} });
    server.open('file:///work/group.yaml', GROUP);
    expect((await server.completeAtEnd(topic('    owner: '), true))?.map((i) => i.label)).toEqual(['core-team']);
  }, 30_000);

  it('says the list is incomplete while the Console connects, so the editor asks again', async () => {
    const slow = await startConsole({ delayMs: 4_000 });
    const server = await start({ settings: { url: slow.url, name: 'slow' } });
    const uri = 'file:///work/slow-labels.yaml';
    server.open(uri, topic('    t'));
    const ask = (): Promise<CompletionList | null> =>
      server.connection.sendRequest('textDocument/completion', {
        textDocument: { uri },
        position: { line: 6, character: 5 },
      });
    expect((await ask())?.isIncomplete).toBe(true);
    await until(async () => (await ask())?.items.some((i) => i.label === 'team') === true, 20_000);
  }, 40_000);
});
