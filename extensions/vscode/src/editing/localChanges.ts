import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { SyncFolder } from '../sync/syncFolder';

export const BASE_SCHEME = 'conduktor-base';

/** The base a sync-folder file was synced or applied as, read-only. */
export class BaseContent implements vscode.TextDocumentContentProvider {
  constructor(private readonly sync: SyncFolder) {}

  provideTextDocumentContent(uri: vscode.Uri): string {
    // Only base copies: any other path behind this scheme would make it a viewer for any file on the disk.
    if (!this.sync.isBaseCopy(uri.with({ scheme: 'file' }))) return '';
    try {
      return readFileSync(uri.fsPath, 'utf8');
    } catch {
      return '';
    }
  }
}

/** Your edits since the file was last synced or applied, the way git's Open Changes shows them. */
export async function openChanges(sync: SyncFolder, uri: vscode.Uri): Promise<void> {
  const base = sync.baseUri(uri);
  const entry = sync.entryAt(uri);
  if (!entry) {
    void vscode.window.showInformationMessage('Open Changes compares a sync-folder file with its last sync or apply.');
    return;
  }
  if (!base || entry.status === 'new') {
    void vscode.window.showInformationMessage('This file is new, so there is nothing to compare it with.');
    return;
  }
  const name = uri.path.split('/').pop();
  await vscode.commands.executeCommand(
    'vscode.diff',
    base.with({ scheme: BASE_SCHEME }),
    uri,
    `${name} (last synced ↔ local)`,
  );
}
