import * as vscode from 'vscode';
import type { DryRunItem } from '@conduktor/vscode-core';
import { registerConnectionCommands } from './connections/commands';
import { ConnectionStore } from './connections/connectionStore';
import { SessionManager } from './connections/session';
import { DryRunCodeLensProvider } from './dryRun/codeLens';
import { DryRunController } from './dryRun/dryRunController';
import type { ResourceNode } from './explorer/explorerModel';
import { ExplorerProvider } from './explorer/explorerProvider';
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
  dryRun: (uri: vscode.Uri, index?: number) => Promise<DryRunItem[] | undefined>;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = new Output();
  const connections = new ConnectionStore(context);
  const sessions = new SessionManager(context, connections, output);
  const explorer = new ExplorerProvider(sessions);
  const explorerView = vscode.window.createTreeView('conduktor.explorer', { treeDataProvider: explorer });
  const dryRun = new DryRunController(sessions, output);
  const codeLenses = new DryRunCodeLensProvider(sessions);

  context.subscriptions.push(
    output,
    connections,
    sessions,
    explorer,
    explorerView,
    dryRun,
    codeLenses,
    createStatusBar(sessions),
    ...registerConnectionCommands(connections, sessions),
    vscode.commands.registerCommand('conduktor.showOutput', () => output.show()),
    vscode.commands.registerCommand('conduktor.refreshExplorer', () => explorer.refresh()),
    vscode.languages.registerCodeLensProvider({ language: 'yaml' }, codeLenses),
    vscode.commands.registerCommand('conduktor.dryRunDocument', (uri: vscode.Uri, index: number) =>
      dryRun.run(uri, index),
    ),
    vscode.commands.registerCommand('conduktor.dryRunFile', (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      return target ? dryRun.run(target) : undefined;
    }),
    vscode.workspace.registerFileSystemProvider(LIVE_SCHEME, new ConduktorFileSystem(sessions), {
      isCaseSensitive: true,
      isReadonly: true,
    }),
    connections.onDidChange(() => void sessions.reload()),
    sessions.onDidChange((state) => {
      explorerView.description = state.status === 'none' ? undefined : state.connection.name;
    }),
  );

  void registerYamlSchemas(sessions, output).then((disposable) => context.subscriptions.push(disposable));
  void sessions.snapshotSpec();
  void sessions.reload();
  return {
    connections,
    sessions,
    explorer,
    liveUri: (node) => explorer.liveUri(node),
    dryRun: (uri, index) => dryRun.run(uri, index),
  };
}

export function deactivate(): void {}
