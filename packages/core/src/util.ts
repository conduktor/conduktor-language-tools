export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function kebabCase(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
}

/** The value at `path` through objects and arrays; undefined where the path leads nowhere. */
export function valueAtPath(node: unknown, path: readonly (string | number)[]): unknown {
  return path.reduce<unknown>((at, key) => (isRecord(at) || Array.isArray(at) ? (at as never)[key] : undefined), node);
}

/** The JSON value of `text`, or undefined when it is not JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
