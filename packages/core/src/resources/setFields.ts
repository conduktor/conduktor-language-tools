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
    const pair = key !== undefined && isMap(parentNode) && !parentNode.flow ? pairOf(parentNode, key) : undefined;
    if (pair && empty(pair.value)) return applyEdits(text, [fill(text, pair, fields)]);
    if (key !== undefined && node === undefined && (parent.length > 0 || isMap(parentNode)))
      return setFields(text, parent, { [key]: fields as Record<string, Scalar> });
    for (const [field, value] of Object.entries(fields)) document.setIn([...path, field], value);
    return document.toString();
  }
  // Nested maps first, each against the text as it then stands.
  let current = text;
  for (const [field, value] of Object.entries(fields))
    if (typeof value === 'object' && pairOf(parseDocument(current).getIn(path, true) as YAMLMap, field))
      current = setFields(current, [...path, field], value);
  const map = parseDocument(current).getIn(path, true) as YAMLMap;
  const edits: Edit[] = [];
  const missing: [string, FieldValue][] = [];
  for (const [field, value] of Object.entries(fields)) {
    const pair = pairOf(map, field);
    if (!pair) missing.push([field, value]);
    else if (typeof value === 'object') continue;
    else if (empty(pair.value) && isScalar(pair.key) && pair.key.range) {
      const colon = current.indexOf(':', pair.key.range[1]) + 1;
      edits.push({ at: colon, end: colon, text: ` ${scalar(value, map.flow)}` });
    } else if (isScalar(pair.value) && pair.value.range) {
      const quoted = pair.value.type === 'QUOTE_DOUBLE';
      edits.push({
        at: pair.value.range[0],
        end: pair.value.range[1],
        text: quoted ? JSON.stringify(String(value)) : scalar(value, map.flow),
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

interface Edit {
  at: number;
  end: number;
  text: string;
}

function applyEdits(text: string, edits: Edit[]): string {
  return edits
    .sort((a, b) => b.at - a.at)
    .reduce((out, edit) => out.slice(0, edit.at) + edit.text + out.slice(edit.end), text);
}

function pairOf(map: YAMLMap, key: string): Pair | undefined {
  return map.items.find((item) => isScalar(item.key) && item.key.value === key);
}

// `key:` with nothing after it (a comment aside).
function empty(value: unknown): boolean {
  return (
    value === null || (isScalar(value) && value.value === null && !!value.range && value.range[0] === value.range[1])
  );
}

// The fields as the block under an empty `key:`, one level deeper than the key.
function fill(text: string, pair: Pair, fields: Readonly<Record<string, FieldValue>>): Edit {
  const keyRange = (pair.key as { range: [number, number, number] }).range;
  const lineEnd = text.indexOf('\n', keyRange[1]);
  const at = lineEnd === -1 ? text.length : lineEnd;
  const indent = keyRange[0] - (text.lastIndexOf('\n', keyRange[0] - 1) + 1);
  return {
    at,
    end: at,
    text: blockLines(Object.entries(fields), indent + 2)
      .map((line) => `\n${line}`)
      .join(''),
  };
}

function insertion(
  text: string,
  map: YAMLMap,
  fields: [string, FieldValue][],
  anchorKey: string | undefined,
): Edit | undefined {
  if (map.flow) {
    const close = text.lastIndexOf('}', map.range?.[1]);
    const head = text.slice(0, close).trimEnd();
    const pairs = fields.map(
      ([key, value]) => `${key}: ${typeof value === 'object' ? flow(value) : scalar(value, true)}`,
    );
    return { at: head.length, end: close, text: `${map.items.length > 0 ? ',' : ''} ${pairs.join(', ')} ` };
  }
  // New keys go on the line after the anchor (a one-line field), at its indentation: after a nested map they would
  // land inside it. With no one-line field they go before the first one.
  const oneLine = (item: Pair) => isScalar(item.key) && isScalar(item.value);
  const anchor =
    (anchorKey
      ? map.items.find((item) => oneLine(item) && (item.key as { value: unknown }).value === anchorKey)
      : undefined) ?? [...map.items].reverse().find(oneLine);
  if (anchor && isScalar(anchor.key) && anchor.key.range && isScalar(anchor.value) && anchor.value.range) {
    const keyStart = anchor.key.range[0];
    const indent = keyStart - (text.lastIndexOf('\n', keyStart - 1) + 1);
    const lineEnd = text.indexOf('\n', anchor.value.range[1]);
    const at = lineEnd === -1 ? text.length : lineEnd;
    return {
      at,
      end: at,
      text: blockLines(fields, indent)
        .map((line) => `\n${line}`)
        .join(''),
    };
  }
  const first = map.items[0]?.key;
  if (!isScalar(first) || !first.range) return undefined;
  const lineStart = text.lastIndexOf('\n', first.range[0] - 1) + 1;
  if (text.slice(lineStart, first.range[0]).trim() !== '') return undefined;
  const lines = blockLines(fields, first.range[0] - lineStart);
  return { at: lineStart, end: lineStart, text: lines.map((line) => `${line}\n`).join('') };
}

function blockLines(fields: [string, FieldValue][], indent: number): string[] {
  const pad = (n: number) => ' '.repeat(n);
  return fields.flatMap(([key, value]) =>
    typeof value === 'object'
      ? [`${pad(indent)}${key}:`, ...Object.entries(value).map(([k, v]) => `${pad(indent + 2)}${k}: ${scalar(v)}`)]
      : [`${pad(indent)}${key}: ${scalar(value)}`],
  );
}

function flow(value: Readonly<Record<string, Scalar>>): string {
  return `{ ${Object.entries(value)
    .map(([k, v]) => `${k}: ${scalar(v, true)}`)
    .join(', ')} }`;
}

// Inside a flow map a plain `compact,delete` would end at the comma.
function scalar(value: Scalar, inFlow = false): string {
  if (typeof value === 'number') return String(value);
  return inFlow && /[,[\]{}#]/.test(value) ? JSON.stringify(value) : stringify(value).trimEnd();
}
