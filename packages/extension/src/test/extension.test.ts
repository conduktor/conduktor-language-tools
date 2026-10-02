import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse, stringify } from 'yaml';
import type { ExtensionApi } from '../extension';
import type { ExplorerNode, ResourceNode } from '../explorer/explorerModel';

const EXTENSION_ID = 'conduktor.conduktor-console';

async function activate(): Promise<ExtensionApi> {
  const extension = vscode.extensions.getExtension<ExtensionApi | undefined>(EXTENSION_ID);
  assert.ok(extension, `${EXTENSION_ID} is installed`);
  const api = await extension.activate();
  assert.ok(api, 'the API is exported in test mode');
  return api;
}

async function useWorkspaceSyncRoot(api: ExtensionApi): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert.ok(folder, 'the smoke test runs in a workspace folder');
  await api.sync.setSyncRoot(vscode.Uri.joinPath(folder.uri, 'conduktor'));
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

  test('offers its agent tools to language models', async () => {
    await activate();
    const names = vscode.lm.tools.map((tool) => tool.name);
    for (const name of [
      'conduktor_list_kinds',
      'conduktor_get_kind_schema',
      'conduktor_validate',
      'conduktor_dry_run',
      'conduktor_get_resources',
    ]) {
      assert.ok(names.includes(name), name);
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

    const roots = await api.explorer.getChildren();
    assert.deepStrictEqual(
      roots.map((n) => n.type === 'scope' && n.scope),
      ['global', 'cluster'],
    );
    await api.clusters.set('local-kafka');
    const clusterScope = (await api.explorer.getChildren()).find((n) => n.type === 'scope' && n.scope === 'cluster');
    assert.ok(clusterScope?.type === 'scope' && clusterScope.cluster === 'local-kafka', 'cluster selected');
    const kafka = (await api.explorer.getChildren(clusterScope)).find((n) => n.type === 'group' && n.group === 'kafka');
    assert.ok(kafka, 'kafka group');
    const topicKind = (await api.explorer.getChildren(kafka)).find((n) => n.type === 'kind' && n.kind.kind === 'Topic');
    assert.ok(topicKind, 'Topic kind');
    const topic = await firstResource(api, topicKind);
    assert.ok(topic, 'at least one topic on the Console');

    const live = await vscode.workspace.openTextDocument(api.liveUri(topic));
    assert.match(live.getText(), /kind: Topic/);
    assert.strictEqual(live.languageId, 'yaml');
    assert.strictEqual(
      vscode.workspace.fs.isWritableFileSystem(live.uri.scheme),
      true,
      'live documents can be edited in dry-run mode; saving stages them locally',
    );

    const copy = await vscode.workspace.openTextDocument({ language: 'yaml', content: live.getText() });
    const items = await api.dryRun(copy.uri);
    assert.deepStrictEqual(
      items?.map((i) => i.outcome),
      [{ status: 'ok', result: 'NotChanged' }],
    );
  });

  test('stages an edited live resource as a local file when saved in dry-run mode', async () => {
    const api = await activate();
    await useWorkspaceSyncRoot(api);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    assert.strictEqual(state.connection.mode, 'dry-run');
    const topicKind = state.spec.catalog.latest('Topic')!;
    const [existing] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
    const name = existing!.metadata.name;
    const live = await vscode.workspace.openTextDocument(
      api.liveUri({ type: 'resource', kind: topicKind, parents: ['local-kafka'], name }),
    );
    const edited = parse(live.getText());
    edited.metadata.labels = { ...(edited.metadata.labels ?? {}), staged: 'from-live' };
    const edit = new vscode.WorkspaceEdit();
    edit.replace(live.uri, new vscode.Range(0, 0, live.lineCount, 0), stringify(edited));
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await live.save(), 'saving a live document in dry-run mode succeeds');

    const local = vscode.Uri.joinPath(
      vscode.workspace.workspaceFolders![0]!.uri,
      'conduktor',
      state.connection.name,
      'clusters/local-kafka/kafka/Topic',
      `${name}.yaml`,
    );
    try {
      const staged = parse(new TextDecoder().decode(await vscode.workspace.fs.readFile(local)));
      assert.strictEqual(staged.metadata.labels.staged, 'from-live');
      assert.strictEqual(api.sync.entryAt(local)?.status, 'modified');
      await until(() => !live.getText().includes('from-live'));
    } finally {
      await api.sync.discard(local).catch(() => undefined);
    }
  });

  test('reports a corrupted resource in Problems instead of doing nothing', async () => {
    const api = await activate();
    const broken = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: 'apiVersion: v2\nkind: Topic\nmetadata: [unclosed\n',
    });
    const items = await api.dryRun(broken.uri);
    assert.strictEqual(items?.length, 1);
    assert.strictEqual(items[0]!.outcome.status, 'error');
    const problems = vscode.languages.getDiagnostics(broken.uri).filter((d) => d.source === 'Conduktor');
    assert.ok(problems.length > 0, 'a Conduktor problem is shown');
  });

  test('creates, edits, diffs and deletes a topic in apply mode', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    await api.connections.add({ id: 'smoke-apply', name: 'smoke-apply', url: baseUrl!, mode: 'apply' }, apiKey!);
    await until(() => {
      const current = api.sessions.current();
      return current.status === 'ready' && current.connection.id === 'smoke-apply';
    });
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const topicKind = state.spec.catalog.latest('Topic')!;
    const cluster = 'local-kafka';
    const name = `vscode-smoke-${Date.now()}`;
    const node: ResourceNode = { type: 'resource', kind: topicKind, parents: [cluster], name };
    // The topic list comes from Console's indexer and lags behind writes; the item GET does not.
    const exists = () =>
      state.client.get(`/public/kafka/v2/cluster/${cluster}/topic/${name}`).then(
        () => true,
        (error: { status?: number }) => (error.status === 404 ? false : Promise.reject(error)),
      );

    try {
      const draft = await vscode.workspace.openTextDocument({
        language: 'yaml',
        content: stringify({
          apiVersion: 'v2',
          kind: 'Topic',
          metadata: { name, cluster },
          spec: { partitions: 1, replicationFactor: 1 },
        }),
      });
      assert.deepStrictEqual(
        (await api.apply(draft.uri))?.map((i) => i.outcome),
        [{ status: 'ok', result: 'Created' }],
      );
      assert.ok(await exists(), 'topic created');
      assert.deepStrictEqual(
        (await api.dryRun(draft.uri))?.map((i) => i.outcome),
        [{ status: 'ok', result: 'NotChanged' }],
      );

      const live = await vscode.workspace.openTextDocument(api.liveUri(node));
      assert.strictEqual(
        vscode.workspace.fs.isWritableFileSystem(live.uri.scheme),
        true,
        'apply mode can edit live documents',
      );
      const edited = parse(live.getText());
      edited.metadata.labels = { ...(edited.metadata.labels ?? {}), smoke: 'edited' };
      const edit = new vscode.WorkspaceEdit();
      edit.replace(live.uri, new vscode.Range(0, 0, live.lineCount, 0), stringify(edited));
      assert.ok(await vscode.workspace.applyEdit(edit));
      assert.ok(await live.save(), 'live document saved');
      const saved = await state.client.get(`/public/kafka/v2/cluster/${cluster}/topic/${name}`);
      assert.strictEqual((saved.metadata.labels as Record<string, string>).smoke, 'edited');

      await vscode.commands.executeCommand('conduktor.diffWithLive', draft.uri, 0);
      assert.ok(vscode.window.tabGroups.activeTabGroup.activeTab?.input instanceof vscode.TabInputTextDiff);

      await vscode.commands.executeCommand('conduktor.deleteResource', node);
      assert.ok(!(await exists()), 'topic deleted');
    } finally {
      if (await exists()) await state.client.delete(`/public/kafka/v2/cluster/${cluster}/topic/${name}`);
    }
  });

  test('answers agent tool calls with the live schema and a dry run', async () => {
    await activate();
    const call = async (name: string, input: object) => {
      const result = await vscode.lm.invokeTool(name, { input, toolInvocationToken: undefined });
      return result.content.map((part) => (part instanceof vscode.LanguageModelTextPart ? part.value : '')).join('');
    };
    const kinds = JSON.parse(await call('conduktor_list_kinds', {}));
    assert.ok(kinds.kinds.some((k: { kind: string }) => k.kind === 'Topic'));
    assert.match(await call('conduktor_get_kind_schema', { kind: 'Topic' }), /TopicResourceV2/);

    const yaml =
      'apiVersion: v2\nkind: Topic\nmetadata: { name: vscode-agent-probe, cluster: local-kafka }\nspec: { partitions: three }\n';
    const validation = JSON.parse(await call('conduktor_validate', { yaml }));
    assert.ok(validation.documents[0].errors.some((e: { path: string }) => e.path === '/spec/partitions'));

    const dryRun = JSON.parse(
      await call('conduktor_dry_run', { yaml: yaml.replace('three', '1, replicationFactor: 1') }),
    );
    assert.strictEqual(dryRun.documents[0].result, 'Created');
    assert.match(dryRun.note, /Nothing was changed/);
  });

  test('applies a group, an application and its instance from one file, in order', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    await until(() => {
      const current = api.sessions.current();
      return current.status === 'ready' && current.connection.mode === 'apply';
    });
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const id = `vscode-chain-${Date.now()}`;
    const paths = [
      `/public/self-serve/v1/application-instance/${id}-dev`,
      `/public/self-serve/v1/application/${id}-app`,
      `/public/iam/v2/group/${id}-team`,
    ];
    const file = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: [
        {
          apiVersion: 'v1',
          kind: 'ApplicationInstance',
          metadata: { name: `${id}-dev`, application: `${id}-app` },
          spec: { cluster: 'local-kafka' },
        },
        {
          apiVersion: 'v1',
          kind: 'Application',
          metadata: { name: `${id}-app` },
          spec: { title: 'Chain', owner: `${id}-team` },
        },
        { apiVersion: 'v2', kind: 'Group', metadata: { name: `${id}-team` }, spec: { displayName: 'Chain team' } },
      ]
        .map((resource) => stringify(resource))
        .join('---\n'),
    });
    try {
      const preview = await api.dryRun(file.uri);
      assert.deepStrictEqual(
        preview?.map((i) => [i.document.kind, i.outcome.status]),
        [
          ['Group', 'ok'],
          ['Application', 'pending'],
          ['ApplicationInstance', 'pending'],
        ],
      );
      const applied = await api.apply(file.uri);
      assert.deepStrictEqual(
        applied?.map((i) => [i.document.kind, i.outcome]),
        [
          ['Group', { status: 'ok', result: 'Created' }],
          ['Application', { status: 'ok', result: 'Created' }],
          ['ApplicationInstance', { status: 'ok', result: 'Created' }],
        ],
      );
    } finally {
      for (const path of paths) await state.client.delete(path).catch(() => undefined);
    }
  });

  test('syncs a topic into the folder and tracks local changes against it', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const topicKind = state.spec.catalog.latest('Topic')!;
    await useWorkspaceSyncRoot(api);
    await api.clusters.set('local-kafka');
    const [existing] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
    assert.ok(existing, 'a topic to sync');
    const name = existing.metadata.name;

    const uri = await api.sync.syncResource(topicKind, ['local-kafka'], name);
    assert.ok(
      uri.path.endsWith(`/conduktor/${state.connection.name}/clusters/local-kafka/kafka/Topic/${name}.yaml`),
      uri.path,
    );
    assert.ok(api.sync.isActive());
    assert.strictEqual(api.sync.entryAt(uri)?.status, 'synced');

    const synced = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const edited = parse(synced);
    edited.metadata.labels = { ...(edited.metadata.labels ?? {}), staged: 'yes' };
    await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(stringify(edited)));
    await api.sync.refresh();
    assert.strictEqual(api.sync.entryAt(uri)?.status, 'modified');

    api.explorer.showOnlyChanges(true);
    try {
      const scopes = await api.explorer.getChildren();
      assert.deepStrictEqual(
        scopes.map((n) => n.type === 'scope' && [n.scope, n.cluster]),
        [['cluster', 'local-kafka']],
      );
      const groups = await api.explorer.getChildren(scopes[0]);
      assert.deepStrictEqual(
        groups.map((g) => g.type === 'group' && g.group),
        ['kafka'],
      );
      const [topics] = await api.explorer.getChildren(groups[0]);
      const changed = await api.explorer.getChildren(topics);
      assert.deepStrictEqual(
        changed.map((n) => n.type === 'resource' && [n.name, n.local?.status]),
        [[name, 'modified']],
      );
    } finally {
      api.explorer.showOnlyChanges(false);
    }

    const liveUri = api.liveUri({ type: 'resource', kind: topicKind, parents: ['local-kafka'], name });
    await vscode.commands.executeCommand('conduktor.editLocally', liveUri);
    assert.strictEqual(vscode.window.activeTextEditor?.document.uri.toString(), uri.toString());

    const drafted = await api.newResource({ type: 'parent', kind: topicKind, parents: ['local-kafka'] });
    assert.ok(drafted && api.sync.contains(drafted.uri), drafted?.uri.toString());
    assert.match(drafted.getText(), /kind: Topic/);
    assert.match(drafted.getText(), /cluster: local-kafka/);
    assert.strictEqual(api.sync.entryAt(drafted.uri)?.status, 'new');
    const renamed = `vscode-renamed-${Date.now()}`;
    const draft = parse(drafted.getText());
    draft.metadata.name = renamed;
    const rename = new vscode.WorkspaceEdit();
    rename.replace(drafted.uri, new vscode.Range(0, 0, drafted.lineCount, 0), stringify(draft));
    assert.ok(await vscode.workspace.applyEdit(rename));
    assert.ok(await drafted.save());
    await api.sync.refresh();
    const moved = api.sync.entryFor('Topic', ['local-kafka'], renamed);
    assert.ok(moved && moved.path.endsWith(`clusters/local-kafka/kafka/Topic/${renamed}.yaml`), moved?.path);
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.workspace.fs.delete(moved.uri);

    await api.sync.discard(uri);
    await api.sync.refresh({ drift: true });
    assert.deepStrictEqual(
      { status: api.sync.entryAt(uri)?.status, drifted: api.sync.entryAt(uri)?.drifted },
      { status: 'synced', drifted: false },
    );
  });

  test('stages a group, an application and its instance as files and applies all changes in order', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const kind = (name: string) => state.spec.catalog.latest(name)!;
    const id = `vscode-staged-${Date.now()}`;
    const files = [
      await api.sync.writeNew(
        kind('ApplicationInstance'),
        [],
        stringify({
          apiVersion: 'v1',
          kind: 'ApplicationInstance',
          metadata: { name: `${id}-dev`, application: `${id}-app` },
          spec: { cluster: 'local-kafka' },
        }),
        `${id}-dev`,
      ),
      await api.sync.writeNew(
        kind('Application'),
        [],
        stringify({
          apiVersion: 'v1',
          kind: 'Application',
          metadata: { name: `${id}-app` },
          spec: { title: 'Staged', owner: `${id}-team` },
        }),
        `${id}-app`,
      ),
      await api.sync.writeNew(
        kind('Group'),
        [],
        stringify({
          apiVersion: 'v2',
          kind: 'Group',
          metadata: { name: `${id}-team` },
          spec: { displayName: 'Staged team' },
        }),
        `${id}-team`,
      ),
    ];
    try {
      assert.deepStrictEqual(
        files.map((f) => api.sync.entryAt(f)?.status),
        ['new', 'new', 'new'],
      );
      const applied = await api.applyAllChanges();
      const mine = applied?.filter((item) => item.document.resource?.metadata.name.startsWith(id));
      assert.deepStrictEqual(
        mine?.map((i) => [i.document.kind, i.outcome]),
        [
          ['Group', { status: 'ok', result: 'Created' }],
          ['Application', { status: 'ok', result: 'Created' }],
          ['ApplicationInstance', { status: 'ok', result: 'Created' }],
        ],
      );
      await api.sync.refresh();
      assert.deepStrictEqual(
        files.map((f) => api.sync.entryAt(f)?.status),
        ['synced', 'synced', 'synced'],
      );
    } finally {
      for (const path of [
        `/public/self-serve/v1/application-instance/${id}-dev`,
        `/public/self-serve/v1/application/${id}-app`,
        `/public/iam/v2/group/${id}-team`,
      ]) {
        await state.client.delete(path).catch(() => undefined);
      }
      for (const file of files) await Promise.resolve(vscode.workspace.fs.delete(file)).catch(() => undefined);
    }
  });

  test('syncs a cluster with its secrets as environment variables and no drift', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const uri = await api.sync.syncResource(state.spec.catalog.latest('KafkaCluster')!, [], 'local-gateway');
    try {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
      const variable = 'CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_KAFKAFLAVOR_PASSWORD';
      assert.strictEqual(parse(text).spec.kafkaFlavor.password, `\${${variable}}`);
      assert.ok((await api.sync.requiredVariables()).some((v) => v.name === variable));
      await api.sync.refresh({ drift: true });
      assert.deepStrictEqual(
        { status: api.sync.entryAt(uri)?.status, drifted: api.sync.entryAt(uri)?.drifted },
        { status: 'synced', drifted: false },
      );
    } finally {
      await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
    }
  });

  test('keeps local copies under the chosen root, one folder per connection', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const elsewhere = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-root-')));
    await api.sync.setSyncRoot(elsewhere);
    try {
      assert.ok(api.sync.isRootChosen());
      const uri = await api.sync.syncResource(state.spec.catalog.latest('KafkaCluster')!, [], 'local-gateway');
      assert.strictEqual(
        uri.fsPath,
        join(elsewhere.fsPath, state.connection.name, 'global', 'console', 'KafkaCluster', 'local-gateway.yaml'),
      );
      assert.strictEqual(api.sync.entryAt(uri)?.status, 'synced');
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });
});
