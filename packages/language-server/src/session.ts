import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  buildSpec,
  capabilityOf,
  ConsoleClient,
  describeError,
  describeToken,
  loadSpec,
  type Capability,
  type LoadedSpec,
  type SpecCache,
} from '@conduktor/core';
import { ConnectionSettingsError, connectionFrom, SETTINGS_PATH, type Connection } from './connectionSettings';

export interface SessionOptions {
  version: string;
  cacheDir: string;
  env: NodeJS.ProcessEnv;
  snapshotText: () => Promise<string>;
}

interface Alert {
  level: 'error' | 'warning';
  message: string;
}

export interface Session {
  spec: LoadedSpec;
  connection?: Connection;
  /** Only once the Console accepted the token: what dry runs and applies go through. */
  client?: ConsoleClient;
  /** What the token may do, once the Console accepted it. */
  capability?: Capability;
  /** For the user's eyes: why the schema is not the Console's own, or why there are no dry runs. */
  alerts: Alert[];
  /** For the log. */
  info: string;
}

export type ReadySession = Session & Required<Pick<Session, 'client' | 'connection'>>;

/** Whether dry runs can go through: a Console that accepted the token. */
export function isReady(session: Session): session is ReadySession {
  return session.client !== undefined && session.connection !== undefined;
}

const REQUEST_TIMEOUT_MS = 20_000;

const BUNDLED = 'checking against the schema bundled with this server';

/** A session for the Console the settings name: its schema and, once it accepts the token, a client for dry runs. */
export async function openSession(options: SessionOptions, settings: unknown): Promise<Session> {
  let connection: Connection | undefined;
  try {
    connection = connectionFrom(settings, options.env);
  } catch (error) {
    if (!(error instanceof ConnectionSettingsError)) throw error;
    const message = `${error.message}. Until it is fixed, ${BUNDLED}.`;
    return { spec: await snapshot(options), alerts: [{ level: 'error', message }], info: message };
  }
  if (!connection) {
    return { spec: await snapshot(options), alerts: [], info: `No Console in ${SETTINGS_PATH}: ${BUNDLED}.` };
  }

  const client = new ConsoleClient({
    baseUrl: connection.url,
    token: connection.token,
    userAgent: `ConduktorLanguageServer/${options.version}`,
    // A Console that never answers (a VPN down, a host that drops packets) fails, rather than holding dry runs forever.
    fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
  });
  const spec = await loadSpec({
    cacheKey: client.baseUrl,
    fetchText: () => client.fetchOpenApiText(),
    cache: new FileSpecCache(options.cacheDir),
    snapshotText: options.snapshotText,
  });
  const alerts: Alert[] = [];
  if (spec.liveError)
    alerts.push({
      level: 'warning',
      message: `${connection.name}: using the ${spec.source} OpenAPI, the Console's could not be read (${spec.liveError}).`,
    });
  const token = await verifyToken(client, connection);
  if (!token.accepted) alerts.push({ level: 'warning', message: token.why });
  const where = `${connection.name} (${client.baseUrl}, ${connection.mode}${connection.from === 'cli' ? ", from the conduktor CLI's CDK_BASE_URL" : ''})`;
  return {
    spec,
    connection,
    ...(token.accepted && { client, capability: token.capability }),
    alerts,
    info: `Connected to ${where}, with the ${spec.source} OpenAPI${token.accepted ? `, as ${token.who}` : ''}.`,
  };
}

async function verifyToken(
  client: ConsoleClient,
  connection: Connection,
): Promise<{ accepted: true; who: string; capability: Capability } | { accepted: false; why: string }> {
  if (!connection.token)
    return {
      accepted: false,
      why:
        connection.from === 'cli'
          ? `CDK_BASE_URL names ${connection.name} but there is no CDK_API_KEY: no dry runs, only its schema.`
          : `No "token" in ${SETTINGS_PATH} and no CONDUKTOR_TOKEN: no dry runs on ${connection.name}, only its schema.`,
    };
  try {
    const info = await client.whoami();
    return { accepted: true, who: describeToken(info), capability: capabilityOf(info) };
  } catch (error) {
    return {
      accepted: false,
      why: `${connection.name} refused the token (${describeError(error)}): no dry runs, only its schema.`,
    };
  }
}

async function snapshot(options: SessionOptions): Promise<LoadedSpec> {
  return buildSpec(await options.snapshotText(), 'snapshot');
}

/** The last OpenAPI read from each Console, for when it cannot be reached. */
class FileSpecCache implements SpecCache {
  constructor(private readonly directory: string) {}

  async read(key: string): Promise<string | undefined> {
    return readFile(this.file(key), 'utf8').catch(() => undefined);
  }

  async write(key: string, text: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.file(key), text);
  }

  private file(key: string): string {
    return join(this.directory, `openapi-${createHash('sha1').update(key).digest('hex').slice(0, 16)}.yaml`);
  }
}
