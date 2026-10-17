import { isMap, parseDocument, type Document } from 'yaml';
import type { KindCatalog } from '../openapi/kindCatalog';
import { environmentName } from './layout';
import { isRecord } from '../util';

export const REPO_CONFIG = 'conduktor.yaml';

export interface EnvironmentConfig {
  console?: string;
  kinds?: string[];
  /** The Kafka clusters it holds, besides global resources; every cluster when absent. */
  clusters?: string[];
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
          ...(Array.isArray(env.clusters) && {
            clusters: env.clusters.filter((c): c is string => typeof c === 'string'),
          }),
        },
      ];
    }),
  );
}

/** Why a conduktor.yaml environment name cannot be a folder (or a pipeline job's argument), if it cannot. */
export function folderNameProblem(name: string): string | undefined {
  return environmentName(name) === name
    ? undefined
    : `${REPO_CONFIG}: "${name}" is not a folder name; use letters, digits, ".", "_" and "-".`;
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
    const problem = folderNameProblem(bound);
    return problem ? { problem } : { environment: bound };
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

/** Sets what is given and leaves the rest; `clusters: null` goes back to every cluster. */
export function withEnvironment(
  text: string | undefined,
  name: string,
  config: Omit<EnvironmentConfig, 'clusters'> & { clusters?: string[] | null },
): string {
  const document = load(text ?? '');
  if (!isMap(document.contents)) document.contents = document.createNode({});
  if (config.console !== undefined) document.setIn(['environments', name, 'console'], config.console);
  if (config.kinds !== undefined)
    document.setIn(['environments', name, 'kinds'], document.createNode(config.kinds, { flow: true }));
  if (config.clusters === null) document.deleteIn(['environments', name, 'clusters']);
  else if (config.clusters !== undefined)
    document.setIn(['environments', name, 'clusters'], document.createNode(config.clusters, { flow: true }));
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
  const [error] = document.errors;
  if (error) throw new Error(`${REPO_CONFIG}: ${error.message}`);
  return document;
}

function sameConsole(a: string | undefined, b: string): boolean {
  return a?.replace(/\/+$/, '') === b.replace(/\/+$/, '');
}
