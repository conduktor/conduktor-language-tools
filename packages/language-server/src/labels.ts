import { isRecord, type KindCatalog, type Resource } from '@conduktor/core';
import { CompletionItemKind, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { stringify } from 'yaml';
import { valueEdit } from './completions';
import { metadataOf, ownScope, resourceAt, type Names } from './references';

// Set by the Console for self-service ownership: not labels to write by hand.
const MANAGED = new Set(['conduktor.io/application', 'conduktor.io/application-instance']);

/**
 * The labels already in use, to keep them consistent: under `labels:`, the keys (most used first, without the ones the
 * resource has); after a key, the values it takes. They come from the open files' resources, of any kind, and from the
 * Console's resources of the kind being written, where it is (a Topic: the topics of its cluster).
 */
export async function labelCompletions(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
  names: Names,
  typedSpace: boolean,
): Promise<CompletionItem[] | undefined> {
  const here = resourceAt(document, position, catalog);
  if (!here) return undefined;
  const { resource, value } = here;
  const inUse = async () => {
    const scope = ownScope(resource, catalog);
    const consoleResources = scope ? await names.consoleResources(scope.kind, scope.parents) : [];
    return [...names.localResources(catalog, here.editing), ...consoleResources]
      .map(labelsOf)
      .filter((labels) => Object.keys(labels).length > 0);
  };

  if (value?.path.length === 3 && value.path[0] === 'metadata' && value.path[1] === 'labels') {
    const key = String(value.path[2]);
    const edit = valueEdit(document, value.start, value.end);
    return tally((await inUse()).map((labels) => labels[key])).map(([label, count], i) => ({
      label,
      kind: CompletionItemKind.Value,
      detail: `${key} on ${resources(count)}`,
      sortText: rank(i),
      textEdit: edit(scalar(label)),
    }));
  }

  const key = typedSpace ? undefined : labelKeyAt(document.getText(), here.offset);
  if (key === undefined) return undefined;
  const has = new Set(Object.keys(labelsOf(resource)));
  const keys = tally((await inUse()).flatMap((labels) => Object.keys(labels))).filter(
    ([name]) => !MANAGED.has(name) && !has.has(name),
  );
  const range = { start: document.positionAt(key), end: position };
  return keys.map(([name, count], i) => ({
    label: name,
    kind: CompletionItemKind.Property,
    detail: `label on ${resources(count)}`,
    sortText: rank(i),
    textEdit: { range, newText: `${scalar(name)}: ` },
  }));
}

/**
 * Where a label key starts, when the cursor ends a line that holds only one being typed, under `metadata.labels`. Read
 * from the lines, since a key with no colon yet does not parse as one.
 */
function labelKeyAt(text: string, offset: number): number | undefined {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1;
  const lineEnd = text.indexOf('\n', offset);
  if (text.slice(offset, lineEnd === -1 ? text.length : lineEnd).trim() !== '') return undefined;
  const indent = /^( +)(?:[^\s:#][^:#]*)?$/.exec(text.slice(lineStart, offset))?.[1]?.length;
  if (indent === undefined) return undefined;
  const labels = parentLine(text, lineStart, indent);
  if (labels?.text.trim() !== 'labels:') return undefined;
  const metadata = parentLine(text, labels.start, labels.indent);
  return metadata?.text === 'metadata:' && metadata.indent === 0 ? lineStart + indent : undefined;
}

/** The nearest line above `before` indented less than `indent`: the key a line belongs to. */
function parentLine(text: string, before: number, indent: number) {
  let end = before - 1;
  while (end > 0) {
    const start = text.lastIndexOf('\n', end - 1) + 1;
    const line = text.slice(start, end);
    const lineIndent = line.length - line.trimStart().length;
    if (line.trim() !== '' && !line.trim().startsWith('#') && lineIndent < indent)
      return { start, indent: lineIndent, text: line.trimEnd() };
    end = start - 1;
  }
  return undefined;
}

function labelsOf(resource: Resource): Record<string, string> {
  const { labels } = metadataOf(resource);
  if (!isRecord(labels)) return {};
  return Object.fromEntries(
    Object.entries(labels).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

/** Each distinct value with how many times it appears, most frequent first, then alphabetically. */
function tally(values: readonly (string | undefined)[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].sort(([a, m], [b, n]) => n - m || a.localeCompare(b));
}

const rank = (i: number) => String(i).padStart(4, '0');
const resources = (count: number) => `${count} resource${count === 1 ? '' : 's'}`;
// A label is a string: `true` or `1` keep their quotes.
const scalar = (value: string) => stringify(value).trimEnd();
