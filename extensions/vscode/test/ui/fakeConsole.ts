import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

export interface FakeConsole {
  url: string;
  /** The resources applied, not dry-run: `cluster/topic/name`. */
  applied: string[];
  close(): void;
}

const CLUSTERS = ['local-kafka', 'other-kafka'];
const TOPICS = /^\/api\/public\/kafka\/v2\/cluster\/([^/?]+)\/topic(?:\?(.*))?$/;

/**
 * Just enough of a Console for a first connection and a first topic: the token `secret` as an admin key, its OpenAPI
 * (the extension's bundled one), two clusters, and topics dry-run or applied as created.
 */
export async function fakeConsole(openApiPath: string): Promise<FakeConsole> {
  const applied: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      const json = (status: number, value: unknown) =>
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
      const url = request.url ?? '';
      const topics = TOPICS.exec(url);
      if (url === '/api/public/docs/docs.yaml') {
        response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(readFileSync(openApiPath, 'utf8'));
      } else if (request.headers.authorization !== 'Bearer secret') {
        json(401, { title: 'Unauthorized' });
      } else if (url === '/api/token/v1/whoami') {
        json(200, { type: 'AdminToken', name: 'ui' });
      } else if (request.method === 'GET' && url === '/api/public/console/v2/kafka-cluster') {
        json(
          200,
          CLUSTERS.map((name) => ({ apiVersion: 'v2', kind: 'KafkaCluster', metadata: { name }, spec: {} })),
        );
      } else if (request.method === 'PUT' && topics) {
        const topic = JSON.parse(body) as { metadata: { name: string } };
        const key = `${topics[1]}/topic/${topic.metadata.name}`;
        if (!topics[2]?.includes('dryMode=true')) applied.push(key);
        json(200, { resource: topic, upsertResult: 'Created' });
      } else if (request.method === 'GET') {
        json(200, []);
      } else {
        json(404, { title: 'Not found' });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    applied,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}
