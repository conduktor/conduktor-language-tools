import { copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SERVER = 'mcp-server.js';
// The server falls back to the OpenAPI next to it when the Console's cannot be fetched.
const FILES = [SERVER, 'public-api-doc.yaml'];
const STAMP = '.installed';

// Copied out of the extension folder, whose name carries the version, so a config pointing here survives updates.
// Every development build is the same version, so the stamp also tracks the bundle itself.
export async function installMcpServer(dist: string, target: string, version: string): Promise<string> {
  const { size, mtimeMs } = await stat(join(dist, SERVER));
  const stamp = `${version} ${size} ${mtimeMs}`;
  const installed = await readFile(join(target, STAMP), 'utf8').catch(() => undefined);
  if (installed !== stamp) {
    await mkdir(target, { recursive: true });
    for (const file of FILES) await copyFile(join(dist, file), join(target, file));
    await writeFile(join(target, STAMP), stamp);
  }
  return join(target, SERVER);
}
