import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml';

export type YamlPath = (string | number)[];

export interface ValueAt {
  path: YamlPath;
  start: number;
  end: number;
  value: string | null;
}

export function valueAt(text: string, offset: number): ValueAt | undefined {
  const found = scalars(text).find((s) => !s.key && s.start <= offset && offset <= s.end);
  return found && { path: found.path, start: found.start, end: found.end, value: textOf(found.scalar) };
}

/** The field under the cursor: on its key (the key's range) or on its scalar value. */
export function fieldAt(text: string, offset: number): { path: YamlPath; start: number; end: number } | undefined {
  const found = scalars(text).find((s) => s.start <= offset && offset <= s.end);
  return found && { path: found.path, start: found.start, end: found.end };
}

export function rangeOf(text: string, path: YamlPath): [number, number] | undefined {
  const found = scalars(text).find(
    (s) => !s.key && s.path.length === path.length && s.path.every((segment, i) => segment === path[i]),
  );
  return found && [found.start, found.end];
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
  return scalars(text)
    .filter((s) => !s.key)
    .map(({ path, start, end, scalar }) => ({
      path,
      start,
      end,
      value: textOf(scalar),
      quoted: scalar.type === 'QUOTE_DOUBLE' || scalar.type === 'QUOTE_SINGLE',
    }));
}

interface Located {
  path: YamlPath;
  start: number;
  end: number;
  scalar: Scalar;
  key: boolean;
}

// Every scalar of a parsed document that has a range, in document order: a map key, then its value.
function scalars(text: string): Located[] {
  const found: Located[] = [];
  const add = (path: YamlPath, scalar: Scalar, key: boolean) => {
    if (scalar.range) found.push({ path, start: scalar.range[0], end: scalar.range[1], scalar, key });
  };
  const walk = (node: unknown, path: YamlPath) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const at = [...path, String(pair.key.value)];
        add(at, pair.key, true);
        if (isScalar(pair.value)) add(at, pair.value, false);
        else walk(pair.value, at);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => (isScalar(item) ? add([...path, i], item, false) : walk(item, [...path, i])));
    }
  };
  walk(parseDocument(text).contents, []);
  return found;
}

function textOf(scalar: Scalar): string | null {
  return scalar.value === null ? null : scalar.toString();
}
