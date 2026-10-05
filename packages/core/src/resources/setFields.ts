import { isMap, isScalar, parseDocument, stringify, type Pair, type YAMLMap } from 'yaml';

type Scalar = string | number;
export type FieldValue = Scalar | Readonly<Record<string, Scalar>>;

/**
 * Sets fields of the map at `path`, editing the text rather than re-serialising it: existing values are replaced in
 * place (keeping double quotes), missing keys are inserted after `anchor` (or the map's last one-line field) at its
 * indentation, and a missing map is created in its parent. Only when nothing can anchor an insertion is the document
 * re-serialised.
 */
export function setFields(
  text: string,
  path: readonly string[],
  fields: Readonly<Record<string, FieldValue>>,
  anchor?: string,
): string {
  const document = parseDocument(text);
  const node = document.getIn(path, true);
  if (!isMap(node)) {
    const parent = path.slice(0, -1);
    const key = path.at(-1);
    const parentNode = parent.length === 0 ? document.contents : document.getIn(parent, true);
    if (key !== undefined && node === undefined && isMap(parentNode))
      return setFields(text, parent, { [key]: fields as Record<string, Scalar> });
    for (const [field, value] of Object.entries(fields)) document.setIn([...path, field], value);
    return document.toString();
  }
  // Nested maps first, each against the text as it then stands.
  let current = text;
  for (const [field, value] of Object.entries(fields))
    if (typeof value === 'object' && isMap(parseDocument(current).getIn([...path, field], true)))
      current = setFields(current, [...path, field], value);
  const map = parseDocument(current).getIn(path, true) as YAMLMap;
  const edits: { at: number; end: number; text: string }[] = [];
  const missing: [string, FieldValue][] = [];
  for (const [field, value] of Object.entries(fields)) {
    const pair = map.items.find((item) => isScalar(item.key) && item.key.value === field);
    if (!pair) missing.push([field, value]);
    else if (typeof value !== 'object' && isScalar(pair.value) && pair.value.range) {
      const quoted = pair.value.type === 'QUOTE_DOUBLE';
      edits.push({
        at: pair.value.range[0],
        end: pair.value.range[1],
        text: quoted ? JSON.stringify(String(value)) : scalar(value),
      });
    }
  }
  if (missing.length > 0) {
    const insert = insertion(current, map, missing, anchor);
    if (!insert) {
      const fallback = parseDocument(current);
      for (const [field, value] of Object.entries(fields)) fallback.setIn([...path, field], value);
      return fallback.toString();
    }
    edits.push(insert);
  }
  return applyEdits(current, edits);
}

function applyEdits(text: string, edits: { at: number; end: number; text: string }[]): string {
  return edits
    .sort((a, b) => b.at - a.at)
    .reduce((out, edit) => out.slice(0, edit.at) + edit.text + out.slice(edit.end), text);
}

function insertion(
  text: string,
  map: YAMLMap,
  fields: [string, FieldValue][],
  anchorKey: string | undefined,
): { at: number; end: number; text: string } | undefined {
  if (map.flow) {
    const close = text.lastIndexOf('}', map.range![1]);
    const head = text.slice(0, close).trimEnd();
    const pairs = fields.map(([key, value]) => `${key}: ${typeof value === 'object' ? flow(value) : scalar(value)}`);
    return { at: head.length, end: close, text: `${map.items.length > 0 ? ',' : ''} ${pairs.join(', ')} ` };
  }
  // New keys go on the line after the anchor (a one-line field), at its indentation: after a nested map they would
  // land inside it.
  const oneLine = (item: Pair) => isScalar(item.key) && isScalar(item.value);
  const anchor =
    (anchorKey && map.items.find((item) => oneLine(item) && (item.key as { value: unknown }).value === anchorKey)) ||
    [...map.items].reverse().find(oneLine);
  if (!anchor || !isScalar(anchor.key) || !anchor.key.range || !isScalar(anchor.value) || !anchor.value.range)
    return undefined;
  const keyStart = anchor.key.range[0];
  const indent = keyStart - (text.lastIndexOf('\n', keyStart - 1) + 1);
  const lineEnd = text.indexOf('\n', anchor.value.range[1]);
  const at = lineEnd === -1 ? text.length : lineEnd;
  const pad = (n: number) => ' '.repeat(n);
  const lines = fields.map(([key, value]) =>
    typeof value === 'object'
      ? `\n${pad(indent)}${key}:${Object.entries(value)
          .map(([k, v]) => `\n${pad(indent + 2)}${k}: ${scalar(v)}`)
          .join('')}`
      : `\n${pad(indent)}${key}: ${scalar(value)}`,
  );
  return { at, end: at, text: lines.join('') };
}

function flow(value: Readonly<Record<string, Scalar>>): string {
  return `{ ${Object.entries(value)
    .map(([k, v]) => `${k}: ${scalar(v)}`)
    .join(', ')} }`;
}

function scalar(value: Scalar): string {
  return typeof value === 'number' ? String(value) : stringify(value).trimEnd();
}
