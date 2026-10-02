import { describe, expect, it, vi } from 'vitest';
import { ConsoleClient, normaliseBaseUrl, type RequestEvent } from '../src/client/consoleClient';
import { ConsoleError, NetworkError } from '../src/client/errors';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function client(handler: Handler, onRequest?: (e: RequestEvent) => void) {
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) =>
    handler(new URL(String(input)), init ?? {}),
  );
  return {
    fetch,
    client: new ConsoleClient({
      baseUrl: 'http://console:8080',
      token: 'secret',
      userAgent: 'VSCode/0.0.1',
      fetch: fetch as unknown as typeof globalThis.fetch,
      onRequest,
    }),
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('normaliseBaseUrl', () => {
  it.each([
    ['http://console:8080', 'http://console:8080'],
    ['http://console:8080/', 'http://console:8080'],
    ['http://console:8080/api', 'http://console:8080'],
    ['http://console:8080/api/', 'http://console:8080'],
    ['  https://console.example.com/sub/path//  ', 'https://console.example.com/sub/path'],
  ])('%s → %s', (input, expected) => expect(normaliseBaseUrl(input)).toBe(expected));
});

describe('ConsoleClient', () => {
  it('calls whoami under /api with the bearer token and client header', async () => {
    const { client: c, fetch } = client(() => json({ type: 'PersonalAccessToken', id: '1', email: 'a@b', name: 'n' }));
    await expect(c.whoami()).resolves.toMatchObject({ type: 'PersonalAccessToken' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://console:8080/api/token/v1/whoami');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret', 'X-CDK-CLIENT': 'VSCode/0.0.1' });
  });

  it('fetches the OpenAPI document without credentials', async () => {
    const { client: c, fetch } = client(() => new Response('openapi: 3.1.0'));
    await expect(c.fetchOpenApiText()).resolves.toBe('openapi: 3.1.0');
    expect(String(fetch.mock.calls[0]![0])).toBe('http://console:8080/api/public/docs/docs.yaml');
    expect(fetch.mock.calls[0]![1]?.headers).not.toHaveProperty('Authorization');
  });

  it('dry-runs with dryMode=true, query parents and a JSON body', async () => {
    const resource = { apiVersion: 'v3', kind: 'Alert', metadata: { name: 'a', group: 'ops' } };
    const { client: c, fetch } = client(() => json({ resource, upsertResult: 'NotChanged' }));
    await expect(
      c.upsert({ path: '/public/monitoring/v3/alert', query: { group: 'ops' } }, resource, { dryRun: true }),
    ).resolves.toEqual({ resource, upsertResult: 'NotChanged' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://console:8080/api/public/monitoring/v3/alert?group=ops&dryMode=true');
    expect(init).toMatchObject({ method: 'PUT', body: JSON.stringify(resource) });
    expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });

  it('applies without dryMode when not dry-running', async () => {
    const resource = { apiVersion: 'v1', kind: 'Application', metadata: { name: 'shop' } };
    const { client: c, fetch } = client(() => json({ resource, upsertResult: 'Created' }));
    await c.upsert({ path: '/public/self-serve/v1/application', query: {} }, resource, { dryRun: false });
    expect(String(fetch.mock.calls[0]![0])).toBe('http://console:8080/api/public/self-serve/v1/application');
  });

  it('deletes with the bearer token and ignores the response body', async () => {
    const { client: c, fetch } = client(() => new Response(null, { status: 204 }));
    await expect(c.delete('/public/kafka/v2/cluster/local/topic/orders')).resolves.toBeUndefined();
    const [url, init] = fetch.mock.calls[0]!;
    expect(String(url)).toBe('http://console:8080/api/public/kafka/v2/cluster/local/topic/orders');
    expect(init).toMatchObject({ method: 'DELETE', headers: { Authorization: 'Bearer secret' } });
  });

  it('reports a failed delete', async () => {
    const { client: c } = client(() => json({ title: 'Topic not found' }, 404));
    await expect(c.delete('/public/x/y')).rejects.toMatchObject({ status: 404, title: 'Topic not found' });
  });

  it('turns a Console error body into a ConsoleError', async () => {
    const { client: c } = client(() =>
      json({ title: 'Policy violation', msg: '- partitions must be < 10\n- name must start with app-' }, 422),
    );
    const error = await c.get('/public/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConsoleError);
    expect(error).toMatchObject({
      status: 422,
      title: 'Policy violation',
      message: 'Policy violation: - partitions must be < 10\n- name must start with app-',
    });
  });

  it('keeps an HTML error page out of the message', async () => {
    const { client: c } = client(
      () =>
        new Response('<html><body><h1>502 Bad Gateway</h1></body></html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(c.get('/public/x')).rejects.toThrow(/^HTTP 502 Bad Gateway$/);
  });

  it('says the URL is not a Console when a JSON call gets a web page back', async () => {
    const { client: c } = client(
      () => new Response('<!doctype html><html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    );
    await expect(c.whoami()).rejects.toThrow(
      'http://console:8080 did not answer like a Conduktor Console (got text/html). Check the URL.',
    );
  });

  it('copes with an empty error body', async () => {
    const { client: c } = client(() => new Response('', { status: 500 }));
    await expect(c.get('/public/x')).rejects.toMatchObject({ status: 500, message: 'HTTP 500' });
  });

  it('reports an unreachable Console as a NetworkError with the cause', async () => {
    const events: RequestEvent[] = [];
    const { client: c } = client(
      () => {
        throw new TypeError('fetch failed', { cause: new Error('connect ECONNREFUSED 127.0.0.1:8080') });
      },
      (e) => events.push(e),
    );
    const error = await c.whoami().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as Error).message).toBe('Cannot reach http://console:8080: connect ECONNREFUSED 127.0.0.1:8080');
    expect(events[0]).toMatchObject({ method: 'GET', path: '/api/token/v1/whoami', status: 'network-error' });
  });

  it('explains a refused localhost connection, which Node reports as an AggregateError without a message', async () => {
    const refused = (address: string) =>
      Object.assign(new Error(`connect ECONNREFUSED ${address}`), { code: 'ECONNREFUSED' });
    const { client: c } = client(() => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new AggregateError([refused('::1:7070'), refused('127.0.0.1:7070')], ''), {
          code: 'ECONNREFUSED',
        }),
      });
    });
    await expect(c.whoami()).rejects.toThrow(
      'Cannot reach http://console:8080: connect ECONNREFUSED ::1:7070; connect ECONNREFUSED 127.0.0.1:7070',
    );
  });

  it('reports each request with its status', async () => {
    const events: RequestEvent[] = [];
    const { client: c } = client(
      () => json([]),
      (e) => events.push(e),
    );
    await c.list('/public/kafka/v2/cluster/local/topic');
    expect(events).toEqual([
      expect.objectContaining({ method: 'GET', path: '/api/public/kafka/v2/cluster/local/topic', status: 200 }),
    ]);
  });
});
