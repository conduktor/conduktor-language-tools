import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import type { SyncFolder } from '../sync/syncFolder';

export const BASE_SCHEME = 'conduktor-base';

/** The base a sync-folder file was synced or applied as, read-only. */
export class BaseContent implements vscode.TextDocumentContentProvider {
  provideTextDocumentContent(uri: vscode.Uri): string {
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
  if (!base || !entry || entry.status === 'new') {
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
