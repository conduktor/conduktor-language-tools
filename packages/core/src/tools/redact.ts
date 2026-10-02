import { isRecord } from '../util';

export const REDACTED = '<redacted>';
export const REDACTED_MESSAGE = 'is a redacted secret; leave it out or use a ${VAR} the user sets';

// Mirrors Console's own MCP responses, which never give an agent credentials. Matching on names covers every kind
// (cluster client properties, schema registry and Connect security, Gateway and AWS credentials, connector configs).
const SECRET_KEY = /password|passwd|secret|token|jaas|credential|private.?key|api.?key|access.?key/i;
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function redactSecrets(value: unknown): { value: unknown; redacted: number } {
  let redacted = 0;
  const walk = (node: unknown, key?: string): unknown => {
    if (key !== undefined && SECRET_KEY.test(key) && node !== null && node !== '') {
      redacted++;
      return REDACTED;
    }
    if (Array.isArray(node)) return node.map((item) => walk(item));
    if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, k)]));
    if (typeof node === 'string' && PRIVATE_KEY_PEM.test(node)) {
      redacted++;
      return REDACTED;
    }
    return node;
  };
  return { value: walk(value), redacted };
}

export function redactedPaths(value: unknown, path = ''): string[] {
  if (value === REDACTED) return [path || '/'];
  if (Array.isArray(value)) return value.flatMap((item, i) => redactedPaths(item, `${path}/${i}`));
  if (isRecord(value)) return Object.entries(value).flatMap(([k, v]) => redactedPaths(v, `${path}/${k}`));
  return [];
}
