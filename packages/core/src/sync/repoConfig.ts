import { isMap, parseDocument, type Document } from 'yaml';
import type { KindCatalog } from '../openapi/kindCatalog';
import { isRecord } from '../util';

export const REPO_CONFIG = 'conduktor.yaml';

export interface EnvironmentConfig {
  console?: string;
  kinds?: string[];
}

export function environments(text: string | undefined): Record<string, EnvironmentConfig> {
  if (!text) return {};
  const value: unknown = load(text).toJS();
  if (!isRecord(value) || !isRecord(value.environments)) return {};
  return Object.fromEntries(
    Object.entries(value.environments).map(([name, entry]) => {
      const env = isRecord(entry) ? entry : {};
      return [
        name,
        {
          ...(typeof env.console === 'string' && { console: env.console }),
          ...(Array.isArray(env.kinds) && { kinds: env.kinds.filter((k): k is string => typeof k === 'string') }),
        },
      ];
    }),
  );
}

export function environmentFor(text: string | undefined, consoleUrl: string): string | undefined {
  return Object.entries(environments(text)).find(([, env]) => sameConsole(env.console, consoleUrl))?.[0];
}

export function withEnvironment(text: string | undefined, name: string, config: EnvironmentConfig): string {
  const document = load(text ?? '');
  if (!isMap(document.contents)) document.contents = document.createNode({});
  if (config.console !== undefined) document.setIn(['environments', name, 'console'], config.console);
  if (config.kinds !== undefined)
    document.setIn(['environments', name, 'kinds'], document.createNode(config.kinds, { flow: true }));
  return document.toString();
}

// User is left out because SSO or SCIM usually owns it.
export function defaultKinds(catalog: KindCatalog): string[] {
  return [...catalog.kindNames()]
    .filter((kind) => kind !== 'User')
    .sort((a, b) => catalog.orderOf(a) - catalog.orderOf(b) || a.localeCompare(b));
}

function load(text: string): Document {
  const document = parseDocument(text);
  if (document.errors.length > 0) throw new Error(`${REPO_CONFIG}: ${document.errors[0]!.message}`);
  return document;
}

function sameConsole(a: string | undefined, b: string): boolean {
  return a !== undefined && a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}
