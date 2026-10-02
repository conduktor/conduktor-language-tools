import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  catalogDocuments,
  dryRunDocuments,
  splitPolicyMessages,
  type DryRunItem,
  type UpsertResult,
} from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { Output } from '../output';
import { summarise } from './summary';

const RESULT_LABELS: Record<UpsertResult, string> = {
  Created: '+ Created',
  Updated: '~ Updated',
  NotChanged: '= NotChanged',
};

export class DryRunController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('conduktor');
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });
  private readonly decorations = new Map<string, vscode.DecorationOptions[]>();
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly output: Output,
  ) {
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) this.clear(event.document.uri);
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.paint(editor))),
    ];
  }

  async run(uri: vscode.Uri, index?: number): Promise<DryRunItem[] | undefined> {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return undefined;
    }
    if (state.connection.mode === 'read-only') {
      void vscode.window.showWarningMessage(`${state.connection.name} is read-only.`);
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: process.env }).filter(
      (d) => index === undefined || d.index === index,
    );
    if (documents.length === 0) return [];

    const folder = vscode.workspace.getWorkspaceFolder(uri);
    const readInclude =
      folder && uri.scheme === 'file'
        ? (file: string) => readFileSync(path.resolve(folder.uri.fsPath, file), 'utf8')
        : undefined;
    const items = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Dry run on ${state.connection.name}` },
      () => dryRunDocuments(state.client, state.spec.catalog, documents, { readInclude }),
    );

    this.show(document, items);
    const summary = summarise(state.connection.name, items);
    this.output.info(summary.text);
    if (folder && uri.scheme === 'file') {
      this.output.info(
        `Same check from a shell: conduktor apply -f ${path.relative(folder.uri.fsPath, uri.fsPath)} --dry-run`,
      );
    }
    if (summary.failed > 0) {
      void vscode.window.showWarningMessage(summary.text, 'Show Output').then((choice) => {
        if (choice) this.output.show();
      });
    } else {
      void vscode.window.showInformationMessage(summary.text);
    }
    return items;
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.diagnostics.dispose();
    this.decoration.dispose();
  }

  private show(document: vscode.TextDocument, items: readonly DryRunItem[]): void {
    const diagnostics: vscode.Diagnostic[] = [];
    const decorations: vscode.DecorationOptions[] = [];
    for (const { document: resourceDocument, outcome } of items) {
      const line = document.lineAt(document.positionAt(resourceDocument.start).line).range;
      if (outcome.status === 'ok') {
        decorations.push({
          range: line,
          renderOptions: { after: { contentText: `${RESULT_LABELS[outcome.result]} (dry run)` } },
        });
        continue;
      }
      for (const message of splitPolicyMessages(outcome.message)) {
        const diagnostic = new vscode.Diagnostic(line, message, vscode.DiagnosticSeverity.Error);
        diagnostic.source = 'Conduktor';
        diagnostics.push(diagnostic);
      }
    }
    this.diagnostics.set(document.uri, diagnostics);
    this.decorations.set(document.uri.toString(), decorations);
    this.paintAll(document.uri);
  }

  private clear(uri: vscode.Uri): void {
    if (!this.decorations.has(uri.toString()) && !this.diagnostics.has(uri)) return;
    this.diagnostics.delete(uri);
    this.decorations.delete(uri.toString());
    this.paintAll(uri);
  }

  private paintAll(uri: vscode.Uri): void {
    vscode.window.visibleTextEditors
      .filter((editor) => editor.document.uri.toString() === uri.toString())
      .forEach((editor) => this.paint(editor));
  }

  private paint(editor: vscode.TextEditor): void {
    editor.setDecorations(this.decoration, this.decorations.get(editor.document.uri.toString()) ?? []);
  }
}
