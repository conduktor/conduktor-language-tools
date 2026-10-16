import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { installMcpServer } from '../src/agents/mcpInstall';

let root: string;
let dist: string;
let storage: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'conduktor-mcp-install-'));
  dist = join(root, 'extensions', 'conduktor.conduktor-console-0.0.1', 'dist');
  storage = join(root, 'globalStorage', 'mcp');
  mkdirSync(dist, { recursive: true });
  writeFileSync(join(dist, 'mcp-server.js'), 'server v1');
  writeFileSync(join(dist, 'public-api-doc.yaml'), 'openapi v1');
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const installed = (file: string) => readFileSync(join(storage, file), 'utf8');

describe('installMcpServer', () => {
  it('copies the server and the OpenAPI it reads next to itself out of the versioned extension folder', async () => {
    expect(await installMcpServer(dist, storage, '0.0.1')).toBe(join(storage, 'mcp-server.js'));
    expect(installed('mcp-server.js')).toBe('server v1');
    expect(installed('public-api-doc.yaml')).toBe('openapi v1');
  });

  it('leaves an installed copy alone while the extension is the same', async () => {
    await installMcpServer(dist, storage, '0.0.1');
    writeFileSync(join(storage, 'mcp-server.js'), 'still running');
    await installMcpServer(dist, storage, '0.0.1');
    expect(installed('mcp-server.js')).toBe('still running');
  });

  it('refreshes the copy when the extension version changes', async () => {
    await installMcpServer(dist, storage, '0.0.1');
    writeFileSync(join(dist, 'public-api-doc.yaml'), 'openapi v2');
    await installMcpServer(dist, storage, '0.0.2');
    expect(installed('public-api-doc.yaml')).toBe('openapi v2');
  });

  it('refreshes the copy when a rebuild keeps the version but changes the server', async () => {
    await installMcpServer(dist, storage, '0.0.1');
    writeFileSync(join(dist, 'mcp-server.js'), 'server v1, rebuilt');
    await installMcpServer(dist, storage, '0.0.1');
    expect(installed('mcp-server.js')).toBe('server v1, rebuilt');
  });
});
