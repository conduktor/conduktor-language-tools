import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { UpsertItem } from '../src/plan/upsertDocuments';
import {
  anonymousId,
  clientOf,
  openSegment,
  outcomes,
  segmentSink,
  Telemetry,
  telemetryAllowed,
  toolOf,
  versionOf,
  type TelemetrySink,
} from '../src/telemetry/telemetry';
import { snapshotCatalog } from './fixtures';

const recording = () => {
  const sent: { event: string; properties: Record<string, unknown> }[] = [];
  const sink: TelemetrySink = {
    send: (event, properties) => sent.push({ event, properties }),
    flush: () => Promise.resolve(),
  };
  return { sent, sink };
};

const context = { surface: 'editor', client: 'vscode', extensionVersion: '1.2.3' } as const;

describe('consent', () => {
  it.each([
    [{}, true],
    [{ CDK_ENABLE_PRODUCT_METRICS: 'true' }, true],
    [{ CDK_ENABLE_PRODUCT_METRICS: 'false' }, false],
    [{ CDK_ENABLE_PRODUCT_METRICS: 'FALSE' }, false],
    [{ CDK_ENABLE_PRODUCT_METRICS: '0' }, false],
    [{ DO_NOT_TRACK: '1' }, false],
    [{ DO_NOT_TRACK: 'true' }, false],
    [{ DO_NOT_TRACK: '0' }, true],
    [{ DO_NOT_TRACK: '' }, true],
  ])('reads %j as %s', (env, allowed) => {
    expect(telemetryAllowed(env)).toBe(allowed);
  });

  it('sends nothing without a write key, or when the environment opts out', () => {
    const home = mkdtempSync(join(tmpdir(), 'telemetry-'));
    expect(openSegment('', {}, home)).toBeUndefined();
    expect(openSegment('key', { DO_NOT_TRACK: '1' }, home)).toBeUndefined();
    expect(openSegment('key', { XDG_CONFIG_HOME: home }, '/nowhere')).toBeDefined();
    expect(readFileSync(join(home, 'conduktor', 'telemetry.json'), 'utf8')).toMatch(/anonymousId/);
  });
});

describe('what an event may say', () => {
  it.each([
    ['Zed', 'zed'],
    ['Zed Preview', 'zed'],
    ['Visual Studio Code', 'vscode'],
    ['claude-code', 'claude-code'],
    ['claude-ai', 'claude-desktop'],
    ['cursor-vscode', 'cursor'],
    ['codex-mcp-client', 'codex'],
    ['my-own-agent', 'other'],
    [undefined, 'other'],
  ])('names the client %s %s', (name, client) => {
    expect(clientOf(name)).toBe(client);
  });

  it('keeps a version, and drops anything else', () => {
    expect(versionOf('1.101.2')).toBe('1.101.2');
    expect(versionOf('0.214.0-pre+abc123')).toBe('0.214.0-pre+abc123');
    expect(versionOf('acme internal build')).toBeUndefined();
    expect(versionOf('https://example.com')).toBeUndefined();
  });

  it('counts results, and names kinds only as the catalog does', () => {
    const item = (kind: string, outcome: UpsertItem['outcome']): UpsertItem => ({
      document: { index: 0, start: 0, end: 0, kind, apiVersion: 'v2' },
      outcome,
    });
    const items = [
      item('Topic', { status: 'ok', result: 'Created' }),
      item('Topic', { status: 'ok', result: 'NotChanged' }),
      item('Subject', { status: 'ok', result: 'Updated' }),
      item('AcmeSecretThing', { status: 'error', message: 'Not Found' }),
      item('Topic', { status: 'pending', message: 'waiting', waitingFor: ['x'] }),
      item('Topic', { status: 'skipped' }),
    ];
    expect(outcomes(items, snapshotCatalog)).toEqual({
      resources: 6,
      created: 1,
      updated: 1,
      unchanged: 1,
      failed: 1,
      pending: 2,
      kinds: ['Subject', 'Topic', 'other'],
    });
  });

  it('names a tool only if it is one of ours', () => {
    expect(toolOf('conduktor_dry_run')).toBe('conduktor_dry_run');
    expect(toolOf('rm -rf')).toBe('other');
  });
});

