import * as vscode from 'vscode';
import type { TopicPreset, UpsertItem } from '@conduktor/vscode-core';
import { registerLanguageModelTools } from './agents/languageModelTools';
import { registerClaudeCodeConfigCommand, registerConsoleMcpServer } from './agents/mcpServers';
import { exposedApi } from './api';
import { modalConfirm, type Confirm } from './confirm';
import { registerConnectionCommands } from './connections/commands';
import { ConnectionStore } from './connections/connectionStore';
import { SessionManager } from './connections/session';
import { ResourceCodeLensProvider } from './editing/codeLens';
import { Compare } from './editing/compare';
import {
  newResource,
  quickPickTemplate,
  quickPickVariant,
  type TemplatePicker,
  type VariantPicker,
} from './editing/newResource';
import { ResourceController } from './editing/resourceController';
import type { ExplorerNode, ResourceNode } from './explorer/explorerModel';
import { ClusterSelection } from './explorer/clusterSelection';
import { ExplorerProvider } from './explorer/explorerProvider';
import { registerResourceCommands } from './explorer/resourceCommands';
import { ConduktorFileSystem } from './liveFs/conduktorFileSystem';
import { LIVE_EDIT_SCHEME, LIVE_SCHEME } from './liveFs/uris';
import { Output } from './output';
import { registerYamlSchemas } from './schema/yamlSchemaContributor';
import { applyAllChanges } from './sync/applyChanges';
import { registerSyncCommands } from './sync/commands';
import { LocalChangesError, SyncFolder } from './sync/syncFolder';
import { MatchLensProvider } from './intel/matchLenses';
import { Names } from './intel/names';
import { ReferenceDiagnostics } from './intel/referenceDiagnostics';
import { ReferenceCompletionProvider, ReferenceDefinitionProvider } from './intel/referenceProviders';
import { ReferrersProvider } from './intel/referrers';
import { SnippetCompletionProvider } from './intel/snippets';
import { ActiveResourceContext } from './editing/activeResource';
import { BASE_SCHEME, BaseContent, openChanges } from './editing/localChanges';
import { ConsoleOnlyDecorations } from './explorer/decorations';
import { FieldDocsHover } from './intel/fieldDocs';
import { APPLY_PRESET, applyTopicPreset, TopicConfigDiagnostics, TopicConfigProvider } from './intel/topicConfigs';
import { createStatusBar } from './statusBar';

