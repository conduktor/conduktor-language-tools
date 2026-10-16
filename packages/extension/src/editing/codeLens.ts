import * as vscode from 'vscode';
import { canChange, catalogDocuments, outcomeLabel } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { Action, ResourceController } from './resourceController';
import { variablesFor } from './variables';

export class ResourceCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly controller: ResourceController,
  ) {
    this.listeners = [
      sessions.onDidChange(() => this.changed.fire()),
      controller.onDidChangeResults(() => this.changed.fire()),
    ];
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const canApply = canChange(state.connection.mode);
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: variablesFor(document.uri) });
    const lineOf = (offset: number) => document.lineAt(document.positionAt(offset).line).range;
    const lens = (offset: number, title: string, command: string, ...args: unknown[]) =>
      new vscode.CodeLens(lineOf(offset), { title, command, arguments: [document.uri, ...args] });

    const lenses: vscode.CodeLens[] = [];
    if (documents.length > 1) {
      const first = documents[0]!.start;
      lenses.push(lens(first, `$(beaker) Dry run all (${documents.length})`, 'conduktor.dryRunFile'));
      if (canApply) lenses.push(lens(first, `$(cloud-upload) Apply all (${documents.length})`, 'conduktor.applyFile'));
    }
    for (const { index, start } of documents) {
      const last = this.controller.lastResult(document.uri, index);
      const suffix = (action: Action) => (last?.action === action ? ` · ${outcomeLabel(last.outcome)}` : '');
      lenses.push(lens(start, `$(beaker) Dry run${suffix('dry run')}`, 'conduktor.dryRunDocument', index));
      if (canApply)
        lenses.push(lens(start, `$(cloud-upload) Apply${suffix('applied')}`, 'conduktor.applyDocument', index));
      lenses.push(lens(start, '$(diff) Diff with Live', 'conduktor.diffWithLive', index));
    }
    return lenses;
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.changed.dispose();
  }
}
