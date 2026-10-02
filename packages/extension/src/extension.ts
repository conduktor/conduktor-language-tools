import * as vscode from 'vscode';
import type { UpsertItem } from '@conduktor/vscode-core';
import { registerLanguageModelTools } from './agents/languageModelTools';
import { registerClaudeCodeConfigCommand, registerConsoleMcpServer } from './agents/mcpServers';
import { exposedApi } from './api';
import { modalConfirm, type Confirm } from './confirm';
import { registerConnectionCommands } from './connections/commands';
import { ConnectionStore } from './connections/connectionStore';
import { SessionManager } from './connections/session';
import { ResourceCodeLensProvider } from './editing/codeLens';
import { Compare } from './editing/compare';
import { newResource } from './editing/newResource';
import { ResourceController } from './editing/resourceController';
import type { ExplorerNode, ResourceNode } from './explorer/explorerModel';
import { ExplorerProvider } from './explorer/explorerProvider';
import { registerResourceCommands } from './explorer/resourceCommands';
import { ConduktorFileSystem } from './liveFs/conduktorFileSystem';
import { LIVE_SCHEME } from './liveFs/uris';
import { Output } from './output';
import { registerYamlSchemas } from './schema/yamlSchemaContributor';
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
}

export function activate(context: vscode.ExtensionContext): ExtensionApi | undefined {
  let confirmWith: Confirm = modalConfirm;
  const confirm: Confirm = (...args) => confirmWith(...args);

  const output = new Output();
  const connections = new ConnectionStore(context);
  const sessions = new SessionManager(context, connections, output);
  const explorer = new ExplorerProvider(sessions);
  const explorerView = vscode.window.createTreeView('conduktor.explorer', { treeDataProvider: explorer });
  const compare = new Compare(sessions);
  const resources = new ResourceController(sessions, output, compare, confirm);
  const codeLenses = new ResourceCodeLensProvider(sessions, resources);
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
    createStatusBar(sessions),
    ...registerConnectionCommands(connections, sessions),
    ...registerResourceCommands(sessions, explorer, confirm),
    ...registerLanguageModelTools(sessions),
    registerConsoleMcpServer(sessions, connections),
    registerClaudeCodeConfigCommand(sessions, context.extensionUri),
    vscode.commands.registerCommand('conduktor.showOutput', () => output.show()),
    vscode.commands.registerCommand('conduktor.refreshExplorer', () => explorer.refresh()),
    vscode.commands.registerCommand('conduktor.newResource', (node?: ExplorerNode) => newResource(sessions, node)),
    vscode.languages.registerCodeLensProvider({ language: 'yaml' }, codeLenses),
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
    vscode.workspace.registerFileSystemProvider(
      LIVE_SCHEME,
      new ConduktorFileSystem(sessions, (text, liveName) => resources.saveLive(text, liveName)),
      { isCaseSensitive: true },
    ),
    resources.onDidApply(() => explorer.refresh()),
    connections.onDidChange(() => void sessions.reload()),
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
    newResource: (node?: ExplorerNode) => newResource(sessions, node),
    setConfirm: (replacement: Confirm) => {
      confirmWith = replacement;
    },
  });
}

export function deactivate(): void {}
