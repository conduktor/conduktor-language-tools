import type { Target } from '../openapi/paths';
import type { Resource, UpsertResponse } from '../resources/types';
import { ConsoleError, describeError, NetworkError } from './errors';
import type { TokenInfo } from './tokenInfo';

export interface RequestEvent {
  method: string;
  path: string;
  status: number | 'network-error';
  durationMs: number;
}

export interface ConsoleClientOptions {
  baseUrl: string;
  token?: string;
  userAgent: string;
  fetch?: typeof fetch;
  onRequest?: (event: RequestEvent) => void;
}

interface SendOptions {
  query?: Readonly<Record<string, string>>;
  body?: unknown;
  authenticated?: boolean;
}

export function normaliseBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed.slice(0, -'/api'.length) : trimmed;
}

export class ConsoleClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ConsoleClientOptions) {
    this.baseUrl = normaliseBaseUrl(options.baseUrl);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  async fetchOpenApiText(): Promise<string> {
    return (await this.send('GET', '/public/docs/docs.yaml', { authenticated: false })).text();
  }

  async whoami(): Promise<TokenInfo> {
    return (await (await this.send('GET', '/token/v1/whoami')).json()) as TokenInfo;
  }

  async list(path: string, query?: Readonly<Record<string, string>>): Promise<Resource[]> {
    return (await (await this.send('GET', path, { query })).json()) as Resource[];
  }

  async get(path: string): Promise<Resource> {
    return (await (await this.send('GET', path)).json()) as Resource;
  }

  async upsert(target: Target, resource: Resource, options: { dryRun: boolean }): Promise<UpsertResponse> {
    const query = options.dryRun ? { ...target.query, dryMode: 'true' } : target.query;
    return (await (await this.send('PUT', target.path, { query, body: resource })).json()) as UpsertResponse;
  }

  private async send(method: string, path: string, options: SendOptions = {}): Promise<Response> {
    const url = new URL(`${this.baseUrl}/api${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) url.searchParams.set(name, value);
    const headers: Record<string, string> = { 'X-CDK-CLIENT': this.options.userAgent };
    if (options.authenticated !== false && this.options.token) headers.Authorization = `Bearer ${this.options.token}`;
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';

    const logged = { method, path: `${url.pathname}${url.search}` };
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
      });
    } catch (error) {
      this.options.onRequest?.({ ...logged, status: 'network-error', durationMs: Date.now() - started });
      throw new NetworkError(`Cannot reach ${this.baseUrl}: ${networkReason(error)}`, { cause: error });
    }
    this.options.onRequest?.({ ...logged, status: response.status, durationMs: Date.now() - started });
    if (!response.ok) throw await ConsoleError.fromResponse(response);
    return response;
  }
}

function networkReason(error: unknown): string {
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (cause instanceof AggregateError && !cause.message) return cause.errors.map(describeError).join('; ');
  return describeError(cause);
}
