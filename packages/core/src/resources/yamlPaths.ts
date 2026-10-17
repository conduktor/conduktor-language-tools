import { isMap, isScalar, isSeq, parseDocument, type Range, type Scalar } from 'yaml';

export type YamlPath = (string | number)[];

export interface ValueAt {
  path: YamlPath;
  start: number;
  end: number;
  value: string | null;
}

export function valueAt(text: string, offset: number): ValueAt | undefined {
  let found: ValueAt | undefined;
  scalars(text, (path, scalar, [start, end]) => {
    if (!found && start <= offset && offset <= end)
      found = { path, start, end, value: scalar.value === null ? null : scalar.toString() };
  });
  return found;
}

/** The field under the cursor: on its key (the key's range) or on its scalar value. */
export function fieldAt(text: string, offset: number): { path: YamlPath; start: number; end: number } | undefined {
  let found: { path: YamlPath; start: number; end: number } | undefined;
  const at = (path: YamlPath, node: unknown) => {
    const range = isScalar(node) ? node.range : undefined;
    if (!found && range && range[0] <= offset && offset <= range[1]) found = { path, start: range[0], end: range[1] };
  };
  const walk = (node: unknown, path: YamlPath) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const field = [...path, String(pair.key.value)];
        at(field, pair.key);
        if (isScalar(pair.value)) at(field, pair.value);
        else walk(pair.value, field);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => (isScalar(item) ? at([...path, i], item) : walk(item, [...path, i])));
    }
  };
  walk(parseDocument(text).contents, []);
  return found;
}

export function rangeOf(text: string, path: YamlPath): [number, number] | undefined {
  let found: [number, number] | undefined;
  scalars(text, (at, _scalar, [start, end]) => {
    if (!found && at.length === path.length && at.every((segment, i) => segment === path[i])) found = [start, end];
  });
  return found;
}

export interface ScalarRange {
  path: YamlPath;
  start: number;
  end: number;
  value: string | null;
  quoted: boolean;
}

/** Every scalar value with its range, in document order. */
export function scalarRanges(text: string): ScalarRange[] {
  const found: ScalarRange[] = [];
  scalars(text, (path, scalar, [start, end]) =>
    found.push({
      path,
      start,
      end,
      value: scalar.value === null ? null : scalar.toString(),
      quoted: scalar.type === 'QUOTE_DOUBLE' || scalar.type === 'QUOTE_SINGLE',
    }),
  );
  return found;
}

// Every scalar value of a parsed document, which always has its range.
function scalars(text: string, visit: (path: YamlPath, scalar: Scalar, range: Range) => void): void {
  const scalar = (path: YamlPath, node: Scalar) => {
    if (node.range) visit(path, node, node.range);
  };
  const walk = (node: unknown, path: YamlPath) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const at = [...path, String(pair.key.value)];
        if (isScalar(pair.value)) scalar(at, pair.value);
        else walk(pair.value, at);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => (isScalar(item) ? scalar([...path, i], item) : walk(item, [...path, i])));
    }
  };
  walk(parseDocument(text).contents, []);
}
