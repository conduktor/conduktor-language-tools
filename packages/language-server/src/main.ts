import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { openSegment, Telemetry } from '@conduktor/core';
import { envValue } from './connectionSettings';
import { startServer } from './server';

declare const CONDUKTOR_VERSION: string;
// Set in release builds only: any other build sends nothing.
declare const SEGMENT_WRITE_KEY: string;

const env = process.env;
const connection = createConnection(ProposedFeatures.all);
startServer(connection, {
  version: CONDUKTOR_VERSION,
  cacheDir: join(envValue(env, 'XDG_CACHE_HOME') ?? join(homedir(), '.cache'), 'conduktor', 'language-server'),
  env,
  home: homedir(),
  // Bundled next to this file, for a Console that cannot be reached, or none at all.
  snapshotText: () => readFile(join(__dirname, 'public-api-doc.yaml'), 'utf8'),
  telemetry: new Telemetry(openSegment(SEGMENT_WRITE_KEY, env, homedir()), {
    surface: 'editor',
    client: 'other',
    extensionVersion: CONDUKTOR_VERSION,
  }),
});
connection.listen();