describe('anonymous id', () => {
  it('is created once and shared through the config folder', () => {
    const home = mkdtempSync(join(tmpdir(), 'telemetry-'));
    const id = anonymousId(home);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(anonymousId(home)).toBe(id);
    expect(JSON.parse(readFileSync(join(home, 'conduktor', 'telemetry.json'), 'utf8'))).toEqual({ anonymousId: id });
  });

  it('lasts the process when it cannot be stored', () => {
    const notAFolder = join(mkdtempSync(join(tmpdir(), 'telemetry-')), 'file');
    writeFileSync(notAFolder, '');
    expect(anonymousId(notAFolder)).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('Segment', () => {
  it('posts a batch of track events to the EU endpoint, without the IP address', async () => {
    const fetch = vi.fn((_url: string, _init: RequestInit) => Promise.resolve(new Response('{}')));
    const sink = segmentSink({
      writeKey: 'key',
      anonymousId: 'someone',
      fetch: fetch as unknown as typeof globalThis.fetch,
    });
    sink.send('cdk.extension.Started', { surface: 'editor' });
    sink.send('cdk.extension.mode.Changed', { mode: 'dev' });
    expect(fetch).not.toHaveBeenCalled();
    await sink.flush();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://events.eu1.segmentapis.com/v1/batch');
    expect(init.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('key:').toString('base64')}` });
    const body = JSON.parse(init.body as string) as { batch: Record<string, unknown>[] };
    expect(body.batch.map((m) => m.event)).toEqual(['cdk.extension.Started', 'cdk.extension.mode.Changed']);
    expect(body.batch[1]).toMatchObject({
      type: 'track',
      anonymousId: 'someone',
      context: { ip: '0.0.0.0' },
      properties: { mode: 'dev' },
    });
  });

  it('sends a full batch at once, and drops what fails to send', async () => {
    const fetch = vi.fn(() => Promise.reject(new Error('offline')));
    const sink = segmentSink({
      writeKey: 'key',
      anonymousId: 'someone',
      fetch: fetch,
    });
    for (let i = 0; i < 20; i++) sink.send('cdk.extension.resource.Diffed', { kind: 'Topic' });
    expect(fetch).toHaveBeenCalledOnce();
    await expect(sink.flush()).resolves.toBeUndefined();
    await sink.flush();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe('Telemetry', () => {
  it('adds where an event comes from to each one', () => {
    const { sent, sink } = recording();
    const telemetry = new Telemetry(sink, context);
    telemetry.track({ name: 'mode.Changed', properties: { mode: 'dev' } });
    expect(sent).toEqual([
      {
        event: 'cdk.extension.mode.Changed',
        properties: {
          surface: 'editor',
          client: 'vscode',
          extensionVersion: '1.2.3',
          os: process.platform,
          arch: process.arch,
          sessionId: expect.stringMatching(/^[0-9a-f-]{36}$/) as unknown,
          mode: 'dev',
        },
      },
    ]);
  });

  it('learns who the client is once it says so', () => {
    const { sent, sink } = recording();
    const telemetry = new Telemetry(sink, { ...context, surface: 'mcp', client: 'other' });
    telemetry.identify('claude-code', '2.1.0');
    telemetry.track({ name: 'tool.Called', properties: { tool: 'conduktor_validate', result: 'success' } });
    telemetry.identify('zed', 'nightly from my fork');
    telemetry.track({ name: 'Started', properties: {} });
    expect(sent.map((s) => [s.properties.client, s.properties.clientVersion])).toEqual([
      ['claude-code', '2.1.0'],
      ['zed', undefined],
    ]);
  });

  it('reports automatic dry runs in Lived, only after some activity', async () => {
    const { sent, sink } = recording();
    await new Telemetry(sink, context).dispose();
    expect(sent).toEqual([]);

    const telemetry = new Telemetry(sink, context);
    telemetry.countAutomaticCheck();
    telemetry.countAutomaticCheck();
    await telemetry.dispose();
    expect(sent.map((s) => [s.event, s.properties.automaticChecks])).toEqual([['cdk.extension.Lived', 2]]);
  });

  it('records nothing when off', async () => {
    Telemetry.off.track({ name: 'Started', properties: {} });
    await expect(Telemetry.off.dispose()).resolves.toBeUndefined();
  });
});
