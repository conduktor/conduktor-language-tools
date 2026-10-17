import {
  apiVersionFixes,
  nameMatches,
  PARENT_KINDS,
  renameEdits,
  renameTarget,
  resourceSymbol,
  resourceSymbols,
  type Fix,
  type KindCatalog,
  type ReferenceTarget,
} from '@conduktor/core';
import {
  CodeActionKind,
  SymbolKind,
  type CodeAction,
  type Diagnostic,
  type DocumentSymbol,
  type Position,
  type Range,
  type SymbolInformation,
  type TextEdit,
  type WorkspaceEdit,
} from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { Located } from './workspaceIndex';

const PARENTS = new Set(Object.values(PARENT_KINDS));
// Enough for a search box; past it, the first ones.
const MAX_SYMBOLS = 500;

const symbolKind = (kind: string) => (PARENTS.has(kind) ? SymbolKind.Namespace : SymbolKind.Object);

/** A file's resources, as its outline. */
export function documentSymbols(document: TextDocument, catalog: KindCatalog): DocumentSymbol[] {
  return resourceSymbols(document.getText(), catalog).map((symbol) => ({
    name: symbol.name,
    detail: symbol.detail,
    kind: symbolKind(symbol.kind),
    range: rangeOf(document, symbol.start, symbol.end),
    selectionRange: rangeOf(document, symbol.nameStart, symbol.nameEnd),
  }));
}

/** The workspace's resources whose name the query finds. */
export function workspaceSymbols(
  query: string,
  located: readonly Located[],
  catalog: KindCatalog,
): SymbolInformation[] {
  const found: SymbolInformation[] = [];
  for (const entry of located) {
    const symbol = resourceSymbol(entry, catalog);
    if (!symbol || !nameMatches(symbol.name, query)) continue;
    found.push({
      name: symbol.name,
      kind: symbolKind(symbol.kind),
      containerName: symbol.detail,
      location: { uri: entry.document.uri, range: rangeOf(entry.document, symbol.nameStart, symbol.nameEnd) },
    });
    if (found.length === MAX_SYMBOLS) break;
  }
  return found;
}

/** What a rename at the position renames, and the range of the value it starts from. */
export function renameTargetAt(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
): { target: ReferenceTarget; range: Range } | undefined {
  const found = renameTarget(document.getText(), document.offsetAt(position), catalog);
  return found && { target: found.target, range: rangeOf(document, found.start, found.end) };
}

/** The workspace edit renaming the target, and how many patterns or wildcards covering it stay as written. */
export function renameEdit(
  target: ReferenceTarget,
  newName: string,
  located: readonly Located[],
  catalog: KindCatalog,
): { edit: WorkspaceEdit; patterns: number } {
  const { edits, patterns } = renameEdits(target, newName, located, catalog);
  const changes: Record<string, TextEdit[]> = {};
  for (const { index, edit } of edits) {
    const entry = located[index];
    if (entry) (changes[entry.document.uri] ??= []).push(lspEdit(entry.document, entry.start, edit));
  }
  return { edit: { changes }, patterns };
}

// The fixes of the diagnostics this server publishes, kept beside them rather than sent to the editor.
const FIXES = new WeakMap<Diagnostic, { title: string; edit: TextEdit }[]>();

/** The diagnostic, with core's fixes for the resource starting at `offset` in the document. */
export function withFixes(diagnostic: Diagnostic, document: TextDocument, offset: number, fixes: readonly Fix[]) {
  if (fixes.length > 0)
    FIXES.set(
      diagnostic,
      fixes.map(({ title, edit }) => ({ title, edit: lspEdit(document, offset, edit) })),
    );
  return diagnostic;
}

/** The quick fixes on the lines of a range: those of the published diagnostics there, and a missing apiVersion. */
export function quickFixes(
  document: TextDocument,
  range: Range,
  published: readonly Diagnostic[],
  catalog: KindCatalog,
): CodeAction[] {
  const action = (title: string, edit: TextEdit, diagnostic?: Diagnostic, preferred = false): CodeAction => ({
    title,
    kind: CodeActionKind.QuickFix,
    ...(diagnostic && { diagnostics: [diagnostic] }),
    ...(preferred && { isPreferred: true }),
    edit: { changes: { [document.uri]: [edit] } },
  });
  const onLines = published.filter((d) => d.range.start.line <= range.end.line && d.range.end.line >= range.start.line);
  const offset = document.offsetAt(range.start);
  return [
    ...onLines.flatMap((diagnostic) => {
      const fixes = FIXES.get(diagnostic) ?? [];
      return fixes.map(({ title, edit }) => action(title, edit, diagnostic, fixes.length === 1));
    }),
    ...apiVersionFixes(document.getText(), catalog)
      .filter(({ start, end }) => start <= offset && offset <= end)
      .map(({ fix }) => action(fix.title, lspEdit(document, 0, fix.edit), undefined, true)),
  ];
}

function lspEdit(document: TextDocument, offset: number, edit: { start: number; end: number; newText: string }) {
  return { range: rangeOf(document, offset + edit.start, offset + edit.end), newText: edit.newText };
}

function rangeOf(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
