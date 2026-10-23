import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildServer, useServers } from './harness';

const servers = useServers();

interface Message {
  event: string;
  anonymousId: string;
  properties: Record<string, unknown>;
}

/** Segment's batch endpoint: what reached it, and with which credentials. */
async function fakeSegment() {
  const received: Message[] = [];
  const authorizations: (string | undefined)[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      authorizations.push(request.headers.authorization);
      received.push(...(JSON.parse(body) as { batch: Message[] }).batch);
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1/batch`, received, authorizations, close: () => server.close() };
}

const topic = `apiVersion: v2
kind: Topic
metadata:
  name: secret-project-orders
  cluster: local-kafka
spec:
  partitions: 1
  replicationFactor: 1
`;

describe('telemetry', () => {
  let build: string;
  beforeAll(() => {
    build = buildServer('test-key');
  }, 60_000);

  it('reports what happens in the editor, and nothing anyone wrote', async () => {
    const segment = await fakeSegment();
    const server = await servers.start(
      {
        settings: { url: servers.fake.url, name: 'fake' },
        env: { CONDUKTOR_TOKEN: 'secret', CONDUKTOR_TELEMETRY_URL: segment.url },
      },
      build,
    );
    const uri = 'file:///work/orders.yaml';
    server.open(uri, topic);
    await server.diagnostics(uri, () => true);
    await server.command('conduktor.dryRun', uri);
    await server.connection.sendRequest('shutdown');
    segment.close();

    const events = segment.received.map((m) => m.event);
    expect(events).toEqual(
      expect.arrayContaining([
        'cdk.extension.Started',
        'cdk.extension.console.Connected',
        'cdk.extension.resources.Checked',
        'cdk.extension.Lived',
      ]),
    );
    expect(segment.authorizations).toContain(`Basic ${Buffer.from('test-key:').toString('base64')}`);
    const checked = segment.received.find((m) => m.event === 'cdk.extension.resources.Checked');
    expect(checked?.properties).toMatchObject({
      surface: 'editor',
      client: 'zed',
      clientVersion: '1.24.2',
      resources: 1,
      kinds: ['Topic'],
    });
    expect(segment.received.find((m) => m.event === 'cdk.extension.console.Connected')?.properties).toMatchObject({
      mode: 'prod',
      token: 'admin',
    });
    expect(new Set(segment.received.map((m) => m.anonymousId)).size).toBe(1);
    const sent = JSON.stringify(segment.received);
    for (const written of ['secret-project-orders', 'local-kafka', 'orders.yaml', new URL(servers.fake.url).host])
      expect(sent).not.toContain(written);
  }, 30_000);

  it('sends nothing when the environment opts out', async () => {
    const segment = await fakeSegment();
    const server = await servers.start(
      {
        settings: { url: servers.fake.url, name: 'fake' },
        env: { CONDUKTOR_TOKEN: 'secret', CONDUKTOR_TELEMETRY_URL: segment.url, DO_NOT_TRACK: '1' },
      },
      build,
    );
    server.open('file:///work/quiet.yaml', topic);
    await server.command('conduktor.dryRun', 'file:///work/quiet.yaml');
    await server.connection.sendRequest('shutdown');
    segment.close();
    expect(segment.received).toEqual([]);
  }, 30_000);
});
