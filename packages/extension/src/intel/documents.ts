import { parseDocument } from 'yaml';
import { catalogDocuments, isRecord, type KindCatalog, type Resource } from '@conduktor/vscode-core';

export interface ParsedDocument {
  start: number;
  text: string;
  resource: Resource | undefined;
}

export function parsedDocuments(text: string, catalog: KindCatalog): ParsedDocument[] {
  return catalogDocuments(text, catalog).map((document) => {
    const source = text.slice(document.start, document.end);
    // Read what parses even when another line is mid-edit, so references keep working while typing.
    let value: unknown;
    try {
      value = parseDocument(source).toJS();
    } catch {
      value = undefined;
    }
    return { start: document.start, text: source, resource: isRecord(value) ? (value as Resource) : undefined };
  });
}

export function documentAt(text: string, offset: number, catalog: KindCatalog): ParsedDocument | undefined {
  return parsedDocuments(text, catalog).find((d) => d.start <= offset && offset <= d.start + d.text.length);
}
