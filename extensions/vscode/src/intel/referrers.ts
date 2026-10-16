import * as vscode from 'vscode';
import {
  rangeOf,
  referencingKinds,
  referrersOf,
  valueAt,
  type Resource,
  documentAt,
  parsedDocuments,
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { Names, RepoDocument } from './names';
import type { SyncFolder } from '../sync/syncFolder';

export class ReferrersProvider implements vscode.ReferenceProvider, vscode.CodeLensProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
    sync: SyncFolder,
  ) {
    // Counts come from the repository alone: Console list fetches change nothing here.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => this.changed.fire(), 500);
    };
    this.listeners = [
      sync.onDidChange(refresh),
      sessions.onDidChange(refresh),
      vscode.workspace.onDidChangeTextDocument((e) => e.document.languageId === 'yaml' && refresh()),
    ];
  }

  async provideReferences(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const offset = document.offsetAt(position);
    const parsed = documentAt(document.getText(), offset, state.spec.catalog);
    const at = parsed && valueAt(parsed.text, offset - parsed.start);
    if (!parsed?.resource || at?.path.join('.') !== 'metadata.name') return [];
    return this.locations(parsed.resource);
  }

  async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const lenses: vscode.CodeLens[] = [];
    for (const parsed of parsedDocuments(document.getText(), state.spec.catalog)) {
      if (!parsed.resource) continue;
      const locations = await this.locations(parsed.resource);
      if (locations.length === 0) continue;
      const name = rangeOf(parsed.text, ['metadata', 'name']);
      const position = document.positionAt(parsed.start + (name?.[0] ?? 0));
      lenses.push(
        new vscode.CodeLens(document.lineAt(position.line).range, {
          title: `$(references) referenced by ${locations.length}`,
          command: 'editor.action.showReferences',
          arguments: [document.uri, position, locations],
        }),
      );
    }
    return lenses;
  }

  private async locations(resource: Resource): Promise<vscode.Location[]> {
    const state = this.sessions.current();
    const kind = state.status === 'ready' ? state.spec.catalog.latest(resource.kind) : undefined;
    if (state.status !== 'ready' || !kind || typeof resource.metadata?.name !== 'string') return [];
    const parents = kind.parentPathParams.map((param) => String(resource.metadata[param] ?? ''));
    const target = { kind: kind.kind, parents, name: resource.metadata.name };
    const documents: RepoDocument[] = [];
    for (const referencing of referencingKinds(kind.kind))
      documents.push(...(await this.names.repoDocuments(referencing)));
    const referrers = referrersOf(
      target,
      documents.map((d) => d.resource),
      state.spec.catalog,
    );
    return referrers.flatMap(({ index, reference }) => {
      const document = documents[index]!;
      const range = rangeOf(document.text, reference.path);
      return range ? [new vscode.Location(document.uri, rangeIn(document, range))] : [];
    });
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.changed.dispose();
  }
}

function rangeIn(document: RepoDocument, [start, end]: [number, number]): vscode.Range {
  const position = (offset: number) => {
    const before = document.fullText.slice(0, document.start + offset);
    const line = before.split('\n').length - 1;
    return new vscode.Position(line, before.length - before.lastIndexOf('\n') - 1);
  };
  return new vscode.Range(position(start), position(end));
}
