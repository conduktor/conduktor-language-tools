import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  catalogDocuments,
  planDocuments,
  splitPolicyMessages,
  upsertDocuments,
  type UpsertItem,
  type UpsertOutcome,
} from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { SessionManager, SessionState } from '../connections/session';
import type { Output } from '../output';
import type { Compare } from './compare';
import { includeReaderFor } from './includes';
import { outcomeLabel, summarise } from './summary';

export type Action = 'dry run' | 'applied';

export interface LastResult {
  action: Action;
  outcome: UpsertOutcome;
  start: number;
}

type Ready = Extract<SessionState, { status: 'ready' }>;

export class ResourceController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('conduktor');
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });
  private readonly results = new Map<string, Map<number, LastResult>>();
  private readonly resultsChanged = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeResults = this.resultsChanged.event;
  private readonly applied = new vscode.EventEmitter<void>();
  readonly onDidApply = this.applied.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly output: Output,
    private readonly compare: Compare,
    private readonly confirm: Confirm,
  ) {
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) this.clear(event.document.uri);
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.paint(editor))),
    ];
  }

  lastResult(uri: vscode.Uri, index: number): LastResult | undefined {
    return this.results.get(uri.toString())?.get(index);
  }

  dryRun(uri: vscode.Uri, index?: number): Promise<UpsertItem[] | undefined> {
    return this.run(uri, index, false);
  }

  apply(uri: vscode.Uri, index?: number): Promise<UpsertItem[] | undefined> {
    return this.run(uri, index, true);
  }

  async saveLive(text: string, liveName: string): Promise<void> {
    const state = this.ready(true);
    if (!state) throw new Error('This connection cannot change the Console; use "Conduktor: Change Mode".');
    const name = state.connection.name;
    const documents = catalogDocuments(text, state.spec.catalog, { env: process.env });
    if (documents.length !== 1) throw new Error('A live document holds exactly one Conduktor resource.');
    const [plan] = await upsertDocuments(state.client, state.spec.catalog, documents, { dryRun: true });
    if (plan?.outcome.status !== 'ok') throw new Error(failureOf(plan?.outcome, 'Dry run failed'));
    if (plan.outcome.result === 'NotChanged') return;

    const resource = plan.document.resource!;
    const subject = `${resource.kind} ${resource.metadata.name}`;
    const renamed = resource.metadata.name !== liveName;
    const detail = `Dry run: ${outcomeLabel(plan.outcome)}${renamed ? `. The name changed, so this creates ${subject}.` : ''}`;
    const choice = await this.confirm(`Save ${subject} to ${name}?`, detail, 'Apply', 'Show Diff');
    if (choice === 'Show Diff') {
      await this.compare.diffResource(resource);
      throw new Error('Not saved: review the diff, then save again to apply.');
    }
    if (choice !== 'Apply') throw new Error('Not saved.');

    const [result] = await upsertDocuments(state.client, state.spec.catalog, documents, { dryRun: false });
    if (result?.outcome.status !== 'ok') throw new Error(failureOf(result?.outcome, 'Apply failed'));
    this.output.info(`Applied to ${name}: ${subject} ${result.outcome.result}`);
    void vscode.window.showInformationMessage(`Saved ${subject} to ${name}: ${outcomeLabel(result.outcome)}`);
    this.applied.fire();
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.diagnostics.dispose();
    this.decoration.dispose();
    this.resultsChanged.dispose();
    this.applied.dispose();
  }

  private async run(uri: vscode.Uri, index: number | undefined, apply: boolean): Promise<UpsertItem[] | undefined> {
    const state = this.ready(apply);
    if (!state) return undefined;
    const document = await vscode.workspace.openTextDocument(uri);
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: process.env }).filter(
      (d) => index === undefined || d.index === index,
    );
    if (documents.length === 0) {
      void vscode.window.showWarningMessage(`No Conduktor resources to ${apply ? 'apply' : 'dry-run'} in this file.`);
      return [];
    }

    const name = state.connection.name;
    const readInclude = includeReaderFor(uri);
    const plan = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Dry run on ${name}` },
      () => planDocuments(state.client, state.spec.catalog, documents, { readInclude }),
    );
    this.record(document, plan, 'dry run');
    const summary = summarise(name, plan);
    this.output.info(summary.text);
    this.shellHint(uri, apply);

    if (!apply || summary.failed > 0) {
      this.notify(summary.text, summary.failed > 0);
      return plan;
    }
    if (plan.every((item) => item.outcome.status === 'ok' && item.outcome.result === 'NotChanged')) {
      void vscode.window.showInformationMessage(`Nothing to apply on ${name}: everything is unchanged.`);
      return plan;
    }
    const pending = plan.filter((item) => item.outcome.status === 'pending').length;
    const detail =
      pending > 0
        ? `${summary.text}.\n\n${pending} can only be checked once the resources before them exist. Resources are applied one at a time, in order, stopping at the first failure.`
        : summary.text;
    const choice = await this.confirm(`Apply to ${name}?`, detail, 'Apply');
    if (choice !== 'Apply') return plan;

    const items = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: `Applying to ${name}` },
      () =>
        upsertDocuments(state.client, state.spec.catalog, documents, { dryRun: false, readInclude, stopOnError: true }),
    );
    this.record(document, items, 'applied');
    const applied = summarise(name, items, 'Applied to');
    this.output.info(applied.text);
    this.notify(applied.text, applied.failed > 0);
    this.applied.fire();
    return items;
  }

  private ready(apply: boolean): Ready | undefined {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return undefined;
    }
    const { name, mode } = state.connection;
    if (mode === 'read-only' || (apply && mode !== 'apply')) {
      void vscode.window.showWarningMessage(
        `${name} is in ${mode} mode. Use "Conduktor: Change Mode" to ${apply ? 'apply' : 'dry-run'}.`,
      );
      return undefined;
    }
    return state;
  }

  private shellHint(uri: vscode.Uri, apply: boolean): void {
    const folder = vscode.workspace.getWorkspaceFolder(uri);
    if (!folder || uri.scheme !== 'file') return;
    const file = path.relative(folder.uri.fsPath, uri.fsPath);
    this.output.info(`Same from a shell: conduktor apply -f ${file}${apply ? '' : ' --dry-run'}`);
  }

  private notify(text: string, failed: boolean): void {
    if (!failed) {
      void vscode.window.showInformationMessage(text);
      return;
    }
    void vscode.window.showWarningMessage(text, 'Show Output').then((choice) => {
      if (choice) this.output.show();
    });
  }

  private record(document: vscode.TextDocument, items: readonly UpsertItem[], action: Action): void {
    const key = document.uri.toString();
    const byIndex = this.results.get(key) ?? new Map<number, LastResult>();
    for (const item of items)
      byIndex.set(item.document.index, { action, outcome: item.outcome, start: item.document.start });
    this.results.set(key, byIndex);

    const diagnostics: vscode.Diagnostic[] = [];
    for (const { outcome, start } of byIndex.values()) {
      const add = (message: string, severity: vscode.DiagnosticSeverity) => {
        const diagnostic = new vscode.Diagnostic(lineAt(document, start), message, severity);
        diagnostic.source = 'Conduktor';
        diagnostics.push(diagnostic);
      };
      if (outcome.status === 'error') {
        splitPolicyMessages(outcome.message).forEach((message) => add(message, vscode.DiagnosticSeverity.Error));
      } else if (outcome.status === 'pending') {
        add(
          `Checked when applied: waits for ${outcome.waitingFor.join(', ')}, created earlier in this file. The Console says: ${outcome.message}`,
          vscode.DiagnosticSeverity.Warning,
        );
      }
    }
    this.diagnostics.set(document.uri, diagnostics);
    this.paintAll(document.uri);
    this.resultsChanged.fire(document.uri);
  }

  private clear(uri: vscode.Uri): void {
    if (!this.results.delete(uri.toString())) return;
    this.diagnostics.delete(uri);
    this.paintAll(uri);
    this.resultsChanged.fire(uri);
  }

  private paintAll(uri: vscode.Uri): void {
    vscode.window.visibleTextEditors
      .filter((editor) => editor.document.uri.toString() === uri.toString())
      .forEach((editor) => this.paint(editor));
  }

  private paint(editor: vscode.TextEditor): void {
    const byIndex = this.results.get(editor.document.uri.toString());
    const decorations = [...(byIndex?.values() ?? [])]
      .filter((result) => result.outcome.status !== 'error')
      .map((result) => ({
        range: lineAt(editor.document, result.start),
        renderOptions: { after: { contentText: `${outcomeLabel(result.outcome)} (${result.action})` } },
      }));
    editor.setDecorations(this.decoration, decorations);
  }
}

function failureOf(outcome: UpsertOutcome | undefined, fallback: string): string {
  return outcome && 'message' in outcome ? outcome.message : fallback;
}

function lineAt(document: vscode.TextDocument, offset: number): vscode.Range {
  return document.lineAt(document.positionAt(offset).line).range;
}
