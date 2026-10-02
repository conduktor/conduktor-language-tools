import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  conduktorTools,
  describeError,
  workspaceFile,
  type ToolContext,
  type ToolDefinition,
} from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';

type Ready = Extract<SessionState, { status: 'ready' }>;

export function registerLanguageModelTools(sessions: SessionManager): vscode.Disposable[] {
  return conduktorTools.map((tool) =>
    vscode.lm.registerTool<Record<string, unknown>>(tool.name, {
      prepareInvocation: () => {
        const state = sessions.current();
        return {
          invocationMessage: state.status === 'ready' ? `${tool.title} on ${state.connection.name}` : tool.title,
        };
      },
      invoke: async (options) =>
        new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(await run(tool, options.input, sessions)),
        ]),
    }),
  );
}

async function run(tool: ToolDefinition, input: Record<string, unknown>, sessions: SessionManager): Promise<string> {
  const state = sessions.current();
  if (state.status !== 'ready') {
    return 'Not connected to a Conduktor Console. Ask the user to add or switch a connection in the Conduktor view.';
  }
  try {
    return await tool.run(input ?? {}, toolContext(state));
  } catch (error) {
    return `Error: ${describeError(error)}`;
  }
}

export function toolContext(state: Ready): ToolContext {
  return {
    connectionName: state.connection.name,
    mode: state.connection.mode,
    catalog: state.spec.catalog,
    schema: state.spec.schema,
    client: state.client,
    readFile: readWorkspaceFile,
    readInclude: readWorkspaceFile,
  };
}

// An open document's unsaved text is what the agent and the person are looking at, so it wins over the disk.
function readWorkspaceFile(file: string): string {
  const absolute = workspaceFile(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, file);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === absolute);
  return open ? open.getText() : readFileSync(absolute, 'utf8');
}
