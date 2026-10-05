import { isMap, isScalar, isSeq, parseDocument, type Scalar } from 'yaml';

export type YamlPath = (string | number)[];

export interface ValueAt {
  path: YamlPath;
  start: number;
  end: number;
  value: string | null;
}

export function valueAt(text: string, offset: number): ValueAt | undefined {
  let found: ValueAt | undefined;
  scalars(text, (path, scalar) => {
    const [start, end] = scalar.range!;
    if (!found && start <= offset && offset <= end)
      found = { path, start, end, value: scalar.value === null ? null : String(scalar.value) };
  });
  return found;
}

export function rangeOf(text: string, path: YamlPath): [number, number] | undefined {
  let found: [number, number] | undefined;
  scalars(text, (at, scalar) => {
    if (!found && at.length === path.length && at.every((segment, i) => segment === path[i]))
      found = [scalar.range![0], scalar.range![1]];
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
  scalars(text, (path, scalar) =>
    found.push({
      path,
      start: scalar.range![0],
      end: scalar.range![1],
      value: scalar.value === null ? null : String(scalar.value),
      quoted: scalar.type === 'QUOTE_DOUBLE' || scalar.type === 'QUOTE_SINGLE',
    }),
  );
  return found;
}

function scalars(text: string, visit: (path: YamlPath, scalar: Scalar) => void): void {
  const walk = (node: unknown, path: YamlPath) => {
    if (isMap(node)) {
      for (const pair of node.items) {
        if (!isScalar(pair.key)) continue;
        const at = [...path, String(pair.key.value)];
        if (isScalar(pair.value)) visit(at, pair.value);
        else walk(pair.value, at);
      }
    } else if (isSeq(node)) {
      node.items.forEach((item, i) => (isScalar(item) ? visit([...path, i], item) : walk(item, [...path, i])));
    }
  };
  walk(parseDocument(text).contents, []);
}
