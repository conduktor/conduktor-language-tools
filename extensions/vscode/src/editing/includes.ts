import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { containedFile, includeRoot } from '@conduktor/core';

/** Where a file's schemaFile or descriptionFile is, refused when it would reach outside the workspace. */
export function includePath(uri: vscode.Uri, file: string): string {
  const root = includeRoot(uri.fsPath, vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? []);
  // A cloned repository's schemaFile must not reach past it: what is read is sent to the Console.
  return containedFile(root, file);
}

export function includeReaderFor(uri: vscode.Uri): ((file: string) => string) | undefined {
  if (uri.scheme !== 'file') return undefined;
  return (file: string) => readFileSync(includePath(uri, file), 'utf8');
}
