import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';

export function includeReaderFor(uri: vscode.Uri): ((file: string) => string) | undefined {
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  return folder && uri.scheme === 'file'
    ? (file: string) => readFileSync(path.resolve(folder.uri.fsPath, file), 'utf8')
    : undefined;
}
