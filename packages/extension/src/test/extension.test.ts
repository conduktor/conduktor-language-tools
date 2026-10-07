import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse, stringify } from 'yaml';
import { itemPath, parentsOf, syncPath, upsertTarget, type Resource } from '@conduktor/vscode-core';
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

// A repository the size of a big Console's, without a Console that big: topic files written straight into the folder.
async function seedTopics(api: ExtensionApi, cluster: string, count: number): Promise<void> {
  const state = api.sessions.current();
  if (state.status !== 'ready') assert.fail(state.status);
  const kind = state.spec.catalog.latest('Topic')!;
  const root = api.sync.root()!.fsPath;
  for (let i = 0; i < count; i++) {
    const name = `seeded-${String(i).padStart(5, '0')}`;
    const file = join(root, syncPath(kind, [cluster], name));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(
      file,
      stringify({
        apiVersion: 'v2',
        kind: 'Topic',
        metadata: { name, cluster },
        spec: { partitions: 1, replicationFactor: 1 },
      }),
    );
  }
  await api.sync.refresh();
}

async function until(condition: () => boolean, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

// The CLI expands ${CDK_SECRET_…} from its environment; the values are what the Console holds, read back for the run.
async function secretValues(api: ExtensionApi): Promise<Record<string, string>> {
  const state = api.sessions.current();
  if (state.status !== 'ready') return {};
  const values: Record<string, string> = {};
  const visit = (local: unknown, live: unknown) => {
    if (typeof local === 'string' && typeof live === 'string' && local.includes('${CDK_SECRET_')) {
      const names = [...local.matchAll(/\$\{(CDK_SECRET_[A-Z0-9_]+)\}/g)].map((m) => m[1]!);
      const pattern = new RegExp(
        `^${local.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\$\\\{CDK_SECRET_[A-Z0-9_]+\\\}/g, '(.*)')}$`,
      );
      const match = pattern.exec(live);
      names.forEach((name, i) => {
        if (match) values[name] = match[i + 1]!;
      });
    } else if (local && typeof local === 'object' && live && typeof live === 'object') {
      for (const key of Object.keys(local)) visit((local as never)[key], (live as never)[key]);
    }
  };
  for (const entry of api.sync.list()) {
    const text = readFileSync(entry.uri.fsPath, 'utf8');
    if (!text.includes('${CDK_SECRET_')) continue;
    const kind = state.spec.catalog.resolve(entry.apiVersion, entry.kind)!;
    visit(parse(text), await state.client.get(itemPath(kind, parentsOf(kind, entry.parents), entry.name)));
  }
  return values;
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
const SASL_CLUSTER = 'local-kafka-sasl';
const apiKey = process.env.CONDUKTOR_SMOKE_TOKEN;

(baseUrl && apiKey ? suite : suite.skip)('Conduktor extension against a live Console', () => {
  test('connects, browses, opens a topic and dry-runs it unchanged', async () => {
    const api = await activate();
    await api.connections.add({ id: 'smoke', name: 'smoke', url: baseUrl!, mode: 'prod' }, apiKey!);
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
    const titles = (
      (await vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', live.uri)) ?? []
    ).map((lens) => lens.command?.title ?? '');
    assert.ok(
      titles.some((title) => title.includes('Dry run')),
      titles.join(', '),
    );
    assert.ok(!titles.some((title) => title.includes('Apply')), `prod never offers Apply: ${titles.join(', ')}`);
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
    assert.strictEqual(state.connection.mode, 'prod');
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
      'environments',
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
    await api.connections.add({ id: 'smoke-apply', name: 'smoke-apply', url: baseUrl!, mode: 'dev' }, apiKey!);
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
      const diff = vscode.window.tabGroups.activeTabGroup.activeTab;
      assert.ok(diff?.input instanceof vscode.TabInputTextDiff);
      const sides = [diff.input.original, diff.input.modified];
      assert.match(api.compare.provideTextDocumentContent(sides[0]!), /kind: Topic/);
      await vscode.window.tabGroups.close(diff);
      await until(() => sides.every((side) => api.compare.provideTextDocumentContent(side) === ''));

      await vscode.commands.executeCommand('conduktor.deleteResource', node);
      assert.ok(!(await exists()), 'topic deleted');
    } finally {
      if (await exists()) await state.client.delete(`/public/kafka/v2/cluster/${cluster}/topic/${name}`);
    }
  });

  test('copies a Claude Code config whose server outlives an extension update', async () => {
    await activate();
    const extension = vscode.extensions.getExtension(EXTENSION_ID)!;
    const clipboard = await vscode.env.clipboard.readText();
    try {
      await vscode.commands.executeCommand('conduktor.copyClaudeCodeConfig');
      const [server] = JSON.parse(await vscode.env.clipboard.readText()).mcpServers.conduktor.args as string[];
      assert.ok(server && !server.startsWith(vscode.Uri.joinPath(extension.extensionUri, 'dist').fsPath), server);
      assert.ok(server.endsWith(join('mcp', 'mcp-server.js')), server);
      await vscode.workspace.fs.stat(vscode.Uri.file(server));
      await vscode.workspace.fs.stat(vscode.Uri.file(join(dirname(server), 'public-api-doc.yaml')));
    } finally {
      await vscode.env.clipboard.writeText(clipboard);
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

    for (const path of ['../outside.yaml', '/etc/hosts'])
      assert.match(await call('conduktor_validate', { path }), /outside the workspace|is absolute/, path);
  });

  test('applies a group, an application and its instance from one file, in order', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    await until(() => {
      const current = api.sessions.current();
      return current.status === 'ready' && current.connection.mode === 'dev';
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
      uri.path.endsWith(
        `/conduktor/environments/${state.connection.name}/clusters/local-kafka/kafka/Topic/${name}.yaml`,
      ),
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
      { status: api.sync.entryAt(uri)?.status, drift: api.sync.entryAt(uri)?.drift },
      { status: 'synced', drift: undefined },
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
        { status: api.sync.entryAt(uri)?.status, drift: api.sync.entryAt(uri)?.drift },
        { status: 'synced', drift: undefined },
      );
    } finally {
      await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
    }
  });

  test('never overwrites a file edited since the folder was last scanned', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-overwrite-'))));
    const kind = state.spec.catalog.latest('KafkaCluster')!;
    try {
      const uri = await api.sync.syncResource(kind, [], 'local-gateway');
      const edited = `${readFileSync(uri.fsPath, 'utf8')}# kept\n`;
      // Before the watcher's rescan: the cached status still says synced.
      writeFileSync(uri.fsPath, edited);
      await assert.rejects(api.sync.syncResource(kind, [], 'local-gateway'), /not a synced copy/);
      assert.strictEqual(readFileSync(uri.fsPath, 'utf8'), edited);
      await assert.rejects(
        api.sync.stageEdit(kind, [], 'local-gateway', edited.replace('# kept', '# staged')),
        /local changes/,
      );
      assert.strictEqual(readFileSync(uri.fsPath, 'utf8'), edited);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('never stages a live save over local changes, an unknown file or another connection', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const topicKind = state.spec.catalog.latest('Topic')!;
    const [existing] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
    const name = existing!.metadata.name;
    const node: ResourceNode = { type: 'resource', kind: topicKind, parents: ['local-kafka'], name };
    const read = async (uri: vscode.Uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const replaceAll = async (document: vscode.TextDocument, text: string) => {
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
      assert.ok(await vscode.workspace.applyEdit(edit));
    };

    const local = await api.sync.syncResource(topicKind, ['local-kafka'], name);
    const live = await vscode.workspace.openTextDocument(api.liveUri(node));
    try {
      const mine = parse(await read(local));
      mine.metadata.labels = { ...(mine.metadata.labels ?? {}), local: 'edit' };
      await vscode.workspace.fs.writeFile(local, new TextEncoder().encode(stringify(mine)));
      await api.sync.refresh();
      const fromLive = parse(live.getText());
      fromLive.metadata.labels = { ...(fromLive.metadata.labels ?? {}), live: 'edit' };
      await replaceAll(live, stringify(fromLive));
      assert.strictEqual(await live.save(), false, 'the live save is refused');
      assert.strictEqual(parse(await read(local)).metadata.labels.local, 'edit', 'the local edit survives');
    } finally {
      await vscode.commands.executeCommand('workbench.action.files.revert', live.uri);
      await api.sync.discard(local).catch(() => undefined);
    }

    await vscode.workspace.fs.writeFile(local, new TextEncoder().encode('kind: [\n'));
    await api.sync.refresh();
    try {
      await assert.rejects(api.sync.syncResource(topicKind, ['local-kafka'], name), /not a synced copy/);
      assert.strictEqual(await read(local), 'kind: [\n');
    } finally {
      await vscode.workspace.fs.delete(local);
      await api.sync.syncResource(topicKind, ['local-kafka'], name);
    }

    const other = vscode.Uri.from({ ...api.liveUri(node), authority: 'another-connection' });
    await assert.rejects(
      Promise.resolve(vscode.workspace.fs.writeFile(other, new TextEncoder().encode(live.getText()))),
    );
    assert.strictEqual(api.sync.entryAt(local)?.status, 'synced');
  });

  test('stages a renamed live resource as a new file, leaving the original alone', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const topicKind = state.spec.catalog.latest('Topic')!;
    const [existing] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
    const name = existing!.metadata.name;
    const local = await api.sync.syncResource(topicKind, ['local-kafka'], name);
    const live = await vscode.workspace.openTextDocument(
      api.liveUri({ type: 'resource', kind: topicKind, parents: ['local-kafka'], name }),
    );
    const renamed = `vscode-copy-${Date.now()}`;
    const edited = parse(live.getText());
    edited.metadata.name = renamed;
    const edit = new vscode.WorkspaceEdit();
    edit.replace(live.uri, new vscode.Range(0, 0, live.lineCount, 0), stringify(edited));
    assert.ok(await vscode.workspace.applyEdit(edit));
    assert.ok(await live.save());
    await api.sync.refresh();
    const copy = api.sync.entryFor('Topic', ['local-kafka'], renamed);
    try {
      assert.strictEqual(copy?.status, 'new');
      assert.ok(copy.path.endsWith(`clusters/local-kafka/kafka/Topic/${renamed}.yaml`), copy.path);
      assert.strictEqual(api.sync.entryAt(local)?.status, 'synced', 'the original is still its own synced copy');
      assert.strictEqual(api.sync.entryAt(local)?.name, name);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      if (copy) await Promise.resolve(vscode.workspace.fs.delete(copy.uri)).catch(() => undefined);
    }
  });

  test('leaves files it did not write where they are, and never stages the same resource twice', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const root = api.sync.root()!;
    const id = `vscode-foreign-${Date.now()}`;
    const topic = (name: string, cluster?: string) =>
      stringify({ apiVersion: 'v2', kind: 'Topic', metadata: { name, ...(cluster && { cluster }) }, spec: {} });
    const foreign = vscode.Uri.joinPath(root, 'prod', 'topics', `${id}.yaml`);
    const unscoped = vscode.Uri.joinPath(root, 'clusters', 'local-kafka', 'kafka', 'Topic', `${id}-x.yaml`);
    await vscode.workspace.fs.writeFile(foreign, new TextEncoder().encode(topic(id, 'local-kafka')));
    await vscode.workspace.fs.writeFile(unscoped, new TextEncoder().encode(topic(`${id}-x`)));
    const topicKind = state.spec.catalog.latest('Topic')!;
    const drafted: vscode.Uri[] = [];
    try {
      await api.sync.refresh();
      assert.strictEqual(api.sync.entryFor('Topic', ['local-kafka'], id)?.uri.toString(), foreign.toString());
      assert.strictEqual(api.sync.entryAt(unscoped)?.uri.toString(), unscoped.toString());

      for (let i = 0; i < 2; i++) {
        const document = await api.newResource({ type: 'parent', kind: topicKind, parents: ['local-kafka'] });
        assert.ok(document);
        drafted.push(document.uri);
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      }
      const names = drafted.map((uri) => api.sync.entryAt(uri)?.name);
      assert.strictEqual(new Set(names).size, 2, `two drafts get two names: ${names.join(', ')}`);
      await assert.rejects(
        api.sync.writeNew(topicKind, ['local-kafka'], topic(id, 'local-kafka'), id),
        /already has a local file/,
      );
    } finally {
      for (const uri of [foreign, unscoped, ...drafted])
        await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
      await Promise.resolve(vscode.workspace.fs.delete(vscode.Uri.joinPath(root, 'prod'), { recursive: true })).catch(
        () => undefined,
      );
    }
  });

  test('keeps what was applied as the base, never text typed meanwhile or a file applied in part', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    assert.strictEqual(state.connection.mode, 'dev');
    await useWorkspaceSyncRoot(api);
    const root = api.sync.root()!;
    const id = `vscode-base-${Date.now()}`;
    const names = [id, `${id}-a`, `${id}-b`];
    const topic = (name: string, labels?: Record<string, string>) =>
      stringify({
        apiVersion: 'v2',
        kind: 'Topic',
        metadata: { name, cluster: 'local-kafka', ...(labels && { labels }) },
        spec: { partitions: 1, replicationFactor: 1 },
      });
    const folder = vscode.Uri.joinPath(root, 'clusters/local-kafka/kafka/Topic');
    const single = vscode.Uri.joinPath(folder, `${id}.yaml`);
    const pair = vscode.Uri.joinPath(folder, `${id}-pair.yaml`);
    const baseOf = (uri: vscode.Uri) =>
      vscode.Uri.joinPath(
        api.sync.syncRoot()!,
        '.conduktor/base',
        api.sync.environment()!,
        uri.path.slice(root.path.length + 1),
      );
    const read = async (uri: vscode.Uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    try {
      await api.sync.writeNew(state.spec.catalog.latest('Topic')!, ['local-kafka'], topic(id), id);
      const document = await vscode.workspace.openTextDocument(single);
      api.setConfirm(async (_message, _detail, ...actions) => {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(single, new vscode.Range(0, 0, document.lineCount, 0), topic(id, { typed: 'meanwhile' }));
        await vscode.workspace.applyEdit(edit);
        return actions[0];
      });
      assert.deepStrictEqual(
        (await api.apply(single))?.map((i) => i.outcome),
        [{ status: 'ok', result: 'Created' }],
      );
      await until(() => api.sync.entryAt(single)?.status === 'synced', 10_000);
      assert.strictEqual(await read(baseOf(single)), topic(id));
      await vscode.commands.executeCommand('workbench.action.files.revert', single);

      api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
      await vscode.workspace.fs.writeFile(
        pair,
        new TextEncoder().encode(`${topic(names[1]!)}---\n${topic(names[2]!)}`),
      );
      assert.deepStrictEqual(
        (await api.apply(pair, 1))?.map((i) => i.outcome),
        [{ status: 'ok', result: 'Created' }],
      );
      await new Promise((resolve) => setTimeout(resolve, 500));
      await assert.rejects(Promise.resolve(vscode.workspace.fs.stat(baseOf(pair))), 'no base after one of two');
      await api.apply(pair);
      const expected = await read(pair);
      let base: string | undefined;
      for (let tries = 0; base !== expected && tries < 100; tries++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        base = await read(baseOf(pair)).catch(() => undefined);
      }
      assert.strictEqual(base, expected, 'the base is written once the whole file is applied');
    } finally {
      for (const name of names)
        await state.client.delete(`/public/kafka/v2/cluster/local-kafka/topic/${name}`).catch(() => undefined);
      for (const uri of [single, pair, baseOf(single), baseOf(pair)])
        await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
    }
  });

  test("reads each file's includes next to it when the sync folder is outside the workspace", async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    assert.strictEqual(state.connection.mode, 'dev');
    await api.clusters.set('local-kafka');
    const elsewhere = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-includes-')));
    await api.sync.setSyncRoot(elsewhere);
    const name = `vscode-include-${Date.now()}`;
    try {
      const uri = await api.sync.writeNew(
        state.spec.catalog.latest('Topic')!,
        ['local-kafka'],
        stringify({
          apiVersion: 'v2',
          kind: 'Topic',
          metadata: { name, cluster: 'local-kafka', labels: { 'conduktor.io/descriptionFile': 'description.md' } },
          spec: { partitions: 1, replicationFactor: 1 },
        }),
        name,
      );
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(uri, '..', 'description.md'),
        new TextEncoder().encode('Read from the file next to it'),
      );
      const preview = await api.applyAllChanges();
      const outcome = preview?.find((item) => item.document.resource?.metadata.name === name)?.outcome;
      // The description is read from the file next to it, and sent where the Console keeps it.
      assert.strictEqual(outcome?.status, 'ok', JSON.stringify(outcome));
      const live = await state.client.get(`/public/kafka/v2/cluster/local-kafka/topic/${name}`);
      assert.strictEqual(live.metadata.description, 'Read from the file next to it');
      await api.sync.refresh({ drift: true });
      assert.strictEqual(api.sync.entryAt(uri)?.drift, undefined, 'an applied description is not drift');
    } finally {
      await state.client.delete(`/public/kafka/v2/cluster/local-kafka/topic/${name}`).catch(() => undefined);
      await useWorkspaceSyncRoot(api);
      await Promise.resolve(vscode.workspace.fs.delete(elsewhere, { recursive: true })).catch(() => undefined);
    }
  });

  test('counts an included file in status, and discards it back', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    assert.strictEqual(state.connection.mode, 'dev');
    await api.clusters.set('local-kafka');
    const elsewhere = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-included-')));
    await api.sync.setSyncRoot(elsewhere);
    const name = `vscode-included-${Date.now()}-value`;
    const schema = (field: string) =>
      JSON.stringify({ type: 'record', name: 'R', fields: [{ name: field, type: 'string' }] });
    try {
      const uri = await api.sync.writeNew(
        state.spec.catalog.latest('Subject')!,
        ['local-kafka'],
        stringify({
          apiVersion: 'v2',
          kind: 'Subject',
          metadata: { name, cluster: 'local-kafka' },
          spec: { format: 'AVRO', schemaFile: 'schema.avsc' },
        }),
        name,
      );
      const file = join(uri.fsPath, '..', 'schema.avsc');
      writeFileSync(file, schema('applied'));
      const applied = await api.applyAllChanges();
      await api.sync.refresh();
      assert.strictEqual(api.sync.entryAt(uri)?.status, 'synced', JSON.stringify(applied?.map((i) => i.outcome)));
      await api.sync.refresh({ drift: true });
      assert.strictEqual(api.sync.entryAt(uri)?.drift, undefined, 'what the Console fills in itself is not drift');

      writeFileSync(file, schema('edited'));
      await api.sync.refresh();
      assert.strictEqual(api.sync.entryAt(uri)?.status, 'modified', 'an edited include is a change');

      await api.sync.discard(uri);
      assert.strictEqual(readFileSync(file, 'utf8'), schema('applied'));
      await api.sync.refresh();
      assert.strictEqual(api.sync.entryAt(uri)?.status, 'synced');

      await api.sync.syncResource(state.spec.catalog.latest('Subject')!, ['local-kafka'], name);
      assert.strictEqual(parse(readFileSync(uri.fsPath, 'utf8')).spec.schemaFile, 'schema.avsc', 'the layout stays');
      assert.strictEqual(JSON.parse(readFileSync(file, 'utf8')).fields[0].name, 'applied');
    } finally {
      await state.client.delete(`/public/kafka/v2/cluster/local-kafka/subject/${name}`).catch(() => undefined);
      await useWorkspaceSyncRoot(api);
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
      const file = join('global', 'console', 'KafkaCluster', 'local-gateway.yaml');
      assert.strictEqual(uri.fsPath, join(elsewhere.fsPath, 'environments', state.connection.name, file));
      assert.strictEqual(api.sync.entryAt(uri)?.status, 'synced');
      await vscode.workspace.fs.stat(
        vscode.Uri.file(join(elsewhere.fsPath, '.conduktor', 'base', state.connection.name, file)),
      );
      assert.ok(!existsSync(join(elsewhere.fsPath, 'environments', state.connection.name, '.conduktor')));
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('syncs everything a connection holds into its environment', async function () {
    // Three full bootstraps; the packaged Console takes a minute to refuse the Gateway's service-account list.
    this.timeout(600_000);
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const repo = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-repo-')));
    await api.sync.setSyncRoot(repo);
    const text = async (uri: vscode.Uri) => new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const kindOf = (name: string) => state.spec.catalog.latest(name)!;
    const apply = (resource: Resource) =>
      state.client.upsert(upsertTarget(kindOf(resource.kind), resource), resource, { dryRun: false });
    // Service accounts need a broker with an authorizer: the local Console stack runs one as local-kafka-sasl. The
    // packaged Console registers it from its config; a Console run from source needs it registered here.
    const registered = await state.client
      .get(`/public/console/v2/kafka-cluster/${SASL_CLUSTER}`)
      .catch(() => undefined);
    if (!registered)
      await apply({
        apiVersion: 'v2',
        kind: 'KafkaCluster',
        metadata: { name: SASL_CLUSTER },
        spec: {
          displayName: SASL_CLUSTER,
          bootstrapServers: 'localhost:19093',
          properties: {
            'security.protocol': 'SASL_PLAINTEXT',
            'sasl.mechanism': 'PLAIN',
            'sasl.jaas.config':
              'org.apache.kafka.common.security.plain.PlainLoginModule required username="admin" password="admin-secret";',
          },
        },
      });
    const account = `vscode-iac-${Date.now()}`;
    await apply({
      apiVersion: 'v1',
      kind: 'ServiceAccount',
      metadata: { name: account, cluster: SASL_CLUSTER },
      spec: {
        authorization: {
          type: 'KAFKA_ACL',
          acls: [
            {
              type: 'TOPIC',
              name: 'vscode.',
              patternType: 'PREFIXED',
              operations: ['Read', 'Write'],
              host: '*',
              permission: 'Allow',
            },
            {
              type: 'TRANSACTIONAL_ID',
              name: 'vscode.',
              patternType: 'PREFIXED',
              operations: ['Write', 'Describe'],
              host: '*',
              permission: 'Allow',
            },
          ],
        },
      },
    });
    try {
      const kinds = await api.sync.managedKinds();
      assert.ok(!kinds.includes('User') && kinds.includes('Topic'), kinds.join(', '));
      const stages: { stage: string; done?: number; total?: number; at: number }[] = [];
      const result = await api.sync.syncEverything(kinds, {
        onProgress: (stage) => stages.push({ ...stage, at: Date.now() }),
      });
      assert.strictEqual(result.cancelled, false);
      assert.ok((result.written.Topic ?? 0) > 0, JSON.stringify(result));
      // Every stage reports, in order, and writing counts each file up to the last: no long silent stretch.
      const order = [...new Set(stages.map((s) => s.stage))];
      assert.deepStrictEqual(order, ['finding', 'listing', 'writing', 'indexing', 'envExample']);
      const writing = stages.filter((s) => s.stage === 'writing');
      assert.strictEqual(writing.at(-1)!.done, writing.at(-1)!.total);
      assert.strictEqual(
        writing.at(-1)!.total,
        Object.values(result.written).reduce((sum, n) => sum + n, 0),
      );
      const first = (stage: string) => stages.find((s) => s.stage === stage)!.at;
      console.log(
        `Sync Everything stages (ms): listing ${first('writing') - first('finding')}, writing ${
          first('indexing') - first('writing')
        }, indexing ${first('envExample') - first('indexing')}, total ${Date.now() - first('finding')}`,
      );
      const clusters = await state.client.list('/public/console/v2/kafka-cluster');
      for (const cluster of clusters)
        assert.ok(api.sync.entryFor('KafkaCluster', [], cluster.metadata.name), cluster.metadata.name);
      assert.ok(api.sync.entryFor('ServiceAccount', [SASL_CLUSTER], account), 'the service account and its ACLs');
      const config = await text(vscode.Uri.joinPath(repo, 'conduktor.yaml'));
      assert.ok(config.includes(`console: ${state.client.baseUrl}`), config);
      const example = await text(vscode.Uri.joinPath(api.sync.root()!, '.env.example'));
      assert.match(example, /^CDK_SECRET_KAFKACLUSTER_LOCAL_GATEWAY_SPEC_KAFKAFLAVOR_PASSWORD=$/m);
      assert.match(await text(vscode.Uri.joinPath(repo, '.gitignore')), /^\.env$/m);

      const total = Object.values(result.written).reduce((sum, n) => sum + n, 0);
      const env = api.sync.root()!;
      const files: string[] = [];
      const walk = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const path = join(dir, entry.name);
          if (entry.isDirectory()) walk(path);
          else files.push(path);
        }
      };
      walk(env.fsPath);
      for (const file of files) {
        if (file.endsWith('.env.example')) continue;
        assert.ok(api.sync.entryAt(vscode.Uri.file(file)), `only resources under the environment: ${file}`);
      }

      const again = await api.sync.syncEverything(kinds);
      assert.deepStrictEqual(again.written, {}, 'a second run writes nothing');
      assert.strictEqual(again.unchanged, total);

      const topic = api.sync.list().find((e) => e.kind === 'Topic')!;
      const edited = parse(readFileSync(topic.uri.fsPath, 'utf8'));
      edited.metadata.labels = { ...(edited.metadata.labels ?? {}), local: 'edit' };
      writeFileSync(topic.uri.fsPath, stringify(edited));
      await api.sync.refresh();
      const third = await api.sync.syncEverything(kinds);
      // Nothing new on the Console, so the local edit is just a local change: kept, and not a conflict.
      assert.deepStrictEqual(third.conflicts, []);
      assert.strictEqual(third.unchanged, total);
      assert.strictEqual(parse(readFileSync(topic.uri.fsPath, 'utf8')).metadata.labels.local, 'edit');
      await api.sync.discard(topic.uri);

      // The Gateway's cluster is a simulator: it holds ACLs Kafka (and so Console) would refuse, such as
      // IdempotentWrite on a transactional id. The CLI check covers global resources and the real brokers.
      if (spawnSync('conduktor', ['version']).error) return;
      const scopes = ['global', 'clusters/local-kafka', `clusters/${SASL_CLUSTER}`];
      const run = spawnSync(
        'conduktor',
        [
          'apply',
          ...scopes.flatMap((scope) => ['-f', join(env.fsPath, scope)]),
          '-r',
          '--dry-run',
          '--parallelism',
          '8',
        ],
        {
          encoding: 'utf8',
          maxBuffer: 64 * 1024 * 1024,
          env: { ...process.env, CDK_BASE_URL: baseUrl, CDK_API_KEY: apiKey, ...(await secretValues(api)) },
        },
      );
      assert.strictEqual(run.status, 0, run.stderr);
      const results = run.stdout.split('\n').filter((line) => /^\w+\/.+: \w+$/.test(line));
      const expected = api.sync.list().filter((e) => scopes.some((scope) => e.path.startsWith(`${scope}/`))).length;
      assert.strictEqual(results.length, expected, run.stdout.slice(0, 2000));
      assert.deepStrictEqual(
        results.filter((line) => !line.endsWith(': NotChanged')),
        [],
        'the CLI finds every bootstrapped resource unchanged',
      );
    } finally {
      await useWorkspaceSyncRoot(api);
      await state.client
        .delete(itemPath(kindOf('ServiceAccount'), { cluster: SASL_CLUSTER }, account))
        .catch(() => undefined);
    }
  });

  test('syncs everything in one cluster, plus global, and remembers that it did', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const repo = mkdtempSync(join(tmpdir(), 'conduktor-one-cluster-'));
    await api.sync.setSyncRoot(vscode.Uri.file(repo));
    const kinds = ['Group', 'KafkaCluster', 'Topic'];
    const of = (kind: string) => api.sync.list().filter((e) => e.kind === kind);
    try {
      await api.sync.syncEverything(kinds, { clusters: ['local-kafka'] });
      assert.ok(of('Topic').length > 0);
      assert.deepStrictEqual([...new Set(of('Topic').map((e) => e.parents[0]))], ['local-kafka']);
      assert.deepStrictEqual(
        of('KafkaCluster').map((e) => e.name),
        ['local-kafka'],
      );
      assert.ok(of('Group').length > 0, 'global resources come along');
      assert.deepStrictEqual(await api.sync.managedClusters(), ['local-kafka']);
      assert.match(readFileSync(join(repo, 'conduktor.yaml'), 'utf8'), /clusters: \[ local-kafka \]/);

      await api.sync.syncEverything(kinds);
      assert.strictEqual(await api.sync.managedClusters(), undefined, 'every cluster again');
      assert.ok(of('Topic').some((e) => e.parents[0] === 'local-gateway'));
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('reads connections stored with the old modes as dev or prod, and writes them back', async () => {
    const api = await activate();
    const settings = vscode.workspace.getConfiguration('conduktor');
    const before = settings.inspect<unknown[]>('connections')?.globalValue;
    const legacy = ['apply', 'dry-run', 'read-only', 'something'].map((mode) => ({
      id: `legacy-${mode}`,
      name: `legacy-${mode}`,
      url: 'http://localhost:1',
      mode,
    }));
    try {
      await settings.update(
        'connections',
        [...((before as object[]) ?? []), ...legacy],
        vscode.ConfigurationTarget.Global,
      );
      const modes = () =>
        Object.fromEntries(
          api.connections
            .all()
            .filter((c) => c.id.startsWith('legacy-'))
            .map((c) => [c.id, c.mode]),
        );
      assert.deepStrictEqual(modes(), {
        'legacy-apply': 'dev',
        'legacy-dry-run': 'prod',
        'legacy-read-only': 'prod',
        'legacy-something': 'prod',
      });
      await api.connections.migrate();
      const stored = vscode.workspace
        .getConfiguration('conduktor')
        .get<{ id: string; mode: string }[]>('connections', [])
        .filter((c) => c.id.startsWith('legacy-'));
      assert.deepStrictEqual(
        stored.map((c) => c.mode),
        ['dev', 'prod', 'prod', 'prod'],
      );
    } finally {
      await settings.update('connections', before, vscode.ConfigurationTarget.Global);
      // Changing the connections reloads the session; the tests after this one expect it ready.
      await until(() => api.sessions.current().status === 'ready');
    }
  });

  test('fills ${VAR} from the nearest .env, up to the repository root', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const outer = mkdtempSync(join(tmpdir(), 'conduktor-dotenv-'));
    writeFileSync(join(outer, '.env'), 'TEAM=from-above-the-repository\n');
    const repo = join(outer, 'repo');
    mkdirSync(join(repo, '.git'), { recursive: true });
    mkdirSync(join(repo, 'topics'));
    const file = vscode.Uri.file(join(repo, 'topics', 't.yaml'));
    writeFileSync(
      file.fsPath,
      stringify({
        apiVersion: 'v2',
        kind: 'Topic',
        metadata: { name: `vscode-dotenv-${Date.now()}`, cluster: 'local-kafka', labels: { team: '${TEAM}' } },
        spec: { partitions: 1, replicationFactor: 1 },
      }),
    );
    const [missing] = (await api.dryRun(file)) ?? [];
    assert.ok(
      missing?.outcome.status === 'error' && /TEAM/.test(missing.outcome.message),
      `a .env above the repository is not read: ${JSON.stringify(missing?.outcome)}`,
    );
    writeFileSync(join(repo, '.env'), 'TEAM=data\r\n');
    const [found] = (await api.dryRun(file)) ?? [];
    assert.strictEqual(found?.outcome.status, 'ok', JSON.stringify(found?.outcome));
    assert.strictEqual((found.document.resource?.metadata.labels as Record<string, string> | undefined)?.team, 'data');
  });

  test('stops writing files when Sync Everything is cancelled, keeping what it wrote', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-cancel-'))));
    try {
      let written = 0;
      const result = await api.sync.syncEverything(['Topic'], {
        cancelled: () => written >= 20,
        onProgress: (stage) => {
          if (stage.stage === 'writing') written = stage.done;
        },
      });
      assert.strictEqual(result.cancelled, true);
      const total = result.written.Topic ?? 0;
      assert.ok(total >= 20 && total < 100, `stopped soon after the cancel: ${total} written`);
      assert.strictEqual(api.sync.list().filter((e) => e.kind === 'Topic').length, total, 'the written files show');
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test("binds environments only to safe folder names that are not another Console's", async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const parent = mkdtempSync(join(tmpdir(), 'conduktor-bind-'));
    const repo = vscode.Uri.file(join(parent, 'repo'));
    const configure = (text: string) => {
      mkdirSync(repo.fsPath, { recursive: true });
      writeFileSync(join(repo.fsPath, 'conduktor.yaml'), text);
    };
    try {
      configure(`environments:\n  "../escape": { console: ${state.client.baseUrl} }\n`);
      await api.sync.setSyncRoot(repo);
      assert.strictEqual(api.sync.environment(), undefined);
      await assert.rejects(api.sync.syncEverything(['Group']), /not a folder name/);
      assert.ok(!existsSync(join(parent, 'escape')), 'nothing is written outside the repository');

      configure(`environments:\n  ${state.connection.name}: { console: https://another.example }\n`);
      await api.sync.setSyncRoot(vscode.Uri.file(parent));
      await api.sync.setSyncRoot(repo);
      await assert.rejects(api.sync.syncEverything(['Group']), /belongs to https:\/\/another.example/);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('moves environments to a new root whole, with conduktor.yaml', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const env = state.connection.name;
    const file = 'global/iam/Group/team.yaml';
    const put = (root: string, path: string) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), 'apiVersion: v2\nkind: Group\nmetadata: { name: team }\nspec: {}\n');
    };
    const from = mkdtempSync(join(tmpdir(), 'conduktor-from-'));
    const blocked = mkdtempSync(join(tmpdir(), 'conduktor-blocked-'));
    const to = mkdtempSync(join(tmpdir(), 'conduktor-to-'));
    for (const path of [`environments/${env}/${file}`, `.conduktor/base/${env}/${file}`, 'conduktor.yaml'])
      put(from, path);
    put(blocked, `.conduktor/base/${env}/${file}`);
    const moved = (root: string) => existsSync(join(root, 'environments', env, file));

    assert.strictEqual(await api.sync.moveConnectionFolders(vscode.Uri.file(from), vscode.Uri.file(blocked), [env]), 0);
    assert.ok(moved(from) && !moved(blocked), 'an environment never moves without its base copies');

    assert.strictEqual(await api.sync.moveConnectionFolders(vscode.Uri.file(from), vscode.Uri.file(to), [env]), 1);
    assert.ok(
      moved(to) && existsSync(join(to, '.conduktor', 'base', env, file)) && existsSync(join(to, 'conduktor.yaml')),
    );
  });

  test('reports a file it could not write as skipped, with why, not as a local change', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const repo = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-readonly-')));
    await api.sync.setSyncRoot(repo);
    const folder = join(api.sync.root()!.fsPath, 'global', 'iam', 'Group');
    try {
      await api.sync.syncEverything(['Group']);
      const [first] = readdirSync(folder);
      rmSync(join(folder, first!));
      chmodSync(folder, 0o555);
      const result = await api.sync.syncEverything(['Group']);
      assert.deepStrictEqual(result.conflicts, []);
      assert.ok(
        result.skipped.some((s) => /EACCES|permission/i.test(s.reason)),
        JSON.stringify(result.skipped),
      );
    } finally {
      chmodSync(folder, 0o755);
      await useWorkspaceSyncRoot(api);
    }
  });

  test('stops writing when the connection changes during Sync Everything', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const repo = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-switch-')));
    await api.sync.setSyncRoot(repo);
    try {
      const running = api.sync.syncEverything(await api.sync.managedKinds());
      await new Promise((resolve) => setTimeout(resolve, 50));
      await api.sessions.reload();
      const result = await running;
      assert.strictEqual(result.cancelled, true);
      assert.deepStrictEqual(result.written, {});
    } finally {
      await until(() => api.sessions.current().status === 'ready');
      await useWorkspaceSyncRoot(api);
    }
  });

  test('looks names up in the repository and on the Console, and knows when the Console could not answer', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const [group] = await state.client.list('/public/iam/v2/group');
    const groups = await api.names.lookup('Group', []);
    assert.strictEqual(groups.checked, true);
    assert.ok(groups.names.some((n) => n.name === group!.metadata.name && n.sources.includes('console')));
    const draft = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: 'apiVersion: v2\nkind: Group\nmetadata: { name: vscode-draft-group }\nspec: { displayName: Draft }\n',
    });
    const withDraft = await api.names.lookup('Group', []);
    assert.ok(withDraft.names.some((n) => n.name === 'vscode-draft-group' && n.sources.includes('repo')));
    const nowhere = await api.names.lookup('Topic', ['vscode-no-such-cluster']);
    assert.strictEqual(nowhere.checked, false, 'a list the Console refused is not a check');
    await vscode.window.showTextDocument(draft);
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });

  test('flags references to nothing, pattern traps and overlapping ownership in Problems', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const [group] = await state.client.list('/public/iam/v2/group');
    const problems = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Conduktor');
    const app = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content:
        'apiVersion: v1\nkind: Application\nmetadata: { name: vscode-ref-app }\nspec: { title: T, owner: vscode-no-such-group }\n---\n' +
        `apiVersion: v1\nkind: Application\nmetadata: { name: vscode-ref-app-2 }\nspec: { title: T, owner: ${group!.metadata.name} }\n`,
    });
    await until(() => problems(app.uri).length > 0);
    assert.deepStrictEqual(
      problems(app.uri).map((d) => [d.message, d.severity]),
      [
        [
          `Group 'vscode-no-such-group' is not in the repository or on ${state.connection.name}.`,
          vscode.DiagnosticSeverity.Warning,
        ],
      ],
    );

    const id = `vscode-overlap-${Date.now()}`;
    const instance = (name: string, prefix: string) =>
      stringify({
        apiVersion: 'v1',
        kind: 'ApplicationInstance',
        metadata: { name, application: 'vscode-ref-app' },
        spec: {
          cluster: 'local-kafka',
          resources: [
            { type: 'TOPIC', name: prefix, patternType: 'PREFIXED' },
            { type: 'TOPIC', name: 'x*', patternType: 'LITERAL' },
          ],
        },
      });
    const kind = state.spec.catalog.latest('ApplicationInstance')!;
    const first = await api.sync.writeNew(kind, [], instance(`${id}-a`, `${id}.`), `${id}-a`);
    const second = await api.sync.writeNew(kind, [], instance(`${id}-b`, `${id}.orders`), `${id}-b`);
    try {
      const doc = await vscode.workspace.openTextDocument(second);
      await until(() => problems(doc.uri).some((d) => /^Overlaps/.test(d.message)));
      const messages = problems(doc.uri).map((d) => d.message);
      assert.ok(messages.includes(`Overlaps TOPIC ${id}. (PREFIXED) owned by ${id}-a.`), messages.join('\n'));
      assert.ok(
        messages.includes("Console rejects a name ending in *: use 'x' with patternType PREFIXED."),
        messages.join('\n'),
      );
    } finally {
      for (const uri of [first, second]) await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
    }
  });

  test('completes reference names and goes to their definition', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const [group] = await state.client.list('/public/iam/v2/group');
    const name = group!.metadata.name;
    const content =
      'apiVersion: v1\nkind: Application\nmetadata: { name: vscode-complete }\nspec:\n  title: T\n  owner: \n';
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
    const position = doc.positionAt(content.indexOf('owner: ') + 'owner: '.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position,
    );
    const item = list.items.find((i) => (typeof i.label === 'string' ? i.label : i.label.label) === name);
    assert.ok(item, 'the Console group is offered');
    assert.match(String(item.detail), /^Group · (repo \+ )?Console$/);

    const local = await api.sync.syncResource(state.spec.catalog.latest('Group')!, [], name);
    const withOwner = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: content.replace('owner: ', `owner: ${name}`),
    });
    const at = withOwner.positionAt(withOwner.getText().indexOf(`owner: ${name}`) + 'owner: '.length + 1);
    const locations = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      'vscode.executeDefinitionProvider',
      withOwner.uri,
      at,
    );
    const uris = locations.map((l) => ('targetUri' in l ? l.targetUri : l.uri).toString());
    assert.ok(uris.includes(local.toString()), uris.join(', '));
  });

  test('counts what a pattern matches in a CodeLens', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-lens-'))));
    api.names.clear();
    const topics = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
    const prefix = topics[0]!.metadata.name.slice(0, 2);
    const expected = topics.filter((t) => t.metadata.name.startsWith(prefix)).length;
    const doc = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: stringify({
        apiVersion: 'v1',
        kind: 'ApplicationInstance',
        metadata: { name: 'vscode-lens', application: 'x' },
        spec: { cluster: 'local-kafka', resources: [{ type: 'TOPIC', name: prefix, patternType: 'PREFIXED' }] },
      }),
    });
    let titles: string[] = [];
    await until(() => {
      void vscode.commands
        .executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri)
        .then((lenses) => (titles = lenses.map((l) => l.command?.title ?? '')));
      return titles.includes(`$(search) matches ${expected} Topic resources`);
    });
    await useWorkspaceSyncRoot(api);
  });

  test('looks names up without reading every file in a bootstrapped repository', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-names-'))));
    try {
      await api.sync.syncEverything(['Topic']);
      await seedTopics(api, 'local-gateway', 1500);
      const local = api.sync.list().filter((e) => e.kind === 'Topic' && e.parents[0] === 'local-gateway');
      assert.ok(local.length > 1000, `${local.length} gateway topics in the repository`);
      // A service account with 20 ACLs looks its topics up 20 times on every check.
      const started = Date.now();
      for (let i = 0; i < 20; i++) await api.names.lookup('Topic', ['local-gateway']);
      const elapsed = Date.now() - started;
      const { names } = await api.names.lookup('Topic', ['local-gateway']);
      assert.ok(names.filter((n) => n.sources.includes('repo')).length >= local.length);
      assert.ok(elapsed < 1000, `20 lookups took ${elapsed} ms`);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('re-checks references when what they name appears in another document', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const group = `vscode-later-${Date.now()}`;
    const problems = (uri: vscode.Uri) => vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Conduktor');
    const app = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: `apiVersion: v1\nkind: Application\nmetadata: { name: vscode-later }\nspec: { title: T, owner: ${group} }\n`,
    });
    await until(() => problems(app.uri).some((d) => d.message.includes(group)));
    await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: `apiVersion: v2\nkind: Group\nmetadata: { name: ${group} }\nspec: { displayName: Later }\n`,
    });
    await until(() => !problems(app.uri).some((d) => d.message.includes(group)));
  });

  test('sees a resource it has just applied, without a manual refresh', async () => {
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    assert.strictEqual(state.connection.mode, 'dev');
    const name = `vscode-applied-${Date.now()}`;
    await api.names.lookup('Group', []);
    const doc = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: `apiVersion: v2\nkind: Group\nmetadata: { name: ${name} }\nspec: { displayName: Applied }\n`,
    });
    try {
      await api.apply(doc.uri);
      await vscode.window.showTextDocument(doc);
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
      const { names } = await api.names.lookup('Group', []);
      assert.ok(
        names.some((n) => n.name === name && n.sources.includes('console')),
        'the applied group is on the Console',
      );
    } finally {
      await state.client.delete(`/public/iam/v2/group/${name}`).catch(() => undefined);
    }
  });

  test('completes inside a quoted value', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const [group] = await state.client.list('/public/iam/v2/group');
    const name = group!.metadata.name;
    const content =
      'apiVersion: v1\nkind: Application\nmetadata: { name: vscode-quoted }\nspec:\n  title: T\n  owner: ""\n';
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
    const position = doc.positionAt(content.indexOf('owner: "') + 'owner: "'.length);
    const list = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      doc.uri,
      position,
    );
    const item = list.items.find(
      (i) => i.detail?.startsWith('Group') && (typeof i.label === 'string' ? i.label : i.label.label) === name,
    );
    assert.ok(item, 'the group is offered');
    assert.strictEqual(item.filterText, `"${name}`);
    assert.strictEqual(item.insertText, `"${name}"`);
  });

  test('keeps repository documents with where they are, and reads files once', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-docs-'))));
    try {
      await api.sync.syncEverything(['Topic']);
      await seedTopics(api, 'local-gateway', 1500);
      const first = Date.now();
      const documents = await api.names.repoDocuments('Topic');
      const cold = Date.now() - first;
      const again = Date.now();
      await api.names.repoDocuments('Topic');
      const warm = Date.now() - again;
      assert.ok(documents.length > 1000, String(documents.length));
      const [one] = documents;
      assert.strictEqual(one!.text.slice(0, 11), 'apiVersion:');
      assert.strictEqual(one!.fullText.slice(one!.start, one!.start + one!.text.length), one!.text);
      assert.ok(warm < Math.max(50, cold / 10), `cold ${cold} ms, warm ${warm} ms`);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('finds every repository document that refers to a resource', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-referrers-'))));
    const id = `vscode-refs-${Date.now()}`;
    const kind = (name: string) => state.spec.catalog.latest(name)!;
    const write = (kindName: string, parents: string[], resource: object, name: string) =>
      api.sync.writeNew(kind(kindName), parents, stringify(resource), name);
    try {
      const group = await write(
        'Group',
        [],
        { apiVersion: 'v2', kind: 'Group', metadata: { name: id }, spec: { displayName: 'G' } },
        id,
      );
      const app = await write(
        'Application',
        [],
        { apiVersion: 'v1', kind: 'Application', metadata: { name: `${id}-app` }, spec: { title: 'A', owner: id } },
        `${id}-app`,
      );
      const topic = await write(
        'Topic',
        ['local-kafka'],
        {
          apiVersion: 'v2',
          kind: 'Topic',
          metadata: { name: `${id}.orders`, cluster: 'local-kafka' },
          spec: { partitions: 1, replicationFactor: 1 },
        },
        `${id}.orders`,
      );
      const instance = await write(
        'ApplicationInstance',
        [],
        {
          apiVersion: 'v1',
          kind: 'ApplicationInstance',
          metadata: { name: `${id}-dev`, application: `${id}-app` },
          spec: { cluster: 'local-kafka', resources: [{ type: 'TOPIC', name: `${id}.`, patternType: 'PREFIXED' }] },
        },
        `${id}-dev`,
      );
      const referrers = async (uri: vscode.Uri, name: string) => {
        const doc = await vscode.workspace.openTextDocument(uri);
        const position = doc.positionAt(doc.getText().indexOf(`name: ${name}`) + 'name: '.length + 1);
        const found = await vscode.commands.executeCommand<vscode.Location[]>(
          'vscode.executeReferenceProvider',
          doc.uri,
          position,
        );
        return found.map((l) => l.uri.toString());
      };
      assert.deepStrictEqual(await referrers(group, id), [app.toString()]);
      assert.deepStrictEqual(await referrers(topic, `${id}.orders`), [instance.toString()]);
      assert.deepStrictEqual(await referrers(instance, `${id}-dev`), []);

      // A hand-written file holding several resources, never opened, with a wildcard permission in its second document.
      const bundle = vscode.Uri.joinPath(api.sync.root()!, 'global', 'bundle.yaml');
      const bundleText = [
        stringify({
          apiVersion: 'v1',
          kind: 'Application',
          metadata: { name: `${id}-other` },
          spec: { title: 'O', owner: id },
        }),
        stringify({
          apiVersion: 'v2',
          kind: 'Group',
          metadata: { name: `${id}-readers` },
          spec: {
            permissions: [
              { resourceType: 'TOPIC', cluster: '*', name: '*', patternType: 'LITERAL', permissions: ['topicConsume'] },
            ],
          },
        }),
      ].join('---\n');
      await vscode.workspace.fs.writeFile(bundle, new TextEncoder().encode(bundleText));
      await api.sync.refresh();
      const groupDoc0 = await vscode.workspace.openTextDocument(group);
      const located = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeReferenceProvider',
        groupDoc0.uri,
        groupDoc0.positionAt(groupDoc0.getText().indexOf(`name: ${id}`) + 'name: '.length + 1),
      );
      const inBundle = located.find((l) => l.uri.toString() === bundle.toString());
      assert.ok(inBundle, 'a multi-document file is searched without being open');
      const ownerOffset = bundleText.indexOf(`owner: ${id}`) + 'owner: '.length;
      const ownerLine = bundleText.slice(0, ownerOffset).split('\n').length - 1;
      assert.deepStrictEqual(
        [inBundle.range.start.line, inBundle.range.start.character, inBundle.range.end.character],
        [ownerLine, 'owner: '.length + 2, 'owner: '.length + 2 + id.length],
      );
      assert.ok(
        (await referrers(topic, `${id}.orders`)).includes(bundle.toString()),
        'a * permission covers the topic',
      );

      const groupDoc = await vscode.workspace.openTextDocument(group);
      let titles: string[] = [];
      await until(() => {
        void vscode.commands
          .executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', groupDoc.uri)
          .then((lenses) => (titles = lenses.map((l) => l.command?.title ?? '')));
        return titles.includes('$(references) referenced by 2');
      });
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('counts referrers quickly for a cluster thousands of resources point at', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.sync.setSyncRoot(vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-lens-cost-'))));
    try {
      await api.sync.syncEverything(['KafkaCluster', 'Topic']);
      await seedTopics(api, 'local-gateway', 1500);
      const cluster = api.sync.entryFor('KafkaCluster', [], 'local-gateway')!;
      const doc = await vscode.workspace.openTextDocument(cluster.uri);
      const lens = () => vscode.commands.executeCommand<vscode.CodeLens[]>('vscode.executeCodeLensProvider', doc.uri);
      await lens();
      const started = Date.now();
      const lenses = await lens();
      const elapsed = Date.now() - started;
      const title = lenses.map((l) => l.command?.title ?? '').find((t) => t.includes('referenced by'));
      assert.match(String(title), /referenced by \d{4}/);
      assert.ok(elapsed < 300, `lenses took ${elapsed} ms`);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('builds a new resource for the variants it is asked for', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await useWorkspaceSyncRoot(api);
    const asked: string[] = [];
    api.setVariantPicker(async (choice) => {
      asked.push(choice.path.join('.'));
      return choice.path.join('.') === 'spec.kafkaFlavor' ? 'Gateway' : null;
    });
    const doc = await api.newResource({ type: 'kind', kind: state.spec.catalog.latest('KafkaCluster')!, parents: [] });
    assert.ok(doc);
    try {
      assert.ok(asked.includes('spec.kafkaFlavor'), asked.join(', '));
      const value = parse(doc.getText());
      assert.strictEqual(value.spec.kafkaFlavor.type, 'Gateway');
      assert.ok(!('schemaRegistry' in value.spec));
      value.metadata.name = `vscode-skeleton-${Date.now()}`;
      value.spec.displayName = 'D';
      value.spec.bootstrapServers = 'gateway-plain-1:9099';
      Object.assign(value.spec.kafkaFlavor, {
        url: 'http://gateway-plain-1:8888',
        user: 'admin',
        password: 'conduktor',
        virtualCluster: 'passthrough',
      });
      const filled = await vscode.workspace.openTextDocument({ language: 'yaml', content: stringify(value) });
      const [item] = (await api.dryRun(filled.uri)) ?? [];
      assert.deepStrictEqual(item?.outcome, { status: 'ok', result: 'Created' });

      const before = api.sync.list().length;
      let questions = 0;
      api.setVariantPicker(async (choice) => (questions++ === 0 ? choice.options[0]! : undefined));
      const dismissed = await api.newResource({
        type: 'kind',
        kind: state.spec.catalog.latest('KafkaCluster')!,
        parents: [],
      });
      assert.strictEqual(dismissed, undefined, 'dismissing the picker half-way writes nothing');
      assert.strictEqual(questions, 2);
      await api.sync.refresh();
      assert.strictEqual(api.sync.list().length, before);

      api.setVariantPicker(async () => null);
      const integration = state.spec.catalog.latest('Integration')!;
      const drafts = [
        await api.newResource({ type: 'kind', kind: integration, parents: [] }),
        await api.newResource({ type: 'kind', kind: integration, parents: [] }),
      ];
      try {
        const names = drafts.map((d) => parse(d!.getText()).metadata.name as string);
        assert.notStrictEqual(names[0], names[1], 'each draft takes an allowed name not yet used');
        drafts.forEach((d, i) => assert.ok(d!.uri.path.endsWith(`/${names[i]}.yaml`), d!.uri.path));
      } finally {
        for (const d of drafts) if (d) await Promise.resolve(vscode.workspace.fs.delete(d.uri)).catch(() => undefined);
      }
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await Promise.resolve(vscode.workspace.fs.delete(doc.uri)).catch(() => undefined);
    }
  });

  test('offers a snippet per kind where a document is empty', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    await api.clusters.set('local-kafka');
    const complete = async (content: string, offset = content.length) => {
      const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
      const list = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        doc.uri,
        doc.positionAt(offset),
      );
      return list.items.filter((i) =>
        String(typeof i.label === 'string' ? i.label : i.label.label).startsWith('Conduktor: '),
      );
    };
    const items = await complete('Top');
    const topic = items.find((i) => i.label === 'Conduktor: Topic');
    assert.ok(topic, items.map((i) => i.label).join(', '));
    const snippet = (topic.insertText as vscode.SnippetString).value;
    assert.match(snippet, /kind: Topic/);
    assert.match(snippet, /cluster: \$\{2\|local-kafka,/);
    assert.ok(items.some((i) => i.label === 'Conduktor: KafkaCluster (kafkaFlavor Gateway)'));
    const range = topic.range as vscode.Range;
    assert.deepStrictEqual([range.start.character, range.end.character], [0, 3], 'replaces the typed word');
    assert.ok((await complete('kind: Topic\nmetadata: { name: a }\n---\n')).length > 0, 'after a separator');
    assert.strictEqual((await complete('kind: Topic\nmetadata: { name: a }\n', 2)).length, 0, 'not inside a document');
    const kubernetes = 'apiVersion: apps/v1\nkind: Deployment\nmetadata: { name: web }\n---\n';
    assert.strictEqual((await complete(kubernetes)).length, 0, 'not in a file that holds other resources');
  });

  test('starts a new resource from a repository template', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-templates-')));
    await api.sync.setSyncRoot(root);
    const folder = vscode.Uri.joinPath(root, 'templates', 'Topic');
    const write = (name: string, text: string) =>
      vscode.workspace.fs.writeFile(vscode.Uri.joinPath(folder, name), new TextEncoder().encode(text));
    await write(
      'high-throughput.yaml',
      '# Our standard\napiVersion: v2\nkind: Topic\nmetadata:\n  name: high-throughput\nspec:\n  partitions: 24\n  replicationFactor: 3\n',
    );
    await write('broken.yaml', 'kind: [\n');
    const topic = state.spec.catalog.latest('Topic')!;
    try {
      let offered: string[] = [];
      api.setTemplatePicker(async (_kind, templates) => {
        offered = templates.map((t) => t.label);
        return templates.find((t) => t.label === 'high-throughput')!.uri;
      });
      const doc = await api.newResource({ type: 'parent', kind: topic, parents: ['local-kafka'] });
      assert.deepStrictEqual(offered.sort(), ['broken', 'high-throughput']);
      assert.ok(doc);
      assert.match(doc.getText(), /^# Our standard/);
      assert.deepStrictEqual(parse(doc.getText()).metadata, { name: 'high-throughput', cluster: 'local-kafka' });
      assert.ok(
        doc.uri.path.endsWith(
          `/environments/${state.connection.name}/clusters/local-kafka/kafka/Topic/high-throughput.yaml`,
        ),
        doc.uri.path,
      );
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      const again = await api.newResource({ type: 'parent', kind: topic, parents: ['local-kafka'] });
      assert.strictEqual(parse(again!.getText()).metadata.name, 'high-throughput-2', 'a free name from the template');
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      await api.sync.refresh();
      const before = api.sync.list().length;
      api.setTemplatePicker(async (_kind, templates) => templates.find((t) => t.label === 'broken')!.uri);
      assert.strictEqual(await api.newResource({ type: 'parent', kind: topic, parents: ['local-kafka'] }), undefined);
      api.setTemplatePicker(async () => undefined);
      assert.strictEqual(await api.newResource({ type: 'parent', kind: topic, parents: ['local-kafka'] }), undefined);
      await api.sync.refresh();
      assert.strictEqual(api.sync.list().length, before, 'a broken or dismissed template writes nothing');

      const integration = state.spec.catalog.latest('Integration')!;
      await vscode.workspace.fs.writeFile(
        vscode.Uri.joinPath(root, 'templates', 'Integration', 'slack.yaml'),
        new TextEncoder().encode('apiVersion: v3\nkind: Integration\nmetadata:\n  name: Slack\nspec: {}\n'),
      );
      api.setTemplatePicker(async (_kind, templates) => templates[0]!.uri);
      const slack = await api.newResource({ type: 'kind', kind: integration, parents: [] });
      assert.strictEqual(parse(slack!.getText()).metadata.name, 'Slack', 'a fixed-name template keeps its own name');
      assert.ok(slack!.uri.path.endsWith('/Integration/Slack.yaml'), slack!.uri.path);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      assert.strictEqual(
        await api.newResource({ type: 'kind', kind: integration, parents: [] }),
        undefined,
        'not twice',
      );
      assert.ok(
        !api.sync.list().some((e) => e.uri.path.includes('/templates/')),
        'templates are not repository resources',
      );
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('helps with topic configs and presets', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const content =
      'apiVersion: v2\nkind: Topic\nmetadata: { name: vscode-configs, cluster: local-kafka }\nspec:\n  partitions: 1\n  \n  configs:\n    retention.ms: "a week"\n    retention.days: "7"\n    \n';
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
    const problems = () =>
      vscode.languages
        .getDiagnostics(doc.uri)
        .filter((d) => d.source === 'Conduktor')
        .map((d) => d.message);
    await until(() => problems().length >= 2);
    assert.ok(problems().includes('retention.ms is a long (a whole number).'), problems().join('\n'));
    assert.ok(problems().some((m) => m.startsWith('retention.days is not a Kafka topic config')));

    const lines = content.split('\n');
    const at = (line: number) => new vscode.Position(line, lines[line]!.length);
    const complete = (position: vscode.Position) =>
      vscode.commands.executeCommand<vscode.CompletionList>('vscode.executeCompletionItemProvider', doc.uri, position);
    const label = (i: vscode.CompletionItem) => (typeof i.label === 'string' ? i.label : i.label.label);
    const keys = await complete(at(9));
    assert.ok(
      keys.items.some((i) => label(i) === 'cleanup.policy'),
      'config keys are offered',
    );
    assert.ok(!keys.items.some((i) => label(i) === 'retention.ms'), 'a key already set is not offered again');
    const snippet = (key: string) => {
      const insert = keys.items.find((i) => label(i) === key)?.insertText;
      return insert instanceof vscode.SnippetString ? insert.value : insert;
    };
    assert.strictEqual(snippet('segment.ms'), 'segment.ms: ${1:604800000}', 'a whole number stays plain');
    assert.strictEqual(snippet('preallocate'), 'preallocate: "${1:false}"', 'Console takes a boolean as a string');
    assert.strictEqual(snippet('cleanup.policy'), 'cleanup.policy: "${1|compact,delete|}"');

    const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      doc.uri,
      new vscode.Position(7, 6),
    );
    const text = hovers
      .flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : '')))
      .join('\n');
    assert.match(text, /topicconfigs_retention\.ms/);

    const presets = await complete(at(5));
    const compacted = presets.items.find((i) => label(i) === 'Preset: Compacted (latest value per key)');
    assert.ok(compacted?.command, presets.items.map(label).join(', '));
    await vscode.commands.executeCommand(compacted.command.command, ...(compacted.command.arguments ?? []));
    assert.strictEqual(parse(doc.getText()).spec.configs['cleanup.policy'], 'compact');

    const empty = await vscode.workspace.openTextDocument({
      language: 'yaml',
      content: 'apiVersion: v2\nkind: Topic\nmetadata: { name: vscode-empty, cluster: local-kafka }\nspec:\n  \n',
    });
    const offered = await vscode.commands.executeCommand<vscode.CompletionList>(
      'vscode.executeCompletionItemProvider',
      empty.uri,
      new vscode.Position(4, 2),
    );
    const durable = offered.items.find((i) => label(i) === 'Preset: Durable');
    assert.ok(durable?.command, offered.items.map(label).join(', '));
    await vscode.commands.executeCommand(durable.command.command, ...(durable.command.arguments ?? []));
    assert.deepStrictEqual(parse(empty.getText()).spec, {
      replicationFactor: 3,
      configs: { 'min.insync.replicas': '2', 'unclean.leader.election.enable': 'false' },
    });
  });

  test('moves a sync folder from the old layout into environments/, base copies to the root', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = vscode.Uri.file(mkdtempSync(join(tmpdir(), 'conduktor-legacy-')));
    const env = state.connection.name;
    const file = 'global/console/KafkaCluster/legacy.yaml';
    const text = stringify({ apiVersion: 'v2', kind: 'KafkaCluster', metadata: { name: 'legacy' }, spec: {} });
    const put = (path: string) =>
      vscode.workspace.fs.writeFile(vscode.Uri.joinPath(root, path), new TextEncoder().encode(text));
    await put(`${env}/${file}`);
    await put(`${env}/.conduktor/base/${file}`);
    await put(`${env}/.conduktor/.gitignore`);
    try {
      await api.sync.setSyncRoot(root);
      const moved = api.sync.entryFor('KafkaCluster', [], 'legacy');
      assert.strictEqual(moved?.uri.fsPath, join(root.fsPath, 'environments', env, file));
      assert.strictEqual(moved?.status, 'synced', 'the base came along');
      await vscode.workspace.fs.stat(vscode.Uri.joinPath(root, '.conduktor', 'base', env, file));
      assert.ok(!existsSync(join(root.fsPath, env)), 'the old folder is gone');
      assert.ok(!existsSync(join(root.fsPath, 'environments', env, '.conduktor')), 'nothing but resources is left');
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('stays quick in a sync folder of thousands of resources', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-large-'));
    const env = state.connection.name;
    const folder = `clusters/local-kafka/kafka/Topic`;
    const text = (i: number, partitions = 1) =>
      stringify({
        apiVersion: 'v2',
        kind: 'Topic',
        metadata: { name: `t-${i}`, cluster: 'local-kafka' },
        spec: { partitions, replicationFactor: 1 },
      });
    mkdirSync(join(root, 'environments', env, folder), { recursive: true });
    mkdirSync(join(root, '.conduktor', 'base', env, folder), { recursive: true });
    for (let i = 0; i < 3000; i++) {
      writeFileSync(join(root, 'environments', env, folder, `t-${i}.yaml`), text(i));
      writeFileSync(join(root, '.conduktor', 'base', env, folder, `t-${i}.yaml`), text(i));
    }
    const topic = state.spec.catalog.latest('Topic')!;
    try {
      await api.sync.setSyncRoot(vscode.Uri.file(root));
      assert.strictEqual(api.sync.list().length, 3000);
      assert.ok(api.sync.list().every((e) => e.status === 'synced'));

      const started = Date.now();
      const doc = await api.newResource({ type: 'parent', kind: topic, parents: ['local-kafka'] });
      const took = Date.now() - started;
      assert.ok(doc);
      assert.ok(took < 400, `New Resource took ${took} ms`);
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');

      writeFileSync(join(root, 'environments', env, folder, 't-7.yaml'), text(7, 2));
      writeFileSync(join(root, '.conduktor', 'base', env, folder, 't-8.yaml'), text(8, 3));
      rmSync(join(root, 'environments', env, folder, 't-9.yaml'));
      await api.sync.refresh();
      const status = (name: string) => api.sync.entryFor('Topic', ['local-kafka'], name)?.status;
      assert.strictEqual(status('t-7'), 'modified', 'a changed file');
      assert.strictEqual(status('t-8'), 'modified', 'a changed base');
      assert.strictEqual(status('t-9'), undefined, 'a deleted file');
      assert.strictEqual(status('t-10'), 'synced');
      assert.strictEqual(api.sync.list().length, 3000, '2999 plus the new one');

      writeFileSync(join(root, 'environments', env, folder, 't-9.yaml'), 'not: a resource\n');
      await api.sync.refresh();
      assert.strictEqual(status('t-9'), undefined, 'a re-created file is read afresh');
      assert.ok(api.sync.others().some((uri) => uri.path.endsWith('/t-9.yaml')));

      const timed = async () => {
        const at = Date.now();
        const documents = await api.names.repoDocuments('Topic');
        return { documents, took: Date.now() - at };
      };
      await timed();
      let rescans = 0;
      const counting = api.sync.onDidChange(() => rescans++);
      writeFileSync(join(root, 'environments', env, folder, 't-11.yaml'), text(11, 5));
      await api.sync.refresh();
      // The watcher's own rescan follows; timing during it would measure both.
      await until(() => rescans >= 2, 5_000).catch(() => undefined);
      counting.dispose();
      const { documents, took: indexed } = await timed();
      assert.ok(indexed < 300, `the name index took ${indexed} ms after one change`);
      assert.strictEqual(
        (documents.find((d) => d.resource.metadata.name === 't-11')?.resource.spec as { partitions?: number })
          ?.partitions,
        5,
        'the changed file is read afresh',
      );

      const checking = Date.now();
      await api.sync.refresh({ drift: true });
      const checked = Date.now() - checking;
      assert.ok(checked < 10_000, `checking drift took ${checked} ms`);
      assert.ok(
        api.sync.list().every((e) => e.drift === 'deleted' || e.status === 'new'),
        'none of them is in the Console',
      );
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test('explains fields, links their docs and where references point', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const content =
      'apiVersion: v2\nkind: Topic\nmetadata:\n  name: vscode-hover\n  cluster: local-kafka\nspec:\n  partitions: 1\n  replicationFactor: 1\n  configs:\n    retention.ms: "1"\n';
    const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
    const hover = async (needle: string, inside = 1) => {
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        doc.uri,
        doc.positionAt(content.indexOf(needle) + inside),
      );
      return hovers
        .flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : '')))
        .join('\n');
    };
    assert.match(
      await hover('kind'),
      /\*\*Topic\*\*[\s\S]*docs\.conduktor\.io\/guide\/reference\/kafka-reference#topic/,
    );
    const cluster = await hover('cluster');
    assert.match(cluster, /valid Kafka cluster/);
    assert.match(cluster, /in the Console|in the repository/);
    assert.match(await hover('partitions'), /integer · required/);
    assert.doesNotMatch(await hover('retention.ms'), /docs\.conduktor\.io/, 'topic configs keep their own hover');

    const cluster2 =
      'apiVersion: v2\nkind: KafkaCluster\nmetadata:\n  name: x\nspec:\n  schemaRegistry:\n    type: ConfluentLike\n    security:\n      type: BasicAuth\n';
    const registry = await vscode.workspace.openTextDocument({ language: 'yaml', content: cluster2 });
    const [described] = await vscode.commands.executeCommand<vscode.Hover[]>(
      'vscode.executeHoverProvider',
      registry.uri,
      registry.positionAt(cluster2.lastIndexOf('type') + 1),
    );
    const text = described!.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : '')).join('\n');
    assert.match(text, /\[Confluent or Confluent-like Registry\]\([^)]*#confluent-or-confluent-like-registry\)/);
    assert.match(text, /\[AWS Glue registry\]/, 'each section the docs describe it in is named');
    assert.match(text, /\[Docs\]\([^)]*#kafkacluster\)/, 'the Docs link goes to the kind when sections differ');

    const hoverIn = async (content: string, needle: string) => {
      const opened = await vscode.workspace.openTextDocument({ language: 'yaml', content });
      const found = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        opened.uri,
        opened.positionAt(content.indexOf(needle) + 1),
      );
      return found
        .flatMap((h) => h.contents.map((c) => (typeof c === 'string' ? c : 'value' in c ? c.value : '')))
        .join('\n');
    };
    const unscoped = await hoverIn(
      'apiVersion: v2\nkind: Connector\nmetadata:\n  name: c\n  connectCluster: somewhere\nspec:\n  config: {}\n',
      'somewhere',
    );
    assert.doesNotMatch(unscoped, /not found/, 'without its cluster the Console was never asked');
    const missing = await hoverIn(
      'apiVersion: v2\nkind: Topic\nmetadata:\n  name: t\n  cluster: no-such-cluster\nspec:\n  partitions: 1\n',
      'no-such-cluster',
    );
    assert.match(missing, /no-such-cluster`?: not found in the repository or the Console/);
    const planted = await hoverIn(
      'apiVersion: v2\nkind: Topic\nmetadata:\n  name: t\n  cluster: "a`[x](command:vscode.open?%5B%5D)"\nspec:\n  partitions: 1\n',
      'cluster:',
    );
    assert.match(planted, /``a`\[x\]\(command:vscode\.open\?%5B%5D\)``/, 'a value stays inside its code span');
  });

  test('dry-runs and applies a live document only on its own connection', async () => {
    const api = await activate();
    const start = api.sessions.current();
    if (start.status !== 'ready') assert.fail(start.status);
    // The test profile keeps the connection list between runs, not the stored tokens: add it again.
    await api.connections.add({ id: 'smoke-apply', name: 'smoke-apply', url: baseUrl!, mode: 'dev' }, apiKey!);
    const switchTo = async (id: string) => {
      const now = api.sessions.current();
      if (now.status === 'ready' && now.connection.id === id) return;
      await api.connections.setActive(id);
      await until(() => {
        const current = api.sessions.current();
        return current.status === 'ready' && current.connection.id === id;
      }).catch(() => {
        const current = api.sessions.current();
        throw new Error(
          `switching to ${id}: ${JSON.stringify({ status: current.status, message: 'message' in current ? current.message : undefined, id: 'connection' in current ? current.connection?.id : undefined })}`,
        );
      });
    };
    try {
      await switchTo('smoke');
      const state = api.sessions.current();
      if (state.status !== 'ready') assert.fail(state.status);
      const kind = state.spec.catalog.latest('KafkaCluster')!;
      const uri = api.liveUri({ type: 'resource', kind, parents: [], name: 'local-gateway' });
      await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
      await switchTo('smoke-apply');
      assert.strictEqual(await vscode.commands.executeCommand('conduktor.dryRunDocument', uri, 0), undefined);
      assert.strictEqual(await vscode.commands.executeCommand('conduktor.applyDocument', uri, 0), undefined);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
      await switchTo(start.connection.id);
    }
  });

  test("dry-runs and applies a sync folder file only on its own environment's connection", async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-foreign-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    try {
      const file = join(root, 'environments', 'not-this-one', 'global', 'console', 'KafkaCluster', 'x.yaml');
      mkdirSync(join(file, '..'), { recursive: true });
      writeFileSync(file, stringify({ apiVersion: 'v2', kind: 'KafkaCluster', metadata: { name: 'x' }, spec: {} }));
      const uri = vscode.Uri.file(file);
      assert.strictEqual(await vscode.commands.executeCommand('conduktor.dryRunDocument', uri, 0), undefined);
      assert.strictEqual(await vscode.commands.executeCommand('conduktor.applyDocument', uri, 0), undefined);
    } finally {
      await useWorkspaceSyncRoot(api);
    }
  });

  test("shows each resource's state git-style, rolled up to its parents, in the tree only", async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-states-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    await api.clusters.set('local-kafka');
    const decoration = (uri: vscode.Uri) =>
      api.treeDecorations.provideFileDecoration(uri, new vscode.CancellationTokenSource().token);
    const look = (uri: vscode.Uri) => {
      const found = decoration(uri);
      return (
        found && {
          badge: found.badge,
          color: (found.color as vscode.ThemeColor | undefined)?.id,
          up: !!found.propagate,
        }
      );
    };
    const clusterKind = state.spec.catalog.latest('KafkaCluster')!;
    const topicKind = state.spec.catalog.latest('Topic')!;
    try {
      const uri = await api.sync.syncResource(clusterKind, [], 'local-gateway');
      const mark = (status: 'synced' | 'modified') => ({ status, uri: uri.toString() });
      const synced = api.explorer.getTreeItem({
        type: 'resource',
        kind: clusterKind,
        parents: [],
        name: 'local-gateway',
        local: mark('synced'),
      });
      assert.strictEqual((synced.iconPath as vscode.ThemeIcon).id, 'check');
      assert.strictEqual(synced.resourceUri?.scheme, 'conduktor-tree');
      assert.strictEqual(look(synced.resourceUri!), undefined, 'synced reads as normal');

      // A collapsed kind shows the dot only from decorations VS Code already holds, so a change names each resource.
      const announced: string[] = [];
      const listening = api.treeDecorations.onDidChangeFileDecorations((uris) => {
        for (const changed of Array.isArray(uris) ? uris : uris ? [uris] : []) announced.push(changed.toString());
      });
      const edited = parse(readFileSync(uri.fsPath, 'utf8'));
      edited.spec.displayName = 'Edited here';
      writeFileSync(uri.fsPath, stringify(edited));
      await api.sync.refresh();
      listening.dispose();
      assert.ok(announced.includes(synced.resourceUri!.toString()), announced.join('\n'));
      assert.deepStrictEqual(look(synced.resourceUri!), {
        badge: 'M',
        color: 'gitDecoration.modifiedResourceForeground',
        up: true,
      });

      const remote = api.explorer.getTreeItem({
        type: 'resource',
        kind: clusterKind,
        parents: [],
        name: 'local-kafka',
      });
      assert.strictEqual((remote.iconPath as vscode.ThemeIcon).id, 'cloud');
      assert.deepStrictEqual(look(remote.resourceUri!), {
        badge: undefined,
        color: 'gitDecoration.ignoredResourceForeground',
        up: false,
      });
      const kindItem = api.explorer.getTreeItem({ type: 'kind', kind: clusterKind, parents: [] });
      assert.strictEqual(look(kindItem.resourceUri!), undefined, 'a kind gets only what rolls up from below');
      assert.strictEqual(kindItem.tooltip, 'KafkaCluster v2', 'never the raw tree path');
      assert.strictEqual(
        decoration(api.liveUri({ type: 'resource', kind: clusterKind, parents: [], name: 'local-gateway' })),
        undefined,
        'an editor tab is never decorated',
      );

      const [topic] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
      await api.sync.syncResource(topicKind, ['local-kafka'], topic!.metadata.name);
      const topicItem = api.explorer.getTreeItem({
        type: 'resource',
        kind: topicKind,
        parents: ['local-kafka'],
        name: topic!.metadata.name,
      });
      assert.strictEqual(look(topicItem.resourceUri!), undefined);
      await api.clusters.set('local-gateway');
      assert.strictEqual(
        look(topicItem.resourceUri!)?.color,
        'gitDecoration.ignoredResourceForeground',
        'read in the selected cluster',
      );
    } finally {
      await api.clusters.set('local-kafka');
      await useWorkspaceSyncRoot(api);
    }
  });

  test('opens local changes against the base, and diffs the document under the cursor', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-changes-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    const diffTab = () =>
      vscode.window.tabGroups.activeTabGroup.activeTab?.input as vscode.TabInputTextDiff | undefined;
    try {
      const uri = await api.sync.syncResource(state.spec.catalog.latest('KafkaCluster')!, [], 'local-gateway');
      const base = readFileSync(uri.fsPath, 'utf8');
      const edited = parse(base);
      edited.spec.displayName = 'Edited locally';
      writeFileSync(uri.fsPath, stringify(edited));
      await api.sync.refresh();
      await vscode.window.showTextDocument(uri);
      await vscode.commands.executeCommand('conduktor.openChanges');
      const changes = diffTab();
      assert.strictEqual(changes?.original.scheme, 'conduktor-base');
      assert.strictEqual(changes?.modified.toString(), uri.toString());
      assert.strictEqual((await vscode.workspace.openTextDocument(changes.original)).getText(), base);
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');

      const two =
        'apiVersion: v2\nkind: Topic\nmetadata: { name: first-doc, cluster: local-kafka }\nspec: { partitions: 1 }\n---\napiVersion: v2\nkind: Topic\nmetadata: { name: second-doc, cluster: local-kafka }\nspec: { partitions: 1 }\n';
      const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content: two });
      const editor = await vscode.window.showTextDocument(doc);
      const inSecond = doc.positionAt(two.indexOf('second-doc'));
      editor.selection = new vscode.Selection(inSecond, inSecond);
      await vscode.commands.executeCommand('conduktor.diffWithLive');
      assert.match(diffTab()?.modified.path ?? '', /second-doc/);
      // The editor title's toolbar passes its own context object after the URI.
      await vscode.window.showTextDocument(doc);
      editor.selection = new vscode.Selection(inSecond, inSecond);
      await vscode.commands.executeCommand('conduktor.diffWithLive', doc.uri, { groupId: 0, editorIndex: 0 });
      assert.match(diffTab()?.modified.path ?? '', /second-doc/);
    } finally {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await useWorkspaceSyncRoot(api);
    }
  });

  test('reveals the open resource in the Explorer, by command or automatically', async () => {
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-reveal-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    await api.clusters.set('local-kafka');
    const selected = () => {
      const [node] = api.explorerView.selection;
      return node?.type === 'resource' ? `${node.kind.kind}/${[...node.parents, node.name].join('/')}` : undefined;
    };
    const settings = vscode.workspace.getConfiguration('conduktor');
    const clusterKind = state.spec.catalog.latest('KafkaCluster')!;
    try {
      const gateway = await api.sync.syncResource(clusterKind, [], 'local-gateway');
      await vscode.window.showTextDocument(gateway);
      await vscode.commands.executeCommand('conduktor.revealInExplorer');
      await until(() => selected() === 'KafkaCluster/local-gateway', 10_000);

      await settings.update('explorer.autoReveal', true, vscode.ConfigurationTarget.Global);
      const kafka = await api.sync.syncResource(clusterKind, [], 'local-kafka');
      await vscode.window.showTextDocument(kafka);
      await until(() => selected() === 'KafkaCluster/local-kafka', 10_000);

      const [topic] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
      const topicFile = await api.sync.syncResource(
        state.spec.catalog.latest('Topic')!,
        ['local-kafka'],
        topic!.metadata.name,
      );
      await api.clusters.set('local-gateway');
      await vscode.window.showTextDocument(topicFile);
      await new Promise((resolve) => setTimeout(resolve, 500));
      assert.strictEqual(api.clusters.current(), 'local-gateway', 'following the editor never switches the cluster');
      await vscode.commands.executeCommand('conduktor.revealInExplorer');
      assert.strictEqual(api.clusters.current(), 'local-kafka');
      await until(() => selected() === `Topic/local-kafka/${topic!.metadata.name}`, 10_000);

      // Show Only Changes hides a synced resource: the command neither switches the cluster nor selects anything.
      await api.clusters.set('local-gateway');
      await vscode.commands.executeCommand('conduktor.showOnlyChanges');
      await vscode.window.showTextDocument(topicFile);
      await vscode.commands.executeCommand('conduktor.revealInExplorer');
      assert.strictEqual(api.clusters.current(), 'local-gateway', 'a hidden resource does not move the tree');
      await vscode.commands.executeCommand('conduktor.showAll');
    } finally {
      await settings.update('explorer.autoReveal', undefined, vscode.ConfigurationTarget.Global);
      await api.clusters.set('local-kafka');
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await useWorkspaceSyncRoot(api);
    }
  });

  test('runs ctl for an environment, in Docker or from PATH', async function () {
    const docker = spawnSync('docker', ['version']).status === 0;
    if (!docker && spawnSync('conduktor', ['version']).error) return this.skip();
    const api = await activate();
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-cli-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    const settings = vscode.workspace.getConfiguration('conduktor.cli');
    try {
      const [topic] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
      await api.sync.syncResource(state.spec.catalog.latest('Topic')!, ['local-kafka'], topic!.metadata.name);
      const run = await api.cli.run('plan');
      assert.strictEqual(run?.exitCode, 0, run?.stderr);
      assert.match(
        run.stdout,
        new RegExp(`Topic/${topic!.metadata.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: NotChanged`),
      );

      if (!spawnSync('conduktor', ['version']).error) {
        // An image that cannot be pulled: auto mode runs the CLI from PATH instead.
        await settings.update('image', 'conduktor/conduktor-ctl:no-such-tag', vscode.ConfigurationTarget.Global);
        const fallback = await api.cli.run('plan');
        assert.strictEqual(fallback?.exitCode, 0, fallback?.stderr);
      }

      await settings.update('runner', 'path', vscode.ConfigurationTarget.Global);
      await settings.update('path', join(root, 'no-such-ctl'), vscode.ConfigurationTarget.Global);
      await assert.rejects(api.cli.run('plan'), /was not found/);
    } finally {
      for (const key of ['image', 'runner', 'path'])
        await settings.update(key, undefined, vscode.ConfigurationTarget.Global);
      await useWorkspaceSyncRoot(api);
    }
  });

  test("plans and applies an environment with ctl, and leaves a removed file's resource on the Console", async function () {
    if (spawnSync('docker', ['version']).status !== 0) return this.skip();
    const api = await activate();
    api.setConfirm(async (_message, _detail, ...actions) => actions[0]);
    await api.connections.add({ id: 'smoke-apply', name: 'smoke-apply', url: baseUrl!, mode: 'dev' }, apiKey!);
    // Adding an already active connection reloads twice; wait until it is ready and stays so.
    const ready = () => {
      const current = api.sessions.current();
      return current.status === 'ready' && current.connection.id === 'smoke-apply';
    };
    for (let calm = 0; calm < 3; calm = ready() ? calm + 1 : 0)
      await new Promise((resolve) => setTimeout(resolve, 200));
    const state = api.sessions.current();
    if (state.status !== 'ready') assert.fail(state.status);
    const root = mkdtempSync(join(tmpdir(), 'conduktor-cli-apply-'));
    await api.sync.setSyncRoot(vscode.Uri.file(root));
    const topicKind = state.spec.catalog.latest('Topic')!;
    const name = `vscode-cli-${Date.now()}`;
    const bad = `${name}-bad`;
    const topicPath = (topic: string) => `/public/kafka/v2/cluster/local-kafka/topic/${topic}`;
    const exists = (topic: string) =>
      state.client.get(topicPath(topic)).then(
        () => true,
        () => false,
      );
    const results = (outcomes: { kind: string; name: string; result: string }[] | undefined, topic: string) =>
      (outcomes ?? []).filter((o) => o.kind === 'Topic' && o.name === topic).map((o) => o.result);
    const topic = (topicName: string) =>
      stringify({
        apiVersion: 'v2',
        kind: 'Topic',
        metadata: { name: topicName, cluster: 'local-kafka' },
        spec: { partitions: 1, replicationFactor: 1 },
      });
    try {
      const [kept] = await state.client.list('/public/kafka/v2/cluster/local-kafka/topic');
      await api.sync.syncResource(topicKind, ['local-kafka'], kept!.metadata.name);
      const file = await api.sync.writeNew(topicKind, ['local-kafka'], topic(name), name);

      const planned =
        await vscode.commands.executeCommand<{ kind: string; name: string; result: string }[]>(
          'conduktor.planEnvironment',
        );
      assert.deepStrictEqual(results(planned, name), ['Created'], JSON.stringify(planned));

      await vscode.commands.executeCommand('conduktor.applyEnvironment');
      assert.ok(await exists(name), 'applied to the Console');
      await until(() => api.sync.entryAt(file)?.status === 'synced', 10_000);
      const baseCopy = api.sync.baseUri(file)!.fsPath;

      rmSync(file.fsPath);
      await api.sync.refresh();
      let asked = '';
      api.setConfirm(async (_message, detail, ...actions) => {
        asked = detail ?? '';
        return actions[0];
      });
      const removal =
        await vscode.commands.executeCommand<{ kind: string; name: string; result: string }[]>(
          'conduktor.planEnvironment',
        );
      assert.deepStrictEqual(results(removal, name), [], 'ctl plans nothing for a removed file');
      assert.deepStrictEqual(
        (await api.sync.removedFiles()).map((r) => `${r.kind}/${r.name}`),
        [`Topic/${name}`],
      );
      await vscode.commands.executeCommand('conduktor.applyEnvironment');
      assert.match(asked, new RegExp(`Removed from the folder, left on the Console: Topic/${name}`));
      assert.ok(await exists(name), 'Apply never deletes');
      assert.deepStrictEqual(
        (await api.sync.removedFiles()).map((r) => r.name),
        [name],
        'listed again on the next Plan',
      );
      // Deleted on the Console, as the README says to: no longer reported, and its base copy goes.
      await state.client.delete(topicPath(name));
      assert.deepStrictEqual(await api.sync.removedFiles(), []);
      assert.ok(!existsSync(baseCopy), 'its base copy is forgotten');

      // The Console's dry run does not check config values, but it does check that the cluster exists.
      const broken = await api.sync.writeNew(
        topicKind,
        ['no-such-cluster'],
        stringify({
          apiVersion: 'v2',
          kind: 'Topic',
          metadata: { name: bad, cluster: 'no-such-cluster' },
          spec: { partitions: 1, replicationFactor: 1 },
        }),
        bad,
      );
      await vscode.commands.executeCommand('conduktor.planEnvironment');
      const problems = vscode.languages.getDiagnostics(broken).filter((d) => d.source === 'ctl');
      assert.ok(problems.length > 0, 'the failure is a Problem on its file');
    } finally {
      for (const topicName of [name, bad]) await state.client.delete(topicPath(topicName)).catch(() => undefined);
      await useWorkspaceSyncRoot(api);
      await api.connections.setActive('smoke');
    }
  });
});
