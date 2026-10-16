import {
  blankDocumentAt,
  catalogDocuments,
  parseResourceDocuments,
  type KindCatalog,
  type ResourceSnippet,
} from '@conduktor/vscode-core';
import { CompletionItemKind, InsertTextFormat, type CompletionList, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';

const SEPARATOR = /^---[ \t]*(?:#.*)?$/gm;
const KIND_LINE = /^kind:[ \t]*["']?([A-Za-z]+)/m;
const VERSION = /^v\d+$/;

/**
 * A whole resource per kind where the document around the cursor is blank, or `undefined` when it is not. Zed starts
 * no language server for an untitled buffer, so unlike in VS Code an empty file on disk qualifies; a file holding
 * anything but Console resources (Kubernetes, Argo CD, Helm) gets none.
 */
export function snippetCompletions(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
  snippets: () => readonly ResourceSnippet[],
): CompletionList | null | undefined {
  const text = document.getText();
  const blank = blankDocumentAt(text, document.offsetAt(position));
  if (!blank) return undefined;
  if (parseResourceDocuments(text).length > catalogDocuments(text, catalog).length) return null;
  const range = { start: document.positionAt(blank.start), end: document.positionAt(blank.end) };
  return {
    isIncomplete: false,
    items: snippets().map(({ kind, variant, snippet, detail }) => ({
      label: `Conduktor: ${kind}${variant ? ` (${variant})` : ''}`,
      kind: CompletionItemKind.Snippet,
      detail,
      filterText: `${kind} ${variant ?? ''} conduktor`,
      insertTextFormat: InsertTextFormat.Snippet,
      textEdit: { range, newText: snippet },
    })),
  };
}

/**
 * The schema offers every Console version as an apiVersion; once the document names its kind, only that kind's are
 * worth offering.
 */
export function onlyKindVersions(
  list: CompletionList,
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
): CompletionList {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const line = text.slice(text.lastIndexOf('\n', offset - 1) + 1, offset);
  if (!line.startsWith('apiVersion:')) return list;
  const kind = KIND_LINE.exec(documentAround(text, offset))?.[1];
  const versions = new Set(catalog.versions(kind ?? '').map((v) => `v${v.version}`));
  if (versions.size === 0) return list;
  return { ...list, items: list.items.filter((item) => !VERSION.test(item.label) || versions.has(item.label)) };
}

function documentAround(text: string, offset: number): string {
  let start = 0;
  let end = text.length;
  for (const separator of text.matchAll(SEPARATOR)) {
    if (separator.index + separator[0].length <= offset) start = separator.index + separator[0].length;
    else if (separator.index >= offset) {
      end = separator.index;
      break;
    }
  }
  return text.slice(start, end);
}