export interface ExtensionApi {
  connections: ConnectionStore;
  sessions: SessionManager;
  explorer: ExplorerProvider;
  liveUri: (node: ResourceNode) => vscode.Uri;
  dryRun: (uri: vscode.Uri, index?: number) => Promise<UpsertItem[] | undefined>;
  apply: (uri: vscode.Uri, index?: number) => Promise<UpsertItem[] | undefined>;
  newResource: (node?: ExplorerNode) => Promise<vscode.TextDocument | undefined>;
  setConfirm: (confirm: Confirm) => void;
  setVariantPicker: (picker: VariantPicker) => void;
  setTemplatePicker: (picker: TemplatePicker) => void;
  sync: SyncFolder;
  clusters: ClusterSelection;
  compare: Compare;
  applyAllChanges: () => Promise<UpsertItem[] | undefined>;
  names: Names;
  consoleOnly: ConsoleOnlyDecorations;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi | undefined {
  let confirmWith: Confirm = modalConfirm;
  const confirm: Confirm = (...args) => confirmWith(...args);
  let pickVariantWith: VariantPicker = quickPickVariant;
  const pickVariant: VariantPicker = (...args) => pickVariantWith(...args);
  let pickTemplateWith: TemplatePicker = quickPickTemplate;
  const pickTemplate: TemplatePicker = (...args) => pickTemplateWith(...args);

  const output = new Output();
  const connections = new ConnectionStore(context);
  const sessions = new SessionManager(context, connections, output);
  const compare = new Compare(sessions);
  const resources = new ResourceController(sessions, output, compare, confirm, (uri) => sync.foreignEnvironment(uri));
  const codeLenses = new ResourceCodeLensProvider(sessions, resources);
  const sync = new SyncFolder(context, sessions, output);
  const names = new Names(sessions, sync);
  const matchLenses = new MatchLensProvider(sessions, names);
  const referrers = new ReferrersProvider(sessions, names, sync);
  const topicConfigs = new TopicConfigProvider(sessions, names);
  const clusters = new ClusterSelection(context, sessions);
  const explorer = new ExplorerProvider(sessions, sync, clusters);
  const consoleOnly = new ConsoleOnlyDecorations();
  const explorerView = vscode.window.createTreeView('conduktor.explorer', { treeDataProvider: explorer });
  const activeUri = (uri?: vscode.Uri) => uri ?? vscode.window.activeTextEditor?.document.uri;

  context.subscriptions.push(
    output,
    connections,
    sessions,
    explorer,
    explorerView,
    compare,
    resources,
    codeLenses,
    sync,
    names,
    matchLenses,
    referrers,
    new ReferenceDiagnostics(sessions, names),
    clusters,
    createStatusBar(sessions),
    ...registerSyncCommands(sync, confirm, sessions, connections, output),
    ...registerConnectionCommands(connections, sessions),
    ...registerResourceCommands(sessions, explorer, confirm, () => names.clear()),
    ...registerLanguageModelTools(sessions),
    registerConsoleMcpServer(sessions, connections),
    registerClaudeCodeConfigCommand(sessions, context),
    vscode.commands.registerCommand('conduktor.showOutput', () => output.show()),
    vscode.commands.registerCommand('conduktor.refreshExplorer', () => {
      names.clear();
      explorer.refresh();
    }),
    vscode.commands.registerCommand('conduktor.applyAllChanges', () =>
      applyAllChanges(sessions, sync, confirm, output, clusters.current()),
    ),
    vscode.commands.registerCommand('conduktor.applyLocal', (node: ResourceNode) =>
      node.local ? resources.apply(vscode.Uri.parse(node.local.uri)) : undefined,
    ),
    vscode.commands.registerCommand('conduktor.showOnlyChanges', () => explorer.showOnlyChanges(true)),
    vscode.commands.registerCommand('conduktor.showAll', () => explorer.showOnlyChanges(false)),
    vscode.commands.registerCommand('conduktor.selectCluster', () => clusters.pick()),
    vscode.commands.registerCommand('conduktor.newResource', (node?: ExplorerNode) =>
      newResource(sessions, sync, clusters.current(), node, pickVariant, pickTemplate),
    ),
    vscode.languages.registerCodeLensProvider({ language: 'yaml' }, codeLenses),
    vscode.languages.registerCompletionItemProvider(
      { language: 'yaml' },
      new ReferenceCompletionProvider(sessions, names),
    ),
    vscode.languages.registerCompletionItemProvider(
      { language: 'yaml' },
      new SnippetCompletionProvider(sessions, names, clusters, sync),
    ),
    vscode.languages.registerCompletionItemProvider({ language: 'yaml' }, topicConfigs),
    vscode.languages.registerHoverProvider({ language: 'yaml' }, topicConfigs),
    vscode.languages.registerHoverProvider({ language: 'yaml' }, new FieldDocsHover(sessions, sync, names, explorer)),
    vscode.window.registerFileDecorationProvider(consoleOnly),
    new ActiveResourceContext(sessions, sync),
    vscode.workspace.registerTextDocumentContentProvider(BASE_SCHEME, new BaseContent()),
    vscode.commands.registerCommand('conduktor.openChanges', (uri?: vscode.Uri) => {
      const target = activeUri(uri);
      return target ? openChanges(sync, target) : undefined;
    }),
    new TopicConfigDiagnostics(sessions),
    vscode.commands.registerCommand(APPLY_PRESET, (uri: vscode.Uri, start: number, preset: TopicPreset) =>
      applyTopicPreset(uri, start, preset, sessions),
    ),
    vscode.languages.registerCodeLensProvider({ language: 'yaml' }, matchLenses),
    vscode.languages.registerCodeLensProvider({ language: 'yaml' }, referrers),
    vscode.languages.registerReferenceProvider({ language: 'yaml' }, referrers),
    vscode.commands.registerCommand(
      'conduktor.showMatches',
      async (kindName: string, parents: string[], matched: string[]) => {
        const state = sessions.current();
        const kind = state.status === 'ready' ? state.spec.catalog.latest(kindName) : undefined;
        if (!kind) return;
        const picked = await vscode.window.showQuickPick(matched, { title: `${matched.length} ${kindName} resources` });
        if (!picked) return;
        const local = sync.entryFor(kindName, parents, picked);
        await vscode.window.showTextDocument(
          local?.uri ?? explorer.liveUri({ type: 'resource', kind, parents, name: picked }),
        );
      },
    ),
    vscode.languages.registerDefinitionProvider(
      { language: 'yaml' },
      new ReferenceDefinitionProvider(sessions, sync, explorer, names),
    ),
    vscode.commands.registerCommand('conduktor.dryRunDocument', (uri: vscode.Uri, index: number) =>
      resources.dryRun(uri, index),
    ),
    vscode.commands.registerCommand('conduktor.dryRunFile', (uri?: vscode.Uri) => {
      const target = activeUri(uri);
      return target ? resources.dryRun(target) : undefined;
    }),
    vscode.commands.registerCommand('conduktor.applyDocument', (uri: vscode.Uri, index: number) =>
      resources.apply(uri, index),
    ),
    vscode.commands.registerCommand('conduktor.applyFile', (uri?: vscode.Uri) => {
      const target = activeUri(uri);
      return target ? resources.apply(target) : undefined;
    }),
    vscode.commands.registerCommand('conduktor.diffWithLive', (uri?: vscode.Uri, index?: number) => {
      const target = activeUri(uri);
      return target ? compare.diffWithLive(target, index) : undefined;
    }),
    ...[false, true].map((editable) =>
      vscode.workspace.registerFileSystemProvider(
        editable ? LIVE_EDIT_SCHEME : LIVE_SCHEME,
        new ConduktorFileSystem(
          sessions,
          (text, liveName) => resources.saveLive(text, liveName),
          async (ref, text) => {
            const state = sessions.current();
            const kind = state.status === 'ready' ? state.spec.catalog.resolve(`v${ref.version}`, ref.kind) : undefined;
            if (!kind) throw new Error(`${ref.kind} v${ref.version} is not available on this Console.`);
            const local = await sync.stageEdit(kind, ref.parents, ref.name, text).catch(async (error: unknown) => {
              if (error instanceof LocalChangesError) await vscode.window.showTextDocument(error.entry.uri);
              throw error;
            });
            await vscode.window.showTextDocument(local);
            void vscode.window.showInformationMessage(
              `Staged ${ref.kind} ${ref.name} in ${vscode.workspace.asRelativePath(local)}. Nothing is applied until you Apply.`,
            );
          },
          () => sync.isActive(),
          editable,
        ),
        { isCaseSensitive: true, isReadonly: !editable },
      ),
    ),
    resources.onDidApply(({ uri, appliedText }) => {
      names.clear();
      explorer.refresh();
      if (uri && appliedText !== undefined && sync.contains(uri)) void sync.markApplied(uri, appliedText);
    }),
    connections.onDidChange(() => void sessions.reload()),
    clusters.onDidChange((cluster) => {
      const state = sessions.current();
      if (state.status !== 'none')
        explorerView.description = [state.connection.name, cluster].filter(Boolean).join(' · ');
    }),
    sessions.onDidChange((state) => {
      explorerView.description = state.status === 'none' ? undefined : state.connection.name;
      void vscode.commands.executeCommand(
        'setContext',
        'conduktor.mode',
        state.status === 'ready' ? state.connection.mode : undefined,
      );
    }),
  );

  void registerYamlSchemas(sessions, output).then((disposable) => context.subscriptions.push(disposable));
  void sessions.snapshotSpec();
  void sessions.reload();
  return exposedApi(context.extensionMode === vscode.ExtensionMode.Test, {
    connections,
    sessions,
    explorer,
    liveUri: (node: ResourceNode) => explorer.liveUri(node),
    dryRun: (uri: vscode.Uri, index?: number) => resources.dryRun(uri, index),
    apply: (uri: vscode.Uri, index?: number) => resources.apply(uri, index),
    newResource: (node?: ExplorerNode) =>
      newResource(sessions, sync, clusters.current(), node, pickVariant, pickTemplate),
    setConfirm: (replacement: Confirm) => {
      confirmWith = replacement;
    },
    setVariantPicker: (replacement: VariantPicker) => {
      pickVariantWith = replacement;
    },
    setTemplatePicker: (replacement: TemplatePicker) => {
      pickTemplateWith = replacement;
    },
    sync,
    applyAllChanges: () => applyAllChanges(sessions, sync, confirm, output, clusters.current()),
    clusters,
    compare,
    names,
    consoleOnly,
  });
}

export function deactivate(): void {}
