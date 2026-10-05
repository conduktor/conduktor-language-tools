import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { containedFile } from '@conduktor/vscode-core';
import { includeRoot } from '../sync/folders';

export function includeReaderFor(uri: vscode.Uri): ((file: string) => string) | undefined {
  if (uri.scheme !== 'file') return undefined;
  const root = includeRoot(uri.fsPath, vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []);
  // A cloned repository's schemaFile must not reach past it: what is read is sent to the Console.
  return (file: string) => readFileSync(containedFile(root, file), 'utf8');
}
