import {
  documentAt,
  fieldAt,
  fieldDocs,
  fieldHover,
  kindHover,
  markdownCode,
  parsedDocuments,
  rangeOf,
  referenceAt,
  referencingKinds,
  referrersOf,
  valueAt,
  type LoadedSpec,
  type Resource,
} from '@conduktor/core';
import { MarkupKind, type Hover, type Location, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { parentsIn, sameParents, type Names } from './references';

/**
 * What a field is, from the Conduktor reference docs, and where a reference's target is; a kind's summary on `kind`.
 * The schema's own text follows when the docs say nothing about the field. A Topic's configs have their own hover.
 */
export async function fieldHoverAt(
  document: TextDocument,
  position: Position,
  spec: LoadedSpec,
  names: Names,
  schemaHover: () => Promise<Hover | null>,
): Promise<Hover | undefined> {
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, spec.catalog);
  const resource = parsed?.resource;
  const at = parsed && fieldAt(parsed.text, offset - parsed.start);
  if (!resource || !at) return undefined;
  const { path } = at;
  if (resource.kind === 'Topic' && path[0] === 'spec' && path[1] === 'configs' && path.length > 2) return undefined;
  const range = {
    start: document.positionAt(parsed.start + at.start),
    end: document.positionAt(parsed.start + at.end),
  };
  const markdown = (value: string): Hover => ({ contents: { kind: MarkupKind.Markdown, value }, range });
  if (path.length === 1 && path[0] === 'kind') return markdown(kindHover(resource.kind));

  let line: string | undefined;
  const reference = referenceAt(resource, spec.catalog, path);
  if (reference?.parents && reference.value !== '' && !reference.pattern && !reference.wildcard) {
    const named = `References ${reference.kind} ${markdownCode(reference.value)}`;
    const { names: known, checked } = await names.lookup(spec.catalog, reference.kind, reference.parents);
    const sources = known.find((n) => n.name === reference.value)?.sources ?? [];
    const where = [sources.includes('repo') && 'in your files', sources.includes('console') && 'on the Console'];
    if (sources.length > 0) line = `${named}: ${where.filter(Boolean).join(' and ')}`;
    // Only a Console that answered can say a name is missing.
    else if (checked) line = `${named}: not found in your files or on the Console`;
  }
  const text = fieldHover(spec.schema, spec.catalog, resource, path, line);
  if (fieldDocs(resource.kind, path).length > 0) return markdown(text);
  const schema = await schemaHover();
  const extra =
    schema && typeof schema.contents === 'object' && 'value' in schema.contents ? schema.contents.value : '';
  return markdown(extra ? `${text}\n\n---\n\n${extra}` : text);
}

/** From a reference to the resource an open file defines. */
export function definitionAt(
  document: TextDocument,
  position: Position,
  spec: LoadedSpec,
  documents: readonly TextDocument[],
): Location[] {
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, spec.catalog);
  const at = parsed && valueAt(parsed.text, offset - parsed.start);
  const reference = parsed?.resource && at && referenceAt(parsed.resource, spec.catalog, at.path);
  if (!reference?.parents || reference.value === '' || reference.pattern || reference.wildcard) return [];
  const params = spec.catalog.latest(reference.kind)?.parentPathParams ?? [];
  return located(documents, spec).flatMap(({ document: defining, start, text, resource }) => {
    const matches =
      resource.kind === reference.kind &&
      resource.metadata?.name === reference.value &&
      sameParents(parentsIn(resource, params), reference.parents!);
    const range = matches ? rangeOf(text, ['metadata', 'name']) : undefined;
    return range ? [locationOf(defining, start + range[0], start + range[1])] : [];
  });
}

/**
 * From a resource's name to what refers to it in the open files: by name, by a pattern that matches it, or by `*`.
 * With `includeDeclaration`, the resource's own name comes first.
 */
export function referencesAt(
  document: TextDocument,
  position: Position,
  spec: LoadedSpec,
  documents: readonly TextDocument[],
  includeDeclaration: boolean,
): Location[] {
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, spec.catalog);
  const at = parsed && valueAt(parsed.text, offset - parsed.start);
  const resource = parsed?.resource;
  const kind = resource && spec.catalog.latest(resource.kind);
  if (!kind || at?.path.join('.') !== 'metadata.name' || typeof resource?.metadata?.name !== 'string') return [];
  const target = { kind: kind.kind, parents: parentsIn(resource, kind.parentPathParams), name: resource.metadata.name };
  const declaration = includeDeclaration ? [locationOf(document, parsed.start + at.start, parsed.start + at.end)] : [];
  const referencing = new Set(referencingKinds(kind.kind));
  const candidates = located(documents, spec).filter((d) => referencing.has(d.resource.kind));
  const referrers = referrersOf(
    target,
    candidates.map((d) => d.resource),
    spec.catalog,
  ).flatMap(({ index, reference }) => {
    const candidate = candidates[index]!;
    const range = rangeOf(candidate.text, reference.path);
    return range ? [locationOf(candidate.document, candidate.start + range[0], candidate.start + range[1])] : [];
  });
  return [...declaration, ...referrers];
}

function located(documents: readonly TextDocument[], spec: LoadedSpec) {
  return documents.flatMap((document) =>
    parsedDocuments(document.getText(), spec.catalog).flatMap(({ start, text, resource }) =>
      resource ? [{ document, start, text, resource: resource as Resource }] : [],
    ),
  );
}

function locationOf(document: TextDocument, start: number, end: number): Location {
  return { uri: document.uri, range: { start: document.positionAt(start), end: document.positionAt(end) } };
}
