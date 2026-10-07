import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConsoleClient, loadSpec, workspaceFile, type ToolContext } from '@conduktor/vscode-core';
import { createConduktorServer } from './server';

declare const CONDUKTOR_VERSION: string;

const noCache = { read: async () => undefined, write: async () => undefined };

async function main(): Promise<void> {
  const url = process.env.CONDUKTOR_URL;
  if (!url) throw new Error('CONDUKTOR_URL is required, for example http://localhost:8080');
  const client = new ConsoleClient({
    baseUrl: url,
    token: process.env.CONDUKTOR_TOKEN,
    userAgent: `ConduktorMCP/${CONDUKTOR_VERSION}`,
  });
  const connectionName = process.env.CONDUKTOR_NAME || new URL(client.baseUrl).host;
  const readRelative = (file: string) => readFileSync(workspaceFile(process.cwd(), file), 'utf8');

  let context: Promise<ToolContext> | undefined;
  const loadContext = () =>
    (context ??= loadSpec({
      cacheKey: client.baseUrl,
      fetchText: () => client.fetchOpenApiText(),
      cache: noCache,
      snapshotText: async () => readFileSync(join(__dirname, 'public-api-doc.yaml'), 'utf8'),
    }).then((spec) => {
      if (spec.liveError) console.error(`Using the ${spec.source} OpenAPI for ${connectionName}: ${spec.liveError}`);
      return {
        connectionName,
        catalog: spec.catalog,
        schema: spec.schema,
        client,
        readFile: readRelative,
        readInclude: readRelative,
      };
    }));

  await createConduktorServer(loadContext, CONDUKTOR_VERSION).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
