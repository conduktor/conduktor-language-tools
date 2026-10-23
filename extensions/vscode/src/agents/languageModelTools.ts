import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { conduktorTools, describeError, isRecord, workspaceFile, type ToolDefinition } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { track } from '../telemetry';

export function registerLanguageModelTools(sessions: SessionManager): vscode.Disposable[] {
  return conduktorTools.map((tool) =>
    vscode.lm.registerTool<unknown>(tool.name, {
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

async function run(tool: ToolDefinition, input: unknown, sessions: SessionManager): Promise<string> {
  const called = (result: 'success' | 'failure') =>
    track({ name: 'tool.Called', properties: { tool: tool.name, result } });
  const state = sessions.current();
  if (state.status !== 'ready') {
    called('failure');
    return 'Not connected to a Conduktor Console. Ask the user to add or switch a connection in the Conduktor view.';
  }
  try {
    const text = await tool.run(isRecord(input) ? input : {}, {
      connectionName: state.connection.name,
      catalog: state.spec.catalog,
      schema: state.spec.schema,
      client: state.client,
      readFile: readWorkspaceFile,
      readInclude: readWorkspaceFile,
    });
    called('success');
    return text;
  } catch (error) {
    called('failure');
    return `Error: ${describeError(error)}`;
  }
}

// An open document's unsaved text is what the agent and the person are looking at, so it wins over the disk.
function readWorkspaceFile(file: string): string {
  const absolute = workspaceFile(vscode.workspace.workspaceFolders?.[0]?.uri.fsPath, file);
  const open = vscode.workspace.textDocuments.find((d) => d.uri.scheme === 'file' && d.uri.fsPath === absolute);
  return open ? open.getText() : readFileSync(absolute, 'utf8');
}
