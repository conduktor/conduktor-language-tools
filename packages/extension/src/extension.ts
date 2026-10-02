import * as vscode from 'vscode';
import { registerConnectionCommands } from './connections/commands';
import { ConnectionStore } from './connections/connectionStore';
import { SessionManager } from './connections/session';
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
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = new Output();
  const connections = new ConnectionStore(context);
  const sessions = new SessionManager(context, connections, output);
  const explorer = new ExplorerProvider(sessions);
  const explorerView = vscode.window.createTreeView('conduktor.explorer', { treeDataProvider: explorer });

  context.subscriptions.push(
    output,
    connections,
    sessions,
    explorer,
    explorerView,
    createStatusBar(sessions),
    ...registerConnectionCommands(connections, sessions),
    vscode.commands.registerCommand('conduktor.showOutput', () => output.show()),
    vscode.commands.registerCommand('conduktor.refreshExplorer', () => explorer.refresh()),
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
  return { connections, sessions, explorer };
}

export function deactivate(): void {}
