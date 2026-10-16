import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { CodeAction, CodeLens } from 'vscode-languageserver';
import { buildServer, fakeConsole, startServer, type FakeConsole, type StartOptions, type Started } from './harness';

let directory: string;
let fake: FakeConsole;
const running: Started[] = [];

beforeAll(async () => {
  fake = await fakeConsole();
  directory = buildServer();
}, 60_000);

afterAll(() => {
  running.forEach((server) => server.stop());
  fake?.close();
});

async function start(mode: 'dev' | 'prod', options: Omit<StartOptions, 'settings'> = {}): Promise<Started> {
  const server = await startServer(directory, { settings: { url: fake.url, name: 'fake', mode }, ...options });
  running.push(server);
  return server;
}

// Each test writes to its own cluster, so the requests it looks at are its own.
const topics = (cluster: string) =>
  [
    'apiVersion: v2',
    'kind: Topic',
    `metadata: { name: orders, cluster: ${cluster} }`,
    'spec: { partitions: 3, replicationFactor: 1 }',
    '---',
    'apiVersion: v2',
    'kind: Topic',
    `metadata: { name: huge, cluster: ${cluster} }`,
    'spec: { partitions: 100, replicationFactor: 1 }',
  ].join('\n');

const requestsTo = (cluster: string) => fake.requests.filter((r) => r.url.includes(`/cluster/${cluster}/`));
const applied = (cluster: string) =>
  requestsTo(cluster).filter((r) => r.method === 'PUT' && !r.url.includes('dryMode'));

async function lenses(server: Started, uri: string): Promise<string[]> {
  const found: CodeLens[] = await server.connection.sendRequest('textDocument/codeLens', { textDocument: { uri } });
  return found.map((lens) => lens.command!.title);
}

async function actions(server: Started, uri: string, line: number): Promise<CodeAction[]> {
  const position = { line, character: 0 };
  return server.connection.sendRequest('textDocument/codeAction', {
    textDocument: { uri },
    range: { start: position, end: position },
    context: { diagnostics: [] },
  });
}

