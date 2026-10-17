import * as vscode from 'vscode';
import { parsedDocuments, referenceProblems, type NameLookup } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { Names } from './names';

export class ReferenceDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('conduktor-references');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {
    const all = () => vscode.workspace.textDocuments.forEach((d) => this.schedule(d));
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
      // A change in one document can resolve or break references in the others.
      vscode.workspace.onDidChangeTextDocument((e) => e.document.languageId === 'yaml' && all()),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
      sessions.onDidChange(all),
      names.onDidChange(all),
    ];
    all();
  }

  private schedule(document: vscode.TextDocument): void {
    if (document.languageId !== 'yaml') return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => void this.check(document), 300),
    );
  }

  private async check(document: vscode.TextDocument): Promise<void> {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      this.collection.delete(document.uri);
      return;
    }
    const text = document.getText();
    const names: NameLookup = {
      lookup: (kind, parents) => this.names.lookup(kind, parents),
      instances: async () => [
        ...((await this.names.resources('ApplicationInstance', [])) ?? []),
        ...(await this.names.repoResources('ApplicationInstance')),
      ],
    };
    const diagnostics: vscode.Diagnostic[] = [];
    for (const parsed of parsedDocuments(text, state.spec.catalog)) {
      if (!parsed.resource) continue;
      const problems = await referenceProblems(
        parsed.text,
        parsed.resource,
        state.spec.catalog,
        state.connection.name,
        names,
      );
      for (const { start, end, message, severity } of problems) {
        const range = new vscode.Range(
          document.positionAt(parsed.start + start),
          document.positionAt(parsed.start + end),
        );
        const diagnostic = new vscode.Diagnostic(range, message, SEVERITIES[severity]);
        diagnostic.source = 'Conduktor';
        diagnostics.push(diagnostic);
      }
    }
    if (!document.isClosed && document.getText() === text) this.collection.set(document.uri, diagnostics);
  }

  dispose(): void {
    for (const l of this.listeners) l.dispose();
    this.timers.forEach((t) => clearTimeout(t));
    this.collection.dispose();
  }
}

const SEVERITIES = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
} as const;
