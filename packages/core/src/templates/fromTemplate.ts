import { isMap, parseAllDocuments, parseDocument } from 'yaml';
import { isRecord } from '../util';

/** The first document of `kind` in a template file: its name and its source, comments included. */
export function templateDocument(text: string, kind: string): { name: string; text: string } | undefined {
  for (const document of parseAllDocuments(text)) {
    if (!('contents' in document) || document.errors.length > 0) continue;
    const value: unknown = document.toJS();
    if (!isRecord(value) || value.kind !== kind) continue;
    const metadata = isRecord(value.metadata) ? value.metadata : {};
    return { name: typeof metadata.name === 'string' ? metadata.name : '', text: document.toString() };
  }
  return undefined;
}

/** The template with its name and parents set; everything else, comments and style included, is kept. */
export function fromTemplate(text: string, parents: Readonly<Record<string, string>>, name: string): string {
  const document = parseDocument(text);
  if (!isMap(document.contents)) return text;
  document.setIn(['metadata', 'name'], name);
  for (const [param, value] of Object.entries(parents)) document.setIn(['metadata', param], value);
  return document.toString();
}
