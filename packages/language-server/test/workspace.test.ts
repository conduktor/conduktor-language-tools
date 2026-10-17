import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Location } from 'vscode-languageserver';
import { useServers } from './harness';

const servers = useServers();
const { start } = servers;

const topic = (name: string, cluster: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: ${name}\n  cluster: ${cluster}\nspec:\n  partitions: 1\n  replicationFactor: 1\n`;
const cluster = (name: string) =>
  `apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: ${name}\nspec:\n  bootstrapServers: localhost:9092\n`;

/** A workspace folder holding the files, by path relative to it. */
function workspace(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'conduktor-workspace-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const uriOf = (root: string, path: string) => pathToFileURL(join(root, path)).href;
const mentions = (name: string) => (d: { message: string }[]) => d.some((x) => x.message.includes(`'${name}'`));

describe('the workspace', () => {
  it("counts the resources of files that are not open, but not dependencies' or tools' copies", async () => {
    const root = workspace({
      'clusters/disk.yaml': cluster('disk'),
      'topics/a.yaml': topic('a', 'disk'),
      'node_modules/pkg/disk.yaml': cluster('disk'),
      '.history/disk.yaml': cluster('disk'),
    });
    const server = await start({ settings: { url: servers.fake.url, name: 'fake' }, folders: [root] });
    const opened = uriOf(root, 'topics/b.yaml');
    server.open(opened, topic('b', 'disk'));
    const published = server.diagnostics(opened, () => true);

    const found: Location[] = await server.connection.sendRequest('textDocument/definition', {
      textDocument: { uri: opened },
      position: { line: 4, character: 12 },
    });
    expect(found.map((l) => [l.uri, l.range.start.line])).toEqual([[uriOf(root, 'clusters/disk.yaml'), 3]]);

    const clusterUri = uriOf(root, 'clusters/disk.yaml');
    server.open(clusterUri, cluster('disk'));
    const referrers: Location[] = await server.connection.sendRequest('textDocument/references', {
      textDocument: { uri: clusterUri },
      position: { line: 3, character: 9 },
      context: { includeDeclaration: false },
    });
    expect(referrers.map((l) => l.uri).sort()).toEqual([opened, uriOf(root, 'topics/a.yaml')].sort());

    expect((await published).filter((d) => d.message.includes("'disk'"))).toEqual([]);
  }, 30_000);

  it('follows files created and deleted on disk', async () => {
    const root = workspace({});
    const server = await start({ settings: { url: servers.fake.url, name: 'fake' }, folders: [root] });
    await server.registered('workspace/didChangeWatchedFiles');
    const opened = uriOf(root, 'topic.yaml');
    server.open(opened, topic('t', 'later'));
    await server.diagnostics(opened, mentions('later'));

    const created = join(root, 'later.yaml');
    writeFileSync(created, cluster('later'));
    server.filesChanged([{ uri: pathToFileURL(created).href, type: 1 }]);
    await server.diagnostics(opened, (d) => !mentions('later')(d));

    rmSync(created);
    server.filesChanged([{ uri: pathToFileURL(created).href, type: 3 }]);
    const missing = await server.diagnostics(opened, mentions('later'));
    expect(missing.map((d) => d.message)).toContain("KafkaCluster 'later' is not in the repository or on fake.");
  }, 30_000);
});
