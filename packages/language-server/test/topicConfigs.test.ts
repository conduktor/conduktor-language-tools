import { beforeAll, describe, expect, it } from 'vitest';
import type { CodeAction, CompletionItem, CompletionList, Hover, MarkupContent, TextEdit } from 'vscode-languageserver';
import { buildServer, fakeConsole, startServer, type FakeConsole, type Started } from './harness';

let directory: string;
let fake: FakeConsole;
let server: Started;

beforeAll(async () => {
  directory = buildServer();
  fake = await fakeConsole();
  return () => fake.close();
}, 60_000);

beforeAll(async () => {
  server = await startServer(directory, { settings: { url: fake.url, name: 'fake' } });
  return () => server.stop();
}, 60_000);

let files = 0;
function open(text: string): string {
  const uri = `file:///work/configs-${++files}.yaml`;
  server.open(uri, text);
  return uri;
}

async function completeAtEnd(text: string, space = false): Promise<CompletionItem[] | undefined> {
  const uri = open(text);
  const lines = text.split('\n');
  const list: CompletionList | null = await server.connection.sendRequest('textDocument/completion', {
    textDocument: { uri },
    position: { line: lines.length - 1, character: lines.at(-1)!.length },
    ...(space && { context: { triggerKind: 2, triggerCharacter: ' ' } }),
  });
  return list?.items;
}

const topic = (configs: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders\n  cluster: local-kafka\nspec:\n  partitions: 3\n  configs:\n${configs}`;

describe("a Topic's configs", () => {
  it('offer every Kafka topic config not set yet, with its docs and its default to fill', async () => {
    const items = await completeAtEnd(topic('    min.insync.replicas: "2"\n    '));
    const labels = items?.map((i) => i.label);
    expect(labels).toContain('retention.ms');
    expect(labels).not.toContain('min.insync.replicas');
    const retention = items!.find((i) => i.label === 'retention.ms')!;
    expect(retention).toMatchObject({ insertTextFormat: 2 });
    expect(retention.detail).toContain('default 604800000');
    expect((retention.textEdit as TextEdit).newText).toMatch(/^retention\.ms: "?\$\{1:604800000\}"?$/);
    expect((retention.documentation as MarkupContent).value).toMatch(/^\*\*retention\.ms\*\*/);
  }, 30_000);

  it('offer the values a config takes once its value starts, the default marked', async () => {
    const items = await completeAtEnd(topic('    cleanup.policy: '), true);
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['compact', undefined],
      ['delete', 'default'],
    ]);
  }, 30_000);

  it('are documented on hover', async () => {
    const uri = open(topic('    retention.ms: "86400000"\n'));
    const hover: Hover | null = await server.connection.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line: 8, character: 6 },
    });
    expect((hover?.contents as MarkupContent).value).toMatch(/^\*\*retention\.ms\*\*/);
  }, 30_000);

  it('flag a key Kafka does not know and a value it would refuse', async () => {
    const uri = open(topic('    retention.mss: "1"\n    cleanup.policy: "sometimes"\n'));
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => x.message.includes('retention.mss')));
    expect(diagnostics.map((d) => [d.severity, d.range.start.line])).toEqual(
      expect.arrayContaining([
        [2, 8],
        [1, 9],
      ]),
    );
  }, 30_000);

  it('take a preset from the code actions, which rewrites the Topic', async () => {
    const uri = open(topic('    cleanup.policy: "delete"\n'));
    const actions: CodeAction[] = await server.connection.sendRequest('textDocument/codeAction', {
      textDocument: { uri },
      range: { start: { line: 6, character: 2 }, end: { line: 6, character: 2 } },
      context: { diagnostics: [] },
    });
    const preset = actions.find((a) => a.title === 'Preset: High throughput')!;
    expect(preset).toBeDefined();
    await server.run(preset.command!);
    const [edit] = server.edits.at(-1)!.edit.changes![uri]!;
    expect(edit!.newText).toMatch(/partitions: 12/);
    expect(edit!.newText).toMatch(/name: orders/);
  }, 30_000);
});
