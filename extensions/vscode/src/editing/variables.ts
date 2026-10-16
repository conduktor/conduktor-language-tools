import { homedir } from 'node:os';
import * as vscode from 'vscode';
import { fileVariables } from '@conduktor/core';

/**
 * The ${VAR} values for a file: VS Code's environment, with the nearest .env's on top — searched up to the file's
 * workspace folder, repository root or home folder. Synchronous, because CodeLenses are.
 */
export function variablesFor(uri: vscode.Uri): Readonly<Record<string, string | undefined>> {
  if (uri.scheme !== 'file') return process.env;
  return fileVariables(uri.fsPath, process.env, {
    workspace: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath,
    home: homedir(),
  });
}
