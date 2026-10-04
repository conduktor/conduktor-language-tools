import { isMap, parseDocument, type Document } from 'yaml';
import type { KindCatalog } from '../openapi/kindCatalog';
import { environmentName } from './layout';
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

// An environment name becomes a folder, so a name bound in a cloned repository's conduktor.yaml must be one safe
// segment; and naming an environment after its connection must not take over one bound to another Console.
export function resolveEnvironment(
  text: string | undefined,
  consoleUrl: string,
  connectionName: string,
): { environment?: string; problem?: string } {
  const envs = environments(text);
  const bound = Object.entries(envs).find(([, env]) => sameConsole(env.console, consoleUrl))?.[0];
  if (bound !== undefined) {
    return environmentName(bound) === bound
      ? { environment: bound }
      : { problem: `${REPO_CONFIG}: "${bound}" is not a folder name; use letters, digits, ".", "_" and "-".` };
  }
  const fallback = environmentName(connectionName);
  const owner = envs[fallback]?.console;
  if (owner !== undefined && !sameConsole(owner, consoleUrl)) {
    return {
      problem: `environments/${fallback} belongs to ${owner} in ${REPO_CONFIG}; bind this Console to an environment of its own there.`,
    };
  }
  return { environment: fallback };
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
