import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import {
  catalogDocuments,
  containedFile,
  includeRoot,
  type KindCatalog,
  type ReadInclude,
  type ResourceDocument,
} from '@conduktor/core';
import { variablesFor } from './variables';

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

export interface Source<F> {
  file: F;
  text: string;
}

/**
 * The Console documents in some files, each mapped to its file and that file's text (one source per file), and the
 * reader that finds each document's includes next to its own file. `named` says which file cannot be read from.
 */
export async function fileDocuments<F extends { uri: vscode.Uri }>(
  files: readonly F[],
  catalog: KindCatalog,
  named: (file: F) => string,
): Promise<{ origin: Map<ResourceDocument, Source<F>>; readInclude: ReadInclude }> {
  const origin = new Map<ResourceDocument, Source<F> & { read: ((path: string) => string) | undefined }>();
  for (const file of files) {
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(file.uri));
    const source = { file, text, read: includeReaderFor(file.uri) };
    for (const document of catalogDocuments(text, catalog, { env: variablesFor(file.uri) }))
      origin.set(document, source);
  }
  const readInclude: ReadInclude = (path, document) => {
    const source = origin.get(document);
    if (!source?.read) throw new Error(`${source ? named(source.file) : 'the file'} is not a local file`);
    return source.read(path);
  };
  return { origin, readInclude };
}
