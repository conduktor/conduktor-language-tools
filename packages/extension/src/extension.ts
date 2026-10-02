import * as vscode from 'vscode';
import { registerConnectionCommands } from './connections/commands';
import { ConnectionStore } from './connections/connectionStore';
import { SessionManager } from './connections/session';
import { Output } from './output';
import { createStatusBar } from './statusBar';

export interface ExtensionApi {
  connections: ConnectionStore;
  sessions: SessionManager;
}

export function activate(context: vscode.ExtensionContext): ExtensionApi {
  const output = new Output();
  const connections = new ConnectionStore(context);
  const sessions = new SessionManager(context, connections, output);

  context.subscriptions.push(
    output,
    connections,
    sessions,
    createStatusBar(sessions),
    ...registerConnectionCommands(connections, sessions),
    vscode.commands.registerCommand('conduktor.showOutput', () => output.show()),
    connections.onDidChange(() => void sessions.reload()),
  );

  void sessions.snapshotSpec();
  void sessions.reload();
  return { connections, sessions };
}

export function deactivate(): void {}
