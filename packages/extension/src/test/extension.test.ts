import * as assert from 'node:assert';
import * as vscode from 'vscode';
import type { ExtensionApi } from '../extension';
import type { ExplorerNode, ResourceNode } from '../explorer/explorerModel';

const EXTENSION_ID = 'conduktor.conduktor-console';

async function activate(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension<ExtensionApi>(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is installed`);
  return extension.activate();
}

async function until(condition: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function firstResource(api: ExtensionApi, node: ExplorerNode): Promise<ResourceNode | undefined> {
  for (const child of await api.explorer.getChildren(node)) {
    if (child.type === 'resource') return child;
    if (child.type === 'parent') {
      const found = await firstResource(api, child);
      if (found) return found;
    }
  }
  return undefined;
}

suite('Conduktor extension', () => {
  test('activates and registers its commands', async () => {
    await activate();
    const commands = await vscode.commands.getCommands(true);
    for (const id of [
      'conduktor.addConnection',
      'conduktor.removeConnection',
      'conduktor.switchConnection',
      'conduktor.refreshExplorer',
      'conduktor.dryRunDocument',
      'conduktor.dryRunFile',
      'conduktor.showOutput',
    ]) {
      assert.ok(commands.includes(id), id);
    }
  });
});

const baseUrl = process.env.CONDUKTOR_SMOKE_URL;
const apiKey = process.env.CONDUKTOR_SMOKE_TOKEN;

(baseUrl && apiKey ? suite : suite.skip)('Conduktor extension against a live Console', () => {
  test('connects, browses, opens a topic and dry-runs it unchanged', async () => {
    const api = await activate();
    await api.connections.add({ id: 'smoke', name: 'smoke', url: baseUrl!, mode: 'dry-run' }, apiKey!);
    await until(() => !['none', 'loading'].includes(api.sessions.current().status));
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status === 'error' ? state.message : state.status);
    assert.strictEqual(state.spec.source, 'live');

    const kafka = (await api.explorer.getChildren()).find((n) => n.type === 'group' && n.group === 'kafka');
    assert.ok(kafka, 'kafka group');
    const topicKind = (await api.explorer.getChildren(kafka)).find((n) => n.type === 'kind' && n.kind.kind === 'Topic');
    assert.ok(topicKind, 'Topic kind');
    const topic = await firstResource(api, topicKind);
    assert.ok(topic, 'at least one topic on the Console');

    const live = await vscode.workspace.openTextDocument(api.liveUri(topic));
    assert.match(live.getText(), /kind: Topic/);
    assert.strictEqual(live.languageId, 'yaml');

    const copy = await vscode.workspace.openTextDocument({ language: 'yaml', content: live.getText() });
    const items = await api.dryRun(copy.uri);
    assert.deepStrictEqual(
      items?.map((i) => i.outcome),
      [{ status: 'ok', result: 'NotChanged' }],
    );
  });
});
