import { describe, expect, it } from 'vitest';
import type { TextEdit } from 'vscode-languageserver';
import { useServers } from './harness';

const { start } = useServers();

const topic = (cluster: string) => `kind: Topic\napiVersion: v2\nmetadata:\n  name: toto\n  cluster:${cluster}`;
const named = (name: string) => `kind: Topic\napiVersion: v2\nmetadata:\n  cluster: local-kafka\n  name:${name}`;
const CLUSTER =
  'apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: mine\nspec:\n  bootstrapServers: localhost:9092\n';

describe('reference completion', () => {
  it("offers a Topic's cluster from the Console's clusters, as soon as its value starts", async () => {
    const items = await (await start()).completeAtEnd(topic(' '), true);
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
    const items = await (await start()).completeAtEnd(topic(''));
    expect((items?.[0]?.textEdit as TextEdit).newText).toBe(' local-kafka');
  }, 30_000);

  it('adds the clusters the open files define, and marks where each comes from', async () => {
    const server = await start();
    server.open('file:///work/cluster.yaml', CLUSTER);
    const items = await server.completeAtEnd(topic(' '), true);
    expect(items?.map((i) => [i.label, i.detail])).toContainEqual(['mine', 'KafkaCluster · repo']);
  }, 30_000);

  it('offers the open files’ clusters without a Console', async () => {
    const server = await start({ env: {} });
    server.open('file:///work/cluster.yaml', CLUSTER);
    expect((await server.completeAtEnd(topic(' '), true))?.map((i) => i.label)).toEqual(['mine']);
  }, 30_000);

  it('opens nothing on a space typed anywhere else', async () => {
    const items = await (await start()).completeAtEnd(topic(' local-kafka\n  labels:\n    team: data '), true);
    expect(items).toBeUndefined();
  }, 30_000);

  it("offers the names that already exist for a resource's own name, once a letter is typed", async () => {
    const items = await (await start()).completeAtEnd(named(' o'));
    expect(items?.map((i) => [i.label, i.detail])).toEqual([
      ['orders', 'Topic · Console'],
      ['payments', 'Topic · Console'],
    ]);
  }, 30_000);

  it('does not open the existing names on a space, where a new name is as likely', async () => {
    expect(await (await start()).completeAtEnd(named(' '), true)).toBeUndefined();
  }, 30_000);
});
