import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createConnection, ProposedFeatures } from 'vscode-languageserver/node';
import { startServer } from './server';

declare const CONDUKTOR_VERSION: string;

const env = process.env;
const connection = createConnection(ProposedFeatures.all);
startServer(connection, {
  version: CONDUKTOR_VERSION,
  cacheDir: join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'conduktor', 'language-server'),
  env,
  home: homedir(),
  // Bundled next to this file, for a Console that cannot be reached, or none at all.
  snapshotText: () => readFile(join(__dirname, 'public-api-doc.yaml'), 'utf8'),
});
connection.listen();
