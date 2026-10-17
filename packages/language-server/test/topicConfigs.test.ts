import { beforeAll, describe, expect, it } from 'vitest';
import type { MarkupContent, TextEdit } from 'vscode-languageserver';
import { useServers, type Started } from './harness';

const { start } = useServers();
let server: Started;
beforeAll(async () => {
  server = await start();
}, 60_000);

const topic = (configs: string) =>
  `apiVersion: v2\nkind: Topic\nmetadata:\n  name: orders\n  cluster: local-kafka\nspec:\n  partitions: 3\n  configs:\n${configs}`;

describe("a Topic's configs", () => {
  it('offer every Kafka topic config not set yet, with its docs and its default to fill', async () => {
    const items = await server.completeAtEnd(topic('    min.insync.replicas: "2"\n    '));
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
    const items = await server.completeAtEnd(topic('    cleanup.policy: '), true);
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['compact', undefined],
      ['delete', 'default'],
    ]);
  }, 30_000);

  it('are documented on hover', async () => {
    const uri = 'file:///work/configs-hover.yaml';
    server.open(uri, topic('    retention.ms: "86400000"\n'));
    expect(await server.hover(uri, 8, 6)).toMatch(/^\*\*retention\.ms\*\*/);
  }, 30_000);

  it('flag a key Kafka does not know and a value it would refuse', async () => {
    const uri = 'file:///work/configs-problems.yaml';
    server.open(uri, topic('    retention.mss: "1"\n    cleanup.policy: "sometimes"\n'));
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => x.message.includes('retention.mss')));
    expect(diagnostics.map((d) => [d.severity, d.range.start.line])).toEqual(
      expect.arrayContaining([
        [2, 8],
        [1, 9],
      ]),
    );
  }, 30_000);

  it('take a preset from the code actions, which rewrites the Topic', async () => {
    const uri = 'file:///work/configs-preset.yaml';
    server.open(uri, topic('    cleanup.policy: "delete"\n'));
    const preset = (await server.actions(uri, 6)).find((a) => a.title === 'Preset: High throughput')!;
    expect(preset).toBeDefined();
    await server.run(preset.command!);
    const [edit] = server.edits.at(-1)!.edit.changes![uri]!;
    expect(edit!.newText).toMatch(/partitions: 12/);
    expect(edit!.newText).toMatch(/name: orders/);
  }, 30_000);
});
