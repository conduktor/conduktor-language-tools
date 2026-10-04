import * as vscode from 'vscode';
import { describeSources, referenceAt, valueAt, type Reference } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { ExplorerProvider } from '../explorer/explorerProvider';
import type { SyncFolder } from '../sync/syncFolder';
import { documentAt } from './documents';
import type { Names } from './names';

async function referenceUnder(
  sessions: SessionManager,
  document: vscode.TextDocument,
  position: vscode.Position,
): Promise<{ reference: Reference; range: vscode.Range } | undefined> {
  const state = sessions.current();
  if (state.status !== 'ready') return undefined;
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, state.spec.catalog);
  if (!parsed?.resource) return undefined;
  const at = valueAt(parsed.text, offset - parsed.start);
  const reference = at && referenceAt(parsed.resource, state.spec.catalog, at.path);
  if (!at || !reference) return undefined;
  const range = new vscode.Range(
    document.positionAt(parsed.start + at.start),
    document.positionAt(parsed.start + at.end),
  );
  return { reference, range };
}

export class ReferenceCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const found = await referenceUnder(this.sessions, document, position);
    const parents = found?.reference.parents;
    if (!found || !parents) return [];
    const { reference, range } = found;
    const { names } = await this.names.lookup(reference.kind, parents);
    // The range covers the quotes of a quoted value, and VS Code filters on the text typed from its start.
    const quote = /^["']/.exec(document.getText(range))?.[0] ?? '';
    return names.map(({ name, sources }) => {
      const item = new vscode.CompletionItem(name, vscode.CompletionItemKind.Reference);
      item.detail = `${reference.kind} · ${describeSources(sources)}`;
      item.range = range;
      if (quote) {
        item.filterText = `${quote}${name}`;
        item.insertText = `${quote}${name}${quote}`;
      }
      return item;
    });
  }
}

export class ReferenceDefinitionProvider implements vscode.DefinitionProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
    private readonly explorer: ExplorerProvider,
    private readonly names: Names,
  ) {}

  async provideDefinition(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Location[]> {
    const state = this.sessions.current();
    const found = await referenceUnder(this.sessions, document, position);
    if (state.status !== 'ready' || !found?.reference.parents || found.reference.value === '') return [];
    const { kind: kindName, parents, value } = found.reference;
    const local = this.sync.entryFor(kindName, parents, value);
    if (local) return [new vscode.Location(local.uri, new vscode.Position(0, 0))];
    const { names } = await this.names.lookup(kindName, parents);
    const kind = state.spec.catalog.latest(kindName);
    if (!kind || !names.some((n) => n.name === value && n.sources.includes('console'))) return [];
    const live = this.explorer.liveUri({ type: 'resource', kind, parents, name: value });
    return [new vscode.Location(live, new vscode.Position(0, 0))];
  }
}
