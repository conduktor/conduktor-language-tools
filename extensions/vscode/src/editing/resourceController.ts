import * as path from 'node:path';
import * as vscode from 'vscode';
import {
  canChange,
  catalogDocuments,
  outcomeLabel,
  outcomeProblems,
  planDocuments,
  summarise,
  upsertDocuments,
  type UpsertItem,
  type UpsertOutcome,
} from '@conduktor/core';
import type { Confirm } from '../confirm';
import type { Ready, SessionManager } from '../connections/session';
import type { Output } from '../output';
import type { Compare } from './compare';
import { conduktorDiagnostic } from '../intel/diagnostics';
import { isLiveScheme, parseLiveUriParts } from '../liveFs/uris';
import { appliedText } from './applied';
import { includeReaderFor } from './includes';
import { variablesFor } from './variables';

export type Action = 'dry run' | 'applied';

export interface LastResult {
  action: Action;
  outcome: UpsertOutcome;
  start: number;
}

export interface AppliedEvent {
  uri?: vscode.Uri;
  appliedText?: string | undefined;
  items: readonly UpsertItem[];
}

export class ResourceController implements vscode.Disposable {
  private readonly diagnostics = vscode.languages.createDiagnosticCollection('conduktor');
  private readonly decoration = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });
  private readonly results = new Map<string, Map<number, LastResult>>();
  private readonly resultsChanged = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChangeResults = this.resultsChanged.event;
  private readonly applied = new vscode.EventEmitter<AppliedEvent>();
  readonly onDidApply = this.applied.event;
  private readonly listeners: vscode.Disposable[];
  private answering: string | undefined;
  // What each validated folder creates, by folder path: a file of it checked on its own may be waiting for them.
  private readonly folderNames = new Map<string, string[]>();

  constructor(
    private readonly sessions: SessionManager,
    private readonly output: Output,
    private readonly compare: Compare,
    private readonly confirm: Confirm,
    private readonly foreignEnvironment: (uri: vscode.Uri) => string | undefined,
  ) {
    this.listeners = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) this.clear(event.document.uri);
      }),
      vscode.window.onDidChangeVisibleTextEditors((editors) => editors.forEach((editor) => this.paint(editor))),
      // Results are one Console's answers: another connection, or another URL, makes them stale. A mode change or a
      // reload of the same connection does not.
      sessions.onDidChange((state) => {
        const answering = state.status === 'none' ? undefined : `${state.connection.id} ${state.connection.url}`;
        if (answering === this.answering) return;
        this.answering = answering;
        this.folderNames.clear();
        [...this.results.keys()].forEach((key) => this.clear(vscode.Uri.parse(key)));
      }),
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

  hasResults(uri: vscode.Uri): boolean {
    return this.results.has(uri.toString());
  }

  /**
   * A dry run with nothing to notify: the results go to Problems and the editor, as a Dry run's do. `willExist` names
   * what other local files create, so a resource waiting for one of them is pending rather than failed.
   */
  async validate(uri: vscode.Uri, willExist: readonly string[] = []): Promise<UpsertItem[] | undefined> {
    const state = this.sessions.current();
    if (state.status !== 'ready' || isLiveScheme(uri.scheme) || this.foreignEnvironment(uri) !== undefined)
      return undefined;
    const document = await vscode.workspace.openTextDocument(uri);
    const version = document.version;
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: variablesFor(uri) });
    if (documents.length === 0) return [];
    // Another connection's answer, or one for text edited since, would land on the wrong file or lines.
    const stale = () => this.sessions.current() !== state || document.version !== version;
    const inFolders = [...this.folderNames].filter(([folder]) => isInside(uri.fsPath, folder)).flatMap(([, n]) => n);
    const plan = await planDocuments(state.client, state.spec.catalog, documents, {
      readInclude: includeReaderFor(uri),
      willExist: [...willExist, ...inFolders],
      cancelled: stale,
    });
    if (stale()) return undefined;
    this.record(uri, document.getText(), plan, 'dry run', 'in your local files');
    return plan;
  }

  async saveLive(text: string, liveName: string): Promise<void> {
    const state = this.ready(true);
    if (!state) throw new Error('This connection cannot change the Console; use "Conduktor: Change Mode".');
    const name = state.connection.name;
    const documents = catalogDocuments(text, state.spec.catalog, { env: process.env });
    if (documents.length !== 1) throw new Error('A live document holds exactly one Conduktor resource.');
    const [plan] = await upsertDocuments(state.client, state.spec.catalog, documents, { dryRun: true });
    const resource = plan?.document.resource;
    if (plan?.outcome.status !== 'ok' || !resource) throw new Error(failureOf(plan?.outcome, 'Dry run failed'));
    if (plan.outcome.result === 'NotChanged') return;

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
    this.applied.fire({ items: [result] });
  }

  dispose(): void {
    for (const listener of this.listeners) listener.dispose();
    this.diagnostics.dispose();
    this.decoration.dispose();
    this.resultsChanged.dispose();
    this.applied.dispose();
  }

  private async run(uri: vscode.Uri, index: number | undefined, apply: boolean): Promise<UpsertItem[] | undefined> {
    const state = this.ready(apply);
    if (!state) return undefined;
    // A live document names its connection; it is never dry-run or applied on another one.
    const owner = isLiveScheme(uri.scheme) ? parseLiveUriParts(uri.authority, uri.path)?.connectionId : undefined;
    if (owner !== undefined && owner !== state.connection.id) {
      void vscode.window.showWarningMessage(
        `This document belongs to another connection; switch to it to ${apply ? 'apply' : 'dry-run'} it.`,
      );
      return undefined;
    }
    const foreign = this.foreignEnvironment(uri);
    if (foreign !== undefined) {
      void vscode.window.showWarningMessage(
        `This file belongs to environment ${foreign}; connect to its Console to ${apply ? 'apply' : 'dry-run'} it.`,
      );
      return undefined;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const text = document.getText();
    const inFile = catalogDocuments(text, state.spec.catalog, { env: variablesFor(uri) });
    const documents = inFile.filter((d) => index === undefined || d.index === index);
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
    this.record(uri, text, plan, 'dry run');
    const summary = summarise(name, plan);
    this.output.info(summary.text);
    this.shellHint(uri, apply);

    if (!apply || summary.failed > 0) {
      this.output.report(summary.text, summary.failed > 0);
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
    this.record(uri, text, items, 'applied');
    const applied = summarise(name, items, 'Applied to');
    this.output.info(applied.text);
    this.output.report(applied.text, applied.failed > 0);
    this.applied.fire({ uri, appliedText: appliedText(text, inFile.length, items), items });
    return items;
  }

  private ready(apply: boolean): Ready | undefined {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return undefined;
    }
    const { name, mode } = state.connection;
    if (apply && !canChange(mode)) {
      void vscode.window.showWarningMessage(`${name} is in prod mode. Use "Conduktor: Change Mode" to apply.`);
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

  /** A folder's dry run, on one of its files: what is pending waits for resources elsewhere in the folder. */
  recordFolderResults(uri: vscode.Uri, text: string, items: readonly UpsertItem[]): void {
    this.record(uri, text, items, 'dry run', 'in this folder');
  }

  /** The names a folder's run found it would create, for its files' later checks on their own. */
  rememberFolder(folder: vscode.Uri, creates: readonly string[]): void {
    this.folderNames.set(folder.fsPath, [...creates]);
  }

  private record(
    uri: vscode.Uri,
    text: string,
    items: readonly UpsertItem[],
    action: Action,
    where = 'earlier in this file',
  ): void {
    const key = uri.toString();
    const byIndex = this.results.get(key) ?? new Map<number, LastResult>();
    for (const item of items)
      byIndex.set(item.document.index, { action, outcome: item.outcome, start: item.document.start });
    this.results.set(key, byIndex);

    const diagnostics = [...byIndex.values()].flatMap(({ outcome, start }) =>
      outcomeProblems(outcome, where).map(({ message, severity }) =>
        conduktorDiagnostic(lineRange(text, start), message, severity),
      ),
    );
    this.diagnostics.set(uri, diagnostics);
    this.paintAll(uri);
    this.resultsChanged.fire(uri);
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

function isInside(file: string, folder: string): boolean {
  const relative = path.relative(folder, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// The line holding an offset, from the text alone: a folder's files are checked without opening them.
function lineRange(text: string, offset: number): vscode.Range {
  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const end = text.indexOf('\n', offset);
  const line = text.slice(0, start).split('\n').length - 1;
  return new vscode.Range(line, 0, line, text.slice(start, end === -1 ? text.length : end).replace(/\r$/, '').length);
}