describe('dry runs against the Console', () => {
  it("dry-runs a file once opened, and puts what the Console refuses on the resource's first line", async () => {
    const server = await start('prod');
    const uri = 'file:///work/opened.yaml';
    server.open(uri, topics('c-open'));

    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => /partitions must be <= 12/.test(x.message)));
    const refused = diagnostics.find((d) => /partitions must be <= 12/.test(d.message))!;
    expect(refused).toMatchObject({ source: 'Conduktor', severity: 1, range: { start: { line: 5 } } });
    expect(requestsTo('c-open').map((r) => [r.method, r.url.split('?')[1], r.authorization])).toEqual([
      ['PUT', 'dryMode=true', 'Bearer secret'],
      ['PUT', 'dryMode=true', 'Bearer secret'],
    ]);
    expect(await lenses(server, uri)).toEqual(['Dry run all (2)', 'Dry run · ~ Updated', 'Dry run · ✗ failed']);
  }, 30_000);

  it('says what the Console would do, from a code action', async () => {
    const server = await start('prod');
    const uri = 'file:///work/action.yaml';
    server.open(uri, topics('c-action'));

    const titles = (await actions(server, uri, 1)).map((a) => a.title).filter((t) => !t.startsWith('Preset: '));
    expect(titles).toEqual([
      'Dry run Topic orders on fake',
      'Dry run the 2 resources of this file',
      'Switch fake to dev mode, to apply (until Zed restarts)',
    ]);
    const [dryRun] = await actions(server, uri, 1);
    await server.command(dryRun!.command!.command, ...dryRun!.command!.arguments!);
    expect(await server.message((m) => m.message.startsWith('Dry run on fake'))).toEqual({
      type: 3,
      message: 'Dry run on fake: 1 Updated',
    });
  }, 30_000);

  it('applies in dev, once the user confirms what the dry run found', async () => {
    const server = await start('dev', { answer: 'Apply' });
    const uri = 'file:///work/apply.yaml';
    server.open(uri, topics('c-apply'));

    const titles = (await actions(server, uri, 1)).map((a) => a.title);
    expect(titles).toContain('Apply Topic orders to fake');
    await server.command('conduktor.apply', uri, 0);
    expect(server.prompts.map((p) => p.message)).toEqual(['Apply to fake? Dry run on fake: 1 Updated.']);
    expect(applied('c-apply')).toHaveLength(1);
    expect(await server.message((m) => m.message.startsWith('Applied'))).toMatchObject({
      message: 'Applied to fake: 1 Updated',
    });
    expect(await lenses(server, uri)).toContain('Apply · ~ Updated');
  }, 30_000);

  it('applies nothing the user did not confirm', async () => {
    const server = await start('dev');
    const uri = 'file:///work/declined.yaml';
    server.open(uri, topics('c-declined'));
    await server.command('conduktor.apply', uri, 0);
    expect(server.prompts).toHaveLength(1);
    expect(applied('c-declined')).toEqual([]);
  }, 30_000);

  it('applies nothing a dry run refuses, without asking', async () => {
    const server = await start('dev', { answer: 'Apply' });
    const uri = 'file:///work/refused.yaml';
    server.open(uri, topics('c-refused'));
    await server.command('conduktor.apply', uri);
    expect(server.prompts).toEqual([]);
    expect(applied('c-refused')).toEqual([]);
    expect(await server.message((m) => m.message.startsWith('Dry run on fake'))).toEqual({
      type: 2,
      message: 'Dry run on fake: 1 Updated, 1 failed',
    });
  }, 30_000);

  it('never changes a Console in prod mode, by any route', async () => {
    const server = await start('prod', { answer: 'Apply' });
    const uri = 'file:///work/prod.yaml';
    server.open(uri, topics('c-prod'));
    expect((await actions(server, uri, 1)).map((a) => a.title).filter((t) => t.startsWith('Apply'))).toEqual([]);
    expect((await lenses(server, uri)).filter((t) => t.startsWith('Apply'))).toEqual([]);
    await server.command('conduktor.apply', uri, 0);
    expect(server.messages).toContainEqual({ type: 2, message: expect.stringMatching(/fake is in prod mode/) });
    expect(applied('c-prod')).toEqual([]);
  }, 30_000);

  it('never puts the Console token into a resource', async () => {
    const server = await start('prod');
    const uri = 'file:///work/token.yaml';
    server.open(uri, 'apiVersion: v2\nkind: Topic\nmetadata: { name: "${CONDUKTOR_TOKEN}", cluster: c-token }\n');
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => /Missing environment/.test(x.message)));
    expect(diagnostics.map((d) => d.message)).toContain('Missing environment variables: CONDUKTOR_TOKEN');
    expect(fake.requests.some((r) => r.body.includes('secret'))).toBe(false);
  }, 30_000);

  it("fills ${VAR} from the .env of the file's workspace folder", async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'conduktor-ws-'));
    mkdirSync(join(workspace, 'topics'));
    writeFileSync(join(workspace, '.env'), 'CLUSTER=c-dotenv\n');
    const server = await start('prod', { folders: [workspace] });
    const uri = pathToFileURL(join(workspace, 'topics', 'orders.yaml')).href;
    server.open(uri, 'apiVersion: v2\nkind: Topic\nmetadata: { name: orders, cluster: "${CLUSTER}" }\n');
    await server.command('conduktor.dryRun', uri);
    expect(requestsTo('c-dotenv').length).toBeGreaterThan(0);
  }, 30_000);

  it('works with nothing set up, against the Console the conduktor CLI points at', async () => {
    const server = await startServer(directory, { env: { CDK_BASE_URL: fake.url, CDK_API_KEY: 'secret' } });
    running.push(server);
    const uri = 'file:///work/cli.yaml';
    server.open(uri, topics('c-cli'));
    await server.diagnostics(uri, (d) => d.some((x) => /partitions must be <= 12/.test(x.message)));
    expect(requestsTo('c-cli').every((r) => r.authorization === 'Bearer secret')).toBe(true);
    expect(server.messages).toEqual([]);
  }, 30_000);

  it("never puts the CLI's API key into a resource", async () => {
    const server = await startServer(directory, { env: { CDK_BASE_URL: fake.url, CDK_API_KEY: 'secret' } });
    running.push(server);
    const uri = 'file:///work/cli-key.yaml';
    server.open(uri, 'apiVersion: v2\nkind: Topic\nmetadata: { name: "${CDK_API_KEY}", cluster: c-cli-key }\n');
    const diagnostics = await server.diagnostics(uri, (d) => d.some((x) => /Missing environment/.test(x.message)));
    expect(diagnostics.map((d) => d.message)).toContain('Missing environment variables: CDK_API_KEY');
  }, 30_000);

  it('switches to dev for this session once the user confirms, and can apply then', async () => {
    const server = await start('prod', { answer: ['Switch to dev', 'Apply'] });
    const uri = 'file:///work/switch.yaml';
    server.open(uri, topics('c-switch'));

    const toDev = (await actions(server, uri, 1)).find((a) => a.title.startsWith('Switch fake to dev mode'))!;
    expect(toDev).toBeDefined();
    await server.command(toDev.command!.command, ...toDev.command!.arguments!);
    expect(server.prompts.map((p) => p.message)).toEqual([expect.stringMatching(/^Switch fake to dev mode/)]);

    const titles = (await actions(server, uri, 1)).map((a) => a.title);
    expect(titles).toContain('Apply Topic orders to fake');
    expect(titles).toContain('Switch fake back to prod mode');
    await server.command('conduktor.apply', uri, 0);
    expect(applied('c-switch')).toHaveLength(1);
  }, 30_000);

  it('stays in prod when the user does not confirm the switch', async () => {
    const server = await start('prod');
    const uri = 'file:///work/no-switch.yaml';
    server.open(uri, topics('c-no-switch'));
    await server.command('conduktor.switchMode', 'dev');
    expect(server.prompts).toHaveLength(1);
    expect((await actions(server, uri, 1)).map((a) => a.title).filter((t) => t.startsWith('Apply'))).toEqual([]);
  }, 30_000);
});
