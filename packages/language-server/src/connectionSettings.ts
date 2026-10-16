import { isRecord, type ConnectionMode } from '@conduktor/vscode-core';

/** Where Zed users write the settings this server reads, for messages that point them there. */
export const SETTINGS_PATH = 'lsp.conduktor-console.settings';

/** The section a client is asked for, and that Zed's extension wraps the settings in. */
export const SETTINGS_SECTION = 'conduktor';

/** Variables that hold a Console credential: a resource's ${VAR} never expands to them. */
export const CREDENTIAL_VARIABLES = ['CONDUKTOR_TOKEN', 'CDK_API_KEY', 'CDK_PASSWORD'] as const;

export interface Connection {
  name: string;
  url: string;
  mode: ConnectionMode;
  token: string | undefined;
  /** Named in the server's settings, or taken from the conduktor CLI's environment. */
  from: 'settings' | 'cli';
}

export class ConnectionSettingsError extends Error {}

/**
 * The Console named in the server's settings; without them, the one the conduktor CLI points at (CDK_BASE_URL and
 * CDK_API_KEY), so a CLI user has nothing to set up; `undefined` when neither names one. A Console the settings name
 * takes its token from them, or from CONDUKTOR_TOKEN as for the MCP server.
 *
 * A project's settings can name another Console than the user's, and reach the token. Zed applies a project's settings
 * only once its folder is trusted, and a trusted project's settings can already replace any language server's binary:
 * this adds nothing a trusted project cannot already do.
 */
export function connectionFrom(settings: unknown, env: NodeJS.ProcessEnv): Connection | undefined {
  const fail = (where: string, problem: string) => new ConnectionSettingsError(`${where}: ${problem}`);
  const noSettings =
    settings === undefined || settings === null || (isRecord(settings) && !Object.keys(settings).length);
  if (noSettings) {
    const url = env.CDK_BASE_URL;
    if (!url) return undefined;
    if (!isHttpUrl(url)) throw fail('CDK_BASE_URL', `${url} is not an http(s) address`);
    return { name: new URL(url).host, url, mode: 'prod', token: env.CDK_API_KEY || undefined, from: 'cli' };
  }
  if (!isRecord(settings)) throw fail(SETTINGS_PATH, 'expected an object with a "url"');

  const { url, name, mode, token } = settings;
  if (typeof url !== 'string' || !isHttpUrl(url)) {
    throw fail(SETTINGS_PATH, '"url" must be the Console\'s http(s) address, for example http://localhost:8080');
  }
  if (name !== undefined && (typeof name !== 'string' || !name))
    throw fail(SETTINGS_PATH, '"name" must be a non-empty string');
  if (mode !== undefined && mode !== 'dev' && mode !== 'prod')
    throw fail(SETTINGS_PATH, '"mode" must be "dev" or "prod"');
  if (token !== undefined && (typeof token !== 'string' || !token))
    throw fail(SETTINGS_PATH, '"token" must be a non-empty string');

  return {
    name: name ?? new URL(url).host,
    url,
    mode: mode ?? 'prod',
    token: token ?? (env.CONDUKTOR_TOKEN || undefined),
    from: 'settings',
  };
}

function isHttpUrl(url: string): boolean {
  return URL.canParse(url) && /^https?:$/.test(new URL(url).protocol);
}
