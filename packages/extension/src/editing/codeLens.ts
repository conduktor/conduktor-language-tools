import * as vscode from 'vscode';
import { catalogDocuments } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';

export class ResourceCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly sessionListener: vscode.Disposable;

  constructor(private readonly sessions: SessionManager) {
    this.sessionListener = sessions.onDidChange(() => this.changed.fire());
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const state = this.sessions.current();
    if (state.status !== 'ready' || state.connection.mode === 'read-only') return [];
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: process.env });
    const lineOf = (offset: number) => document.lineAt(document.positionAt(offset).line).range;
    const lenses = documents.map(
      (d) =>
        new vscode.CodeLens(lineOf(d.start), {
          title: '$(beaker) Dry run',
          command: 'conduktor.dryRunDocument',
          arguments: [document.uri, d.index],
        }),
    );
    if (documents.length > 1) {
      lenses.unshift(
        new vscode.CodeLens(lineOf(documents[0]!.start), {
          title: `$(beaker) Dry run all (${documents.length})`,
          command: 'conduktor.dryRunFile',
          arguments: [document.uri],
        }),
      );
    }
    return lenses;
  }

  dispose(): void {
    this.sessionListener.dispose();
    this.changed.dispose();
  }
}
