import { isRecord } from '../util';

export const REDACTED = '<redacted>';
export const REDACTED_MESSAGE = 'is a redacted secret; leave it out or use a ${VAR} the user sets';

// Mirrors Console's own MCP responses, which never give an agent credentials. Matching on names covers every kind
// (cluster client properties, schema registry and Connect security, Gateway and AWS credentials, connector configs).
const SECRET_KEY = /password|passwd|secret|token|jaas|credential|private.?key|api.?key|access.?key/i;
const PRIVATE_KEY_PEM = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

const URL_START = /^(?:[a-z][a-z0-9+.-]*:)+\/\//i;
const URL_PARAM = /([?&;])([^=&;#]+)=([^&;#]*)/g;

export function replaceSecrets(value: unknown, replacement: (path: readonly string[]) => string): unknown {
  const walk = (node: unknown, path: readonly string[]): unknown => {
    if (typeof node === 'string')
      return withoutSecrets(path.at(-1), node, (part) => replacement(part === undefined ? path : [...path, part]));
    if (Array.isArray(node)) return node.map((item, i) => walk(item, [...path, String(i)]));
    if (isRecord(node)) return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, walk(v, [...path, k])]));
    return node;
  };
  return walk(value, []);
}

// Only strings are secrets: a number or an object under a secret-looking name (maxTokens) is not a credential.
function withoutSecrets(key: string | undefined, text: string, replace: (part?: string) => string): string {
  if (text === '') return text;
  if ((key !== undefined && SECRET_KEY.test(key)) || PRIVATE_KEY_PEM.test(text)) return replace();
  return withoutUrlCredentials(text, replace);
}

// Connection URLs (JDBC, Mongo, webhooks) carry credentials as user:password@ or as query parameters; only those
// parts go, so the host and database stay readable. A user with no password is taken for a token.
function withoutUrlCredentials(text: string, replace: (part: string) => string): string {
  const start = URL_START.exec(text)?.[0].length;
  if (start === undefined) return text;
  const rest = text.slice(start);
  const authorityEnd = rest.search(/[/?#]/);
  const authority = authorityEnd === -1 ? rest : rest.slice(0, authorityEnd);
  const at = authority.lastIndexOf('@');
  const userinfo = at === -1 ? '' : authority.slice(0, at);
  const colon = userinfo.indexOf(':');
  const credentials =
    userinfo === ''
      ? ''
      : colon === -1
        ? `${replace('userinfo')}@`
        : colon === userinfo.length - 1
          ? `${userinfo}@`
          : `${userinfo.slice(0, colon + 1)}${replace('password')}@`;
  const afterUserinfo = rest
    .slice(at + 1)
    .replace(URL_PARAM, (match, separator: string, name: string, value: string) =>
      value !== '' && SECRET_KEY.test(name) ? `${separator}${name}=${replace(name)}` : match,
    );
  return `${text.slice(0, start)}${credentials}${afterUserinfo}`;
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
  if (typeof value === 'string' && value.includes(REDACTED)) return [path || '/'];
  if (Array.isArray(value)) return value.flatMap((item, i) => redactedPaths(item, `${path}/${i}`));
  if (isRecord(value)) return Object.entries(value).flatMap(([k, v]) => redactedPaths(v, `${path}/${k}`));
  return [];
}
