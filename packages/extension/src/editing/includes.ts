import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { includeRoot } from '../sync/folders';

export function includeReaderFor(uri: vscode.Uri): ((file: string) => string) | undefined {
  if (uri.scheme !== 'file') return undefined;
  const root = includeRoot(uri.fsPath, vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []);
  return (file: string) => readFileSync(path.resolve(root, file), 'utf8');
}
