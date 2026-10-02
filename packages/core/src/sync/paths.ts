import type { KindVersion } from '../openapi/kindCatalog';

const UNSAFE = /[%/\\:*?"<>|]/g;

// Mirrors the Explorer: global/<group>/<kind>/… or clusters/<cluster>/<group>/<kind>/[<connect cluster>/]…
export function syncPath(kind: KindVersion, parents: readonly string[], name: string): string {
  const [first, ...rest] = parents;
  const scope =
    kind.parentPathParams[0] === 'cluster' && first !== undefined ? ['clusters', segment(first)] : ['global'];
  const nested = kind.parentPathParams[0] === 'cluster' ? rest : parents;
  return [...scope, kind.group, kind.kind, ...nested.map(segment), `${segment(name)}.yaml`].join('/');
}

function segment(value: string): string {
  const escaped = value.replace(UNSAFE, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
  return /^\.+$/.test(escaped) ? escaped.replace(/\./g, '%2E') : escaped;
}
