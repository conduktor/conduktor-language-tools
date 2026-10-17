import * as vscode from 'vscode';
import {
  apiVersionFixes,
  nameMatches,
  PARENT_KINDS,
  parsedDocuments,
  referenceProblems,
  referencingKinds,
  renameEdits,
  renameTarget,
  resourceSymbol,
  resourceSymbols,
  topicConfigProblems,
  type Fix,
  type KindCatalog,
  type ReferenceTarget,
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { rangeIn } from './diagnostics';
import { repoRange, type Names, type RepoDocument } from './names';
import { nameLookup } from './referenceDiagnostics';

const PARENTS = new Set(Object.values(PARENT_KINDS));
// Enough for a search box; past it, the first ones.
const MAX_SYMBOLS = 500;

const symbolKind = (kind: string) => (PARENTS.has(kind) ? vscode.SymbolKind.Namespace : vscode.SymbolKind.Object);
const between = (document: vscode.TextDocument, start: number, end: number) =>
  new vscode.Range(document.positionAt(start), document.positionAt(end));

/** A file's resources as its outline, with or without a Console; the repository's in Go to Symbol in Workspace. */
export class ResourceSymbols implements vscode.DocumentSymbolProvider, vscode.WorkspaceSymbolProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {}

  provideDocumentSymbols(document: vscode.TextDocument): vscode.DocumentSymbol[] {
    const catalog = this.sessions.loadedSpec()?.catalog;
    if (!catalog) return [];
    return resourceSymbols(document.getText(), catalog).map(
      (symbol) =>
        new vscode.DocumentSymbol(
          symbol.name,
          symbol.detail,
          symbolKind(symbol.kind),
          between(document, symbol.start, symbol.end),
          between(document, symbol.nameStart, symbol.nameEnd),
        ),
    );
  }

  async provideWorkspaceSymbols(query: string): Promise<vscode.SymbolInformation[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const found: vscode.SymbolInformation[] = [];
    for (const kind of state.spec.catalog.kindNames())
      for (const document of await this.names.repoDocuments(kind)) {
        const symbol = resourceSymbol(document, state.spec.catalog);
        if (!symbol || !nameMatches(symbol.name, query)) continue;
        const range = repoRange(document, symbol.nameStart - document.start, symbol.nameEnd - document.start);
        const location = new vscode.Location(document.uri, range);
        found.push(new vscode.SymbolInformation(symbol.name, symbolKind(symbol.kind), symbol.detail, location));
        if (found.length === MAX_SYMBOLS) return found;
      }
    return found;
  }
}

