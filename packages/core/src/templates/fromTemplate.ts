import { isAlias, isMap, isScalar, parseAllDocuments, parseDocument, stringify, type YAMLMap } from 'yaml';
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
  const fields: [string, string][] = [['name', name], ...Object.entries(parents)];
  const metadata = document.contents.get('metadata', true);
  if (!isMap(metadata)) {
    document.setIn(['metadata'], document.createNode(Object.fromEntries(fields)));
    return document.toString();
  }
  const edits: { at: number; end: number; text: string }[] = [];
  const missing: [string, string][] = [];
  for (const [key, value] of fields) {
    const pair = metadata.items.find((item) => isScalar(item.key) && item.key.value === key);
    if (pair && isScalar(pair.value) && pair.value.range)
      edits.push({ at: pair.value.range[0], end: pair.value.range[1], text: scalar(value) });
    else if (!pair) missing.push([key, value]);
  }
  if (missing.length > 0) {
    const insert = insertion(text, metadata, missing);
    if (!insert) {
      for (const [key, value] of fields) document.setIn(['metadata', key], value);
      return document.toString();
    }
    edits.push(insert);
  }
  return edits
    .sort((a, b) => b.at - a.at)
    .reduce((out, edit) => out.slice(0, edit.at) + edit.text + out.slice(edit.end), text);
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

function insertion(
  text: string,
  metadata: YAMLMap,
  fields: [string, string][],
): { at: number; end: number; text: string } | undefined {
  const pairs = fields.map(([key, value]) => `${key}: ${scalar(value)}`);
  if (metadata.flow) {
    const close = text.lastIndexOf('}', metadata.range![1]);
    const head = text.slice(0, close).trimEnd();
    return { at: head.length, end: close, text: `, ${pairs.join(', ')} ` };
  }
  // New keys go on the line after `name` (or another one-line field), at its indentation: after a nested map they
  // would land inside it, or in the next section.
  const anchor =
    metadata.items.find((item) => isScalar(item.key) && item.key.value === 'name' && isScalar(item.value)) ??
    metadata.items.find((item) => isScalar(item.value));
  if (!anchor || !isScalar(anchor.key) || !anchor.key.range || !isScalar(anchor.value) || !anchor.value.range)
    return undefined;
  const keyStart = anchor.key.range[0];
  const indent = keyStart - (text.lastIndexOf('\n', keyStart - 1) + 1);
  const lineEnd = text.indexOf('\n', anchor.value.range[1]);
  const at = lineEnd === -1 ? text.length : lineEnd;
  return { at, end: at, text: pairs.map((pair) => `\n${' '.repeat(indent)}${pair}`).join('') };
}

function scalar(value: string): string {
  return stringify(value).trimEnd();
}

function isEmpty(node: unknown): boolean {
  return isScalar(node) && (node.value === null || node.value === '');
}
