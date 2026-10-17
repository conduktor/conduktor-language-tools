import * as vscode from 'vscode';
import { describeError } from '@conduktor/core';
import type { ConnectionStore } from '../connections/connectionStore';
import type { Ready, SessionManager } from '../connections/session';
import { claudeCodeConfig } from './claudeCodeConfig';
import { installMcpServer } from './mcpInstall';

export function registerConsoleMcpServer(sessions: SessionManager, connections: ConnectionStore): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      const state = sessions.current();
      if (state.status !== 'ready') return [];
      return [new vscode.McpHttpServerDefinition(`Conduktor Console (${state.connection.name})`, mcpUri(state))];
    },
    // The token is added only when VS Code starts the server, so it never sits in a listed definition. A definition
    // listed for another connection gets nothing, so a token never reaches another Console.
    resolveMcpServerDefinition: async (server) => {
      const state = sessions.current();
      if (state.status !== 'ready' || server.uri.toString() !== mcpUri(state).toString()) return undefined;
      const token = await connections.token(state.connection.id);
      if (!token) return undefined;
      server.headers = { ...server.headers, Authorization: `Bearer ${token}` };
      return server;
    },
  };
  return vscode.Disposable.from(
    vscode.lm.registerMcpServerDefinitionProvider('conduktor.console', provider),
    sessions.onDidChange(() => changed.fire()),
    changed,
  );
}

function mcpUri(state: Ready): vscode.Uri {
  return vscode.Uri.parse(`${state.client.baseUrl}/api/mcp`);
}

export function registerClaudeCodeConfigCommand(
  sessions: SessionManager,
  context: vscode.ExtensionContext,
): vscode.Disposable {
  const install = () =>
    installMcpServer(
      vscode.Uri.joinPath(context.extensionUri, 'dist').fsPath,
      vscode.Uri.joinPath(context.globalStorageUri, 'mcp').fsPath,
      (context.extension.packageJSON as { version: string }).version,
    );
  // A config copied before an update keeps working: the copy it points at is refreshed when the extension starts.
  let installing = install().catch(() => undefined);
  return vscode.commands.registerCommand('conduktor.copyClaudeCodeConfig', async () => {
    const state = sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return;
    }
    const installed = installing.then(install);
    installing = installed.catch(() => undefined);
    let serverPath: string;
    try {
      serverPath = await installed;
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not set up the MCP server for Claude Code: ${describeError(error)}`);
      return;
    }
    const config = claudeCodeConfig({ url: state.client.baseUrl, name: state.connection.name, serverPath });
    await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
    void vscode.window.showInformationMessage(
      `Copied the MCP config for ${state.connection.name}. Paste it into .mcp.json, then export CONDUKTOR_TOKEN (a personal access token) before starting Claude Code.`,
    );
  });
}