/** Renames a resource, from its name or a reference to it, in every repository file that names it. */
export class ResourceRename implements vscode.RenameProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { range: vscode.Range; placeholder: string } {
    const { found } = this.targetAt(document, position);
    return { range: between(document, found.start, found.end), placeholder: found.target.name };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
  ): Promise<vscode.WorkspaceEdit> {
    const { found, catalog } = this.targetAt(document, position);
    if (newName.trim() === '' || /[\r\n]/.test(newName)) throw new Error('A name is one line of text.');
    const documents = await this.documents(document, found.target, catalog);
    const { edits, patterns } = renameEdits(found.target, newName, documents, catalog);
    const edit = new vscode.WorkspaceEdit();
    for (const { index, edit: change } of edits) {
      const where = documents[index];
      if (where) edit.replace(where.uri, repoRange(where, change.start, change.end), change.newText);
    }
    void this.renamed(found.target, newName, patterns);
    return edit;
  }

  private targetAt(document: vscode.TextDocument, position: vscode.Position) {
    const state = this.sessions.current();
    if (state.status !== 'ready')
      throw new Error('Conduktor: connect to a Console first; renaming reads your files with its schema.');
    const found = renameTarget(document.getText(), document.offsetAt(position), state.spec.catalog);
    if (!found) throw new Error('Conduktor renames a resource from its name, or from a reference to one.');
    return { found, catalog: state.spec.catalog };
  }

  // The repository's documents that can define or name the target, and the file renamed in, wherever it is.
  private async documents(
    document: vscode.TextDocument,
    target: ReferenceTarget,
    catalog: KindCatalog,
  ): Promise<RepoDocument[]> {
    const found: RepoDocument[] = [];
    for (const kind of new Set([target.kind, ...referencingKinds(target.kind)]))
      found.push(...(await this.names.repoDocuments(kind)));
    if (found.some((d) => d.uri.toString() === document.uri.toString())) return found;
    const fullText = document.getText();
    const own = parsedDocuments(fullText, catalog).flatMap(({ start, text, resource }) =>
      resource ? [{ uri: document.uri, start, text, fullText, resource }] : [],
    );
    return [...found, ...own];
  }

  /** What a rename in the files leaves as it was: the Console's resource, and the patterns that covered it. */
  private async renamed(target: ReferenceTarget, newName: string, patterns: number): Promise<void> {
    const state = this.sessions.current();
    const { names: known } = await this.names.lookup(target.kind, target.parents);
    const notes = [
      state.status === 'ready' &&
        known.find((n) => n.name === target.name)?.sources.includes('console') &&
        `${state.connection.name} still has ${target.kind} '${target.name}': applying creates '${newName}' beside it.`,
      patterns > 0 &&
        `${patterns === 1 ? 'A pattern or wildcard' : `${patterns} patterns or wildcards`} covering '${target.name}' stay as written.`,
    ].filter(Boolean);
    if (notes.length > 0) void vscode.window.showInformationMessage(`Renamed in your files only. ${notes.join(' ')}`);
  }
}

/**
 * Quick fixes for the extension's own problems, and a missing apiVersion. VS Code hands code actions copies of the
 * diagnostics, so a diagnostic's fixes are found again by checking its resource, matching range and message.
 */
export class QuickFixes implements vscode.CodeActionProvider {
  static readonly metadata: vscode.CodeActionProviderMetadata = {
    providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
  };

  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range,
    context: vscode.CodeActionContext,
  ): Promise<vscode.CodeAction[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const { catalog } = state.spec;
    const ours = context.diagnostics.filter((d) => d.source === 'Conduktor');
    const actions: vscode.CodeAction[] = [];
    const text = document.getText();
    for (const parsed of ours.length > 0 ? parsedDocuments(text, catalog) : []) {
      const here = ours.filter((d) => rangeIn(document, parsed, 0, parsed.text.length).contains(d.range));
      if (!parsed.resource || here.length === 0) continue;
      const problems = [
        ...(parsed.resource.kind === 'Topic' ? topicConfigProblems(parsed.text, parsed.resource) : []),
        ...(await referenceProblems(
          parsed.text,
          parsed.resource,
          catalog,
          state.connection.name,
          nameLookup(this.names),
        )),
      ];
      for (const diagnostic of here)
        for (const { start, end, message, fixes } of problems)
          if (message === diagnostic.message && rangeIn(document, parsed, start, end).isEqual(diagnostic.range))
            actions.push(
              ...fixes.map((fix) => this.action(document, parsed.start, fix, fixes.length === 1, diagnostic)),
            );
    }
    const offset = document.offsetAt(range.start);
    for (const { start, end, fix } of apiVersionFixes(text, catalog))
      if (start <= offset && offset <= end) actions.push(this.action(document, 0, fix, true));
    return actions;
  }

  private action(
    document: vscode.TextDocument,
    offset: number,
    { title, edit }: Fix,
    preferred: boolean,
    diagnostic?: vscode.Diagnostic,
  ): vscode.CodeAction {
    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(document.uri, between(document, offset + edit.start, offset + edit.end), edit.newText);
    action.isPreferred = preferred;
    if (diagnostic) action.diagnostics = [diagnostic];
    return action;
  }
}
