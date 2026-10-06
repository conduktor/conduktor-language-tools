import * as vscode from 'vscode';
import { catalogDocuments } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';

/** Context keys for the editor title: whether the active editor holds a Console resource, and its sync status. */
export class ActiveResourceContext implements vscode.Disposable {
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    const update = () => void this.update();
    this.listeners = [
      vscode.window.onDidChangeActiveTextEditor(update),
      vscode.workspace.onDidSaveTextDocument(update),
      sync.onDidChange(update),
      sessions.onDidChange(update),
    ];
    update();
  }

  private async update(): Promise<void> {
    const document = vscode.window.activeTextEditor?.document;
    const state = this.sessions.current();
    const holdsResource =
      !!document &&
      state.status === 'ready' &&
      document.languageId === 'yaml' &&
      catalogDocuments(document.getText(), state.spec.catalog).length > 0;
    await vscode.commands.executeCommand('setContext', 'conduktor.activeResource', holdsResource);
    await vscode.commands.executeCommand(
      'setContext',
      'conduktor.activeLocal',
      document ? this.sync.entryAt(document.uri)?.status : undefined,
    );
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
  }
}
