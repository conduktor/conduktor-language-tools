import { isAlias, isMap, isScalar, parseAllDocuments, parseDocument } from 'yaml';
import { setFields } from '../resources/setFields';
import { isRecord } from '../util';

/** The first document of `kind` in a template file: its name and its source as written, comments included. */
export function templateDocument(text: string, kind: string): { name: string; text: string } | undefined {
  const documents = parseAllDocuments(text);
  for (const [i, document] of documents.entries()) {
    if (!('contents' in document) || document.errors.length > 0) continue;
    const value: unknown = document.toJS();
    if (!isRecord(value) || value.kind !== kind) continue;
    const metadata = isMap(document.contents) ? document.contents.get('metadata', true) : undefined;
    if (isAlias(metadata) || (metadata !== undefined && metadata !== null && !isMap(metadata) && !isEmpty(metadata)))
      return undefined;
    const source = text.slice(i === 0 ? 0 : document.range[0], document.range[2]).replace(/^---[^\n]*\n/, '');
    const meta = isRecord(value.metadata) ? value.metadata : {};
    return { name: typeof meta.name === 'string' ? meta.name : '', text: source };
  }
  return undefined;
}

/**
 * The template with its name and parents set. Values are replaced in place and missing keys inserted, so everything
 * else — comments, indentation, quoting, line lengths — stays as the template's author wrote it.
 */
export function fromTemplate(text: string, parents: Readonly<Record<string, string>>, name: string): string {
  const document = parseDocument(text);
  if (!isMap(document.contents)) return text;
  const fields = { name, ...parents };
  if (!isMap(document.contents.get('metadata', true))) {
    document.setIn(['metadata'], document.createNode(fields));
    return document.toString();
  }
  return setFields(text, ['metadata'], fields, 'name');
}

/** The name a template's resource takes: its own when the kind is limited to fixed names and it is free. */
export function templateName(
  base: string,
  fixed: readonly string[] | undefined,
  taken: ReadonlySet<string>,
): string | undefined {
  if (!fixed) return base;
  if (fixed.includes(base)) return taken.has(base) ? undefined : base;
  return fixed.find((candidate) => !taken.has(candidate));
}

function isEmpty(node: unknown): boolean {
  return isScalar(node) && (node.value === null || node.value === '');
}
