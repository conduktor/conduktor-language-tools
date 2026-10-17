import * as vscode from 'vscode';
import { catalogDocuments } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';

/**
 * Sets of document URIs for menus to test with `resource in …`, so each editor's title and context menus speak about
 * that editor, not whichever one is active: open documents holding a Console resource, and the sync folder's files.
 */
export class DocumentContexts implements vscode.Disposable {
  private readonly listeners: vscode.Disposable[];
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    const documents = () => this.schedule();
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument(documents),
      vscode.workspace.onDidCloseTextDocument(documents),
      vscode.workspace.onDidChangeTextDocument(documents),
      sessions.onDidChange(documents),
      sync.onDidChange(() => void this.updateSyncFiles()),
    ];
    this.schedule();
    void this.updateSyncFiles();
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.updateDocuments(), 200);
  }

  private async updateDocuments(): Promise<void> {
    const state = this.sessions.current();
    const holding =
      state.status !== 'ready'
        ? []
        : vscode.workspace.textDocuments
            .filter((d) => d.languageId === 'yaml' && catalogDocuments(d.getText(), state.spec.catalog).length > 0)
            .map((d) => d.uri.toString());
    await vscode.commands.executeCommand('setContext', 'conduktor.resourceDocuments', holding);
  }

  private async updateSyncFiles(): Promise<void> {
    const entries = this.sync.list();
    await vscode.commands.executeCommand(
      'setContext',
      'conduktor.syncFiles',
      entries.map((e) => e.uri.toString()),
    );
    await vscode.commands.executeCommand(
      'setContext',
      'conduktor.modifiedFiles',
      entries.filter((e) => e.status === 'modified').map((e) => e.uri.toString()),
    );
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    for (const listener of this.listeners) listener.dispose();
  }
}
