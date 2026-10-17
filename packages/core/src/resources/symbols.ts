import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';
import { parsedDocuments } from './parsedDocuments';
import { rangeOf } from './yamlPaths';

export interface ResourceSymbol {
  /** Its metadata.name, or `(no name)` while it has none. */
  name: string;
  kind: string;
  /** The kind, and the parents it lives under: `Topic · local-kafka`. */
  detail: string;
  /** Offsets in the file: the resource's document, and its name (its kind while it has no name). */
  start: number;
  end: number;
  nameStart: number;
  nameEnd: number;
}

/** A file's resources, as an outline and a workspace search show them. */
export function resourceSymbols(text: string, catalog: KindCatalog): ResourceSymbol[] {
  return parsedDocuments(text, catalog).flatMap((document) => resourceSymbol(document, catalog) ?? []);
}

/** One resource's symbol, from where its document starts in the file and the document's text. */
export function resourceSymbol(
  document: { start: number; text: string; resource: unknown },
  catalog: KindCatalog,
): ResourceSymbol | undefined {
  const { start, text, resource } = document;
  if (!isRecord(resource) || typeof resource.kind !== 'string') return undefined;
  const metadata = isRecord(resource.metadata) ? resource.metadata : {};
  const written = metadata.name;
  // YAML reads `name: 2024` as a number; it is still the name.
  const name = typeof written === 'string' || typeof written === 'number' ? String(written) : '';
  const parents = (catalog.latest(resource.kind)?.parentPathParams ?? [])
    .map((param) => metadata[param])
    .filter((value): value is string => typeof value === 'string' && value !== '');
  const [nameStart, nameEnd] = (name ? rangeOf(text, ['metadata', 'name']) : undefined) ??
    rangeOf(text, ['kind']) ?? [0, 0];
  return {
    name: name || '(no name)',
    kind: resource.kind,
    detail: parents.length > 0 ? `${resource.kind} · ${parents.join('/')}` : resource.kind,
    start,
    end: start + text.length,
    nameStart: start + nameStart,
    nameEnd: start + nameEnd,
  };
}
