import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConsoleClient, loadSpec, openSegment, Telemetry, workspaceFile, type ToolContext } from '@conduktor/core';
import { createConduktorServer } from './server';

declare const CONDUKTOR_VERSION: string;
// Set in release builds only: any other build sends nothing.
declare const SEGMENT_WRITE_KEY: string;

const noCache = { read: () => Promise.resolve(undefined), write: () => Promise.resolve() };

async function main(): Promise<void> {
  const url = process.env.CONDUKTOR_URL;
  if (!url) throw new Error('CONDUKTOR_URL is required, for example http://localhost:8080');
  const client = new ConsoleClient({
    baseUrl: url,
    token: process.env.CONDUKTOR_TOKEN,
    userAgent: `ConduktorMCP/${CONDUKTOR_VERSION}`,
  });
  const name = process.env.CONDUKTOR_NAME;
  const connectionName = name === undefined || name === '' ? new URL(client.baseUrl).host : name;
  const readRelative = (file: string) => readFileSync(workspaceFile(process.cwd(), file), 'utf8');

  let context: Promise<ToolContext> | undefined;
  const loadContext = () =>
    (context ??= loadSpec({
      cacheKey: client.baseUrl,
      fetchText: () => client.fetchOpenApiText(),
      cache: noCache,
      snapshotText: () => readFile(join(__dirname, 'public-api-doc.yaml'), 'utf8'),
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

  const telemetry = new Telemetry(openSegment(SEGMENT_WRITE_KEY, process.env, homedir()), {
    surface: 'mcp',
    client: 'other',
    extensionVersion: CONDUKTOR_VERSION,
  });
  // The client closing stdin ends the process: what is left is sent first.
  process.once('beforeExit', () => void telemetry.dispose());
  await createConduktorServer(loadContext, CONDUKTOR_VERSION, telemetry).connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
