import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type {
  CodeAction,
  DocumentSymbol,
  PrepareRenameResult,
  SymbolInformation,
  TextEdit,
  WorkspaceEdit,
} from 'vscode-languageserver';
import { useServers } from './harness';

const servers = useServers();
const { start } = servers;

const topic = (name: string, cluster: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: ${name}\n  cluster: ${cluster}\nspec:\n  partitions: 1\n  replicationFactor: 1\n`;
const cluster = (name: string) =>
  `apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: ${name}\nspec:\n  bootstrapServers: localhost:9092\n`;

function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'conduktor-editing-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}
const uriOf = (root: string, path: string) => pathToFileURL(join(root, path)).href;
const apply = (text: string, edits: TextEdit[]) => {
  const lines = text.split('\n');
  const offset = (p: { line: number; character: number }) =>
    lines.slice(0, p.line).reduce((sum, line) => sum + line.length + 1, 0) + p.character;
  return [...edits]
    .sort((a, b) => offset(b.range.start) - offset(a.range.start))
    .reduce((out, e) => out.slice(0, offset(e.range.start)) + e.newText + out.slice(offset(e.range.end)), text);
};

describe('symbols', () => {
  it("outline a file's resources by name, with their kind and parents", async () => {
    const server = await start();
    const uri = 'file:///work/outline.yaml';
    server.open(uri, `${topic('orders', 'local-kafka')}---\n${cluster('local-kafka')}`);
    const symbols: DocumentSymbol[] = await server.connection.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri },
    });
    expect(symbols.map((s) => [s.name, s.detail, s.selectionRange.start.line])).toEqual([
      ['orders', 'Topic · local-kafka', 3],
      ['local-kafka', 'KafkaCluster', 12],
    ]);
  }, 30_000);

  it('find resources by name across the workspace, open or not', async () => {
    const root = workspace({ 'a.yaml': topic('orders', 'local-kafka'), 'b.yaml': topic('payments', 'local-kafka') });
    const server = await start({ settings: { url: servers.fake.url, name: 'fake' }, folders: [root] });
    const found: SymbolInformation[] = await server.connection.sendRequest('workspace/symbol', { query: 'ordr' });
    expect(found.map((s) => [s.name, s.containerName, s.location.uri])).toEqual([
      ['orders', 'Topic · local-kafka', uriOf(root, 'a.yaml')],
    ]);
  }, 30_000);
});

describe('rename', () => {
  it('rename a resource from its name or a reference, in every file that names it', async () => {
    const root = workspace({
      'cluster.yaml': cluster('disk'),
      'a.yaml': topic('a', 'disk'),
      'other.yaml': topic('c', 'elsewhere'),
    });
    const server = await start({ settings: { url: servers.fake.url, name: 'fake' }, folders: [root] });
    const opened = uriOf(root, 'b.yaml');
    server.open(opened, topic('b', 'disk'));

    const fromReference: PrepareRenameResult = await server.connection.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: opened },
      position: { line: 4, character: 12 },
    });
    expect(fromReference).toEqual({
      range: { start: { line: 4, character: 11 }, end: { line: 4, character: 15 } },
      placeholder: 'disk',
    });
    const onKind = await server.connection.sendRequest('textDocument/prepareRename', {
      textDocument: { uri: opened },
      position: { line: 1, character: 7 },
    });
    expect(onKind).toBeNull();

    const edit: WorkspaceEdit = await server.connection.sendRequest('textDocument/rename', {
      textDocument: { uri: opened },
      position: { line: 4, character: 12 },
      newName: 'local',
    });
    const changes = edit.changes ?? {};
    expect(Object.keys(changes).sort()).toEqual([uriOf(root, 'cluster.yaml'), uriOf(root, 'a.yaml'), opened].sort());
    expect(apply(cluster('disk'), changes[uriOf(root, 'cluster.yaml')]!)).toBe(cluster('local'));
    expect(apply(topic('b', 'disk'), changes[opened]!)).toBe(topic('b', 'local'));
  }, 30_000);

  it('say when the Console keeps the old name', async () => {
    const server = await start();
    const uri = 'file:///work/rename-orders.yaml';
    server.open(uri, topic('orders', 'local-kafka'));
    await server.connection.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: { line: 3, character: 9 },
      newName: 'orders-v2',
    });
    const { message } = await server.message((m) => m.message.includes('orders-v2'));
    expect(message).toBe(
      "Renamed in your files only. fake still has Topic 'orders': applying creates 'orders-v2' beside it.",
    );
  }, 30_000);
});

describe('quick fixes', () => {
  const titles = (actions: CodeAction[]) => actions.filter((a) => a.kind === 'quickfix').map((a) => a.title);

  it('offer the closest name for one that does not exist, and apply it as an edit', async () => {
    const server = await start();
    const uri = 'file:///work/typo.yaml';
    const text = topic('orders', 'loacl-kafka');
    server.open(uri, text);
    await server.diagnostics(uri, (d) => d.some((x) => x.message.includes("'loacl-kafka'")));
    const actions = await server.actions(uri, 4);
    expect(titles(actions)).toEqual(["Change to 'local-kafka'"]);
    const fix = actions.find((a) => a.kind === 'quickfix')!;
    expect(fix.diagnostics?.[0]?.message).toMatch(/'loacl-kafka' is not in the repository/);
    expect(apply(text, fix.edit!.changes![uri]!)).toBe(topic('orders', 'local-kafka'));
  }, 30_000);

  it("offer a topic config's closest key, and an apiVersion where it is missing", async () => {
    const server = await start();
    const uri = 'file:///work/configs.yaml';
    server.open(uri, `${topic('t', 'local-kafka')}  configs:\n    retention.mss: "1"\n`);
    await server.diagnostics(uri, (d) => d.some((x) => x.message.includes('retention.mss')));
    expect(titles(await server.actions(uri, 9))).toEqual(["Change to 'retention.ms'"]);
    const unversioned = 'file:///work/unversioned.yaml';
    server.open(unversioned, 'kind: Topic\nmetadata:\n  name: t\n');
    expect(titles(await server.actions(unversioned, 0))).toEqual(['Add apiVersion: v2']);
  }, 30_000);
});
