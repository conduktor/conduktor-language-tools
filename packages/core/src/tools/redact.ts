import { isRecord } from '../util';

export const REDACTED = '<redacted>';
export const REDACTED_MESSAGE = 'is a redacted secret; leave it out or use a ${VAR} the user sets';

// Mirrors Console's own MCP responses, which never give an agent credentials. Matching on names covers every kind
// (cluster client properties, schema registry and Connect security, Gateway and AWS credentials, connector configs).
const SECRET_KEY = /password|passwd|secret|token|jaas|credential|private.?key|api.?key|access.?key/i;
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function isSecret(key: string | undefined, value: unknown): boolean {
  if (key !== undefined && SECRET_KEY.test(key) && value !== null && value !== '') return true;
  return typeof value === 'string' && PRIVATE_KEY_PEM.test(value);
}

export function replaceSecrets(value: unknown, replacement: (path: readonly string[]) => unknown): unknown {
  const walk = (node: unknown, path: readonly string[]): unknown => {
    if (isSecret(path.at(-1), node)) return replacement(path);
    if (Array.isArray(node)) return node.map((item, i) => walk(item, [...path, String(i)]));
    if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, [...path, k])]));
    return node;
  };
  return walk(value, []);
}

export function redactSecrets(value: unknown): { value: unknown; redacted: number } {
  let redacted = 0;
  const result = replaceSecrets(value, () => {
    redacted++;
    return REDACTED;
  });
  return { value: result, redacted };
}

export function redactedPaths(value: unknown, path = ''): string[] {
  if (value === REDACTED) return [path || '/'];
  if (Array.isArray(value)) return value.flatMap((item, i) => redactedPaths(item, `${path}/${i}`));
  if (isRecord(value)) return Object.entries(value).flatMap(([k, v]) => redactedPaths(v, `${path}/${k}`));
  return [];
}
