import * as vscode from 'vscode';
import { findReferences, matcher, rangeOf, parsedDocuments } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { lensTitle } from './lensTitle';
import type { Names } from './names';

export class MatchLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {
    this.listeners = [sessions.onDidChange(() => this.changed.fire()), names.onDidChange(() => this.changed.fire())];
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const lenses: vscode.CodeLens[] = [];
    for (const parsed of parsedDocuments(document.getText(), state.spec.catalog)) {
      for (const reference of findReferences(parsed.resource, state.spec.catalog)) {
        const { pattern, parents } = reference;
        if (!pattern || !parents) continue;
        const { names, checked } = await this.names.lookup(reference.kind, parents);
        if (!checked) continue;
        const matches = reference.wildcard
          ? names
          : names.filter((n) => matcher(pattern.reading, pattern.type, reference.value)(n.name));
        const offset = parsed.start + (rangeOf(parsed.text, reference.path)?.[0] ?? 0);
        lenses.push(
          new vscode.CodeLens(document.lineAt(document.positionAt(offset).line).range, {
            title: lensTitle(reference.kind, reference, matches),
            command: 'conduktor.showMatches',
            arguments: [reference.kind, parents, matches.map((m) => m.name)],
          }),
        );
      }
    }
    return lenses;
  }

  dispose(): void {
    for (const l of this.listeners) l.dispose();
    this.changed.dispose();
  }
}
