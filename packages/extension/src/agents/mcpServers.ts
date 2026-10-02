import * as vscode from 'vscode';
import type { ConnectionStore } from '../connections/connectionStore';
import type { SessionManager } from '../connections/session';
import { claudeCodeConfig } from './claudeCodeConfig';

export function registerConsoleMcpServer(sessions: SessionManager, connections: ConnectionStore): vscode.Disposable {
  const changed = new vscode.EventEmitter<void>();
  const provider: vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition> = {
    onDidChangeMcpServerDefinitions: changed.event,
    provideMcpServerDefinitions: () => {
      const state = sessions.current();
      if (state.status !== 'ready') return [];
      const uri = vscode.Uri.parse(`${state.client.baseUrl}/api/mcp`);
      return [new vscode.McpHttpServerDefinition(`Conduktor Console (${state.connection.name})`, uri)];
    },
    // The token is added only when VS Code starts the server, so it never sits in a listed definition.
    resolveMcpServerDefinition: async (server) => {
      const state = sessions.current();
      const token = state.status === 'ready' ? await connections.token(state.connection.id) : undefined;
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

export function registerClaudeCodeConfigCommand(sessions: SessionManager, extensionUri: vscode.Uri): vscode.Disposable {
  return vscode.commands.registerCommand('conduktor.copyClaudeCodeConfig', async () => {
    const state = sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return;
    }
    const config = claudeCodeConfig({
      url: state.client.baseUrl,
      name: state.connection.name,
      mode: state.connection.mode,
      serverPath: vscode.Uri.joinPath(extensionUri, 'dist', 'mcp-server.js').fsPath,
    });
    await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2));
    void vscode.window.showInformationMessage(
      `Copied the MCP config for ${state.connection.name}. Paste it into .mcp.json, then export CONDUKTOR_TOKEN (a personal access token) before starting Claude Code.`,
    );
  });
}
