import type { KindVersion } from '../openapi/kindCatalog';

const UNSAFE = /[%/\\:*?"<>|]/g;

export function syncPath(kind: KindVersion, parents: readonly string[], name: string): string {
  return [kind.group, kind.kind, ...parents.map(segment), `${segment(name)}.yaml`].join('/');
}

function segment(value: string): string {
  const escaped = value.replace(UNSAFE, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return /^\.+$/.test(escaped) ? escaped.replace(/\./g, '%2E') : escaped;
}
