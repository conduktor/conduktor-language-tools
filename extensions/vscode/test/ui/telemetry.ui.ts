import { cpSync, mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fakeConsole, type FakeConsole } from './fakeConsole';
import { Workbench } from './workbench';

const extension = fileURLToPath(new URL('../../', import.meta.url));
const SOON = { timeout: 30_000, interval: 250 };

interface Message {
  event: string;
  properties: Record<string, unknown>;
}

/** Segment's batch endpoint: what reached it. */
async function fakeSegment() {
  const received: Message[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      received.push(...(JSON.parse(body) as { batch: Message[] }).batch);
      response.end('{}');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}/v1/batch`, received, close: () => server.close() };
}

/** The extension as a release builds it, with a write key: in a folder of its own, so no other test sends events. */
async function releaseBuild(): Promise<string> {
  const directory = mkdtempSync(join(tmpdir(), 'conduktor-telemetry-'));
  for (const part of ['package.json', 'resources', 'walkthrough', 'dist/public-api-doc.yaml'])
    cpSync(join(extension, part), join(directory, part), { recursive: true });
  await build({
    entryPoints: [join(extension, 'src/extension.ts')],
    bundle: true,
    outfile: join(directory, 'dist/extension.js'),
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['vscode'],
    define: { SEGMENT_WRITE_KEY: '"test-key"' },
    logLevel: 'silent',
  });
  return directory;
}

describe('telemetry', () => {
  let console: FakeConsole;
  let segment: Awaited<ReturnType<typeof fakeSegment>>;
  let built: string;
  let vscode: Workbench;
  beforeAll(async () => {
    console = await fakeConsole(join(extension, 'dist/public-api-doc.yaml'));
    segment = await fakeSegment();
    built = await releaseBuild();
  }, 60_000);
  afterEach(async ({ task }) => {
    if (task.result?.state === 'fail') await vscode.screenshot(task.name);
    await vscode.close();
  });
  afterAll(() => {
    console.close();
    segment.close();
  });

  it("reaches Segment through VS Code's telemetry logger, with nothing anyone wrote", async () => {
    vscode = await Workbench.open({
      extension: built,
      env: { CONDUKTOR_TELEMETRY_URL: segment.url, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'config-')) },
    });
    await vscode.command('Conduktor: Add Connection');
    await vscode.answer('Conduktor Console URL', console.url);
    await vscode.answer('Personal access token', 'secret');
    await vscode.answer('Connection name', 'acme-production');
    await vscode.answer('What may this connection change?', 'Prod');
    // Connected once the status bar says so: a command sooner would go to a palette the last prompt closes.
    await vscode.page.getByText('acme-production · admin · prod').waitFor();
    await vscode.command('Conduktor: New Resource…');
    await vscode.answer('New Conduktor resource', 'Topic');
    await vscode.answer('New Topic: which cluster?', 'local-kafka');
    await vscode.dismiss('Where should Conduktor keep its repository?');
    await vscode.focusEditor('Untitled');
    await vscode.command('Conduktor: Dry Run File');

    const event = (name: string) => segment.received.find((m) => m.event === `cdk.extension.${name}`);
    await expect.poll(() => event('resources.Checked'), SOON).toBeDefined();
    expect(segment.received.map((m) => m.event)).toEqual(
      expect.arrayContaining([
        'cdk.extension.Started',
        'cdk.extension.connection.Added',
        'cdk.extension.console.Connected',
        'cdk.extension.resource.Drafted',
        'cdk.extension.resources.Checked',
      ]),
    );
    expect(event('resources.Checked')?.properties).toMatchObject({
      surface: 'editor',
      client: 'vscode',
      clientVersion: expect.stringMatching(/^\d+\.\d+\.\d+/) as unknown,
      kinds: ['Topic'],
      resources: 1,
    });
    expect(event('connection.Added')?.properties).toMatchObject({ mode: 'prod', token: 'admin' });
    const sent = JSON.stringify(segment.received);
    for (const written of ['acme-production', 'local-kafka', new URL(console.url).host])
      expect(sent).not.toContain(written);
  });
});
