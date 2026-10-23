import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import type { Capability } from '../client/tokenInfo';
import type { ConnectionMode } from '../connectionMode';
import type { KindCatalog } from '../openapi/kindCatalog';
import type { SpecSource } from '../openapi/loadSpec';
import type { UpsertItem } from '../plan/upsertDocuments';
import type { UpsertResult } from '../resources/types';
import { conduktorTools } from '../tools/definitions';

/*
 * Product usage, sent to Segment as cdk.extension.<object>.<Action> events. What an event may carry is fixed by the
 * types below: counts, and names this code or the Console's OpenAPI defines (modes, kinds, tools, editors). Never what
 * someone wrote: no resource names, URLs, file paths, messages or tokens. TELEMETRY.md lists every field; a change
 * here changes it too.
 */

export const EVENT_PREFIX = 'cdk.extension.';
const ENDPOINT = 'https://events.eu1.segmentapis.com/v1/batch';
const FLUSH_MS = 10_000;
const BATCH_SIZE = 20;
const LIVED_MS = 60 * 60 * 1000;
const SEND_TIMEOUT_MS = 5_000;

type Result = 'success' | 'failure';

export interface Outcomes {
  resources: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  /** Waiting for resources earlier in the run, or skipped after a failure. */
  pending: number;
  /** The Console kinds among them, sorted. */
  kinds: string[];
}

export type TelemetryEvent =
  | { name: 'Started'; properties: { connections?: number } }
  | { name: 'Lived'; properties: { automaticChecks: number } }
  | { name: 'console.Connected'; properties: { mode: ConnectionMode; token: Capability; openApi: SpecSource } }
  | { name: 'console.Failed'; properties: { mode: ConnectionMode; reason: 'no-token' | 'refused' } }
  | { name: 'connection.Added'; properties: { mode: ConnectionMode; token: Capability } }
  | { name: 'connection.Removed'; properties: Record<string, never> }
  | { name: 'connection.Switched'; properties: Record<string, never> }
  | { name: 'mode.Changed'; properties: { mode: ConnectionMode } }
  | { name: 'resources.Checked'; properties: Outcomes }
  | { name: 'resources.Applied'; properties: Outcomes & { from: 'file' | 'live' | 'changes' } }
  | { name: 'folder.Validated'; properties: Outcomes }
  | { name: 'resource.Diffed'; properties: { kind: string } }
  | { name: 'resource.Drafted'; properties: { kind: string } }
  | { name: 'resource.Deleted'; properties: { kind: string } }
  | { name: 'resource.Renamed'; properties: { kind: string; files: number } }
  | { name: 'sync.Completed'; properties: { scope: 'resource' | 'kind' | 'everything'; resources: number } }
  | { name: 'environment.Planned'; properties: { result: Result } }
  | { name: 'environment.Applied'; properties: { result: Result } }
  | { name: 'agent.Configured'; properties: { agent: 'claude-code' } }
  | { name: 'tool.Called'; properties: { tool: string; result: Result } };

export type Client = 'vscode' | 'zed' | 'claude-code' | 'claude-desktop' | 'cursor' | 'codex' | 'other';

/** What every event says about where it comes from. */
export interface TelemetryContext {
  /** The editor integration, or the MCP server an agent runs. */
  surface: 'editor' | 'mcp';
  client: Client;
  clientVersion?: string;
  extensionVersion: string;
}

/** Where events go: Segment, or VS Code's telemetry logger in front of it. */
export interface TelemetrySink {
  send(event: string, properties: Record<string, unknown>): void;
  flush(): Promise<void>;
}

/** The editor or agent, from the name it gives itself in LSP or MCP's initialize. */
export function clientOf(name: string | undefined): Client {
  if (!name) return 'other';
  if (/^zed\b/i.test(name)) return 'zed';
  if (/^(?:visual studio code|code - oss|vscode)/i.test(name)) return 'vscode';
  if (/claude[- ]code/i.test(name)) return 'claude-code';
  if (/^claude-ai$/i.test(name)) return 'claude-desktop';
  if (/cursor/i.test(name)) return 'cursor';
  if (/codex/i.test(name)) return 'codex';
  return 'other';
}

/** A version as editors write theirs, or nothing: the field never carries free text. */
export function versionOf(text: string | undefined): string | undefined {
  return text && /^\d+(?:\.\d+){0,3}(?:[-+][\d.+a-z-]{1,24})?$/i.test(text) ? text : undefined;
}

/** A dry run's or an apply's results, as counts, and the kinds the catalog knows them by. */
export function outcomes(items: readonly UpsertItem[], catalog: KindCatalog): Outcomes {
  const count = (test: (item: UpsertItem) => boolean) => items.filter(test).length;
  const result = (name: UpsertResult) => (item: UpsertItem) =>
    item.outcome.status === 'ok' && item.outcome.result === name;
  return {
    resources: items.length,
    created: count(result('Created')),
    updated: count(result('Updated')),
    unchanged: count(result('NotChanged')),
    failed: count((item) => item.outcome.status === 'error'),
    pending: count((item) => item.outcome.status === 'pending' || item.outcome.status === 'skipped'),
    kinds: [...new Set(items.map((item) => kindOf(item.document.kind, catalog)))].sort(),
  };
}

/** A kind the catalog defines, by its own name; anything else is "other". */
export function kindOf(kind: string, catalog: KindCatalog): string {
  return catalog.latest(kind)?.kind ?? 'other';
}

/** A tool this code defines, or "other". */
export function toolOf(name: string): string {
  return conduktorTools.some((tool) => tool.name === name) ? name : 'other';
}

/**
 * Whether the environment lets anything be sent: CDK_ENABLE_PRODUCT_METRICS=false turns it off, as for Console, and so
 * does DO_NOT_TRACK=1.
 */
export function telemetryAllowed(env: Readonly<Record<string, string | undefined>>): boolean {
  const no = (value: string) => /^(?:false|0|no|off)$/i.test(value.trim());
  const metrics = env.CDK_ENABLE_PRODUCT_METRICS;
  const doNotTrack = env.DO_NOT_TRACK;
  return (
    !(metrics !== undefined && no(metrics)) &&
    !(doNotTrack !== undefined && doNotTrack.trim() !== '' && !no(doNotTrack))
  );
}

/**
 * A random id for this machine's user, kept in <configHome>/conduktor/telemetry.json so the editor, the language
 * server and the MCP server share it. When the file cannot be read or written, one for this process only.
 */
export function anonymousId(configHome: string): string {
  const file = join(configHome, 'conduktor', 'telemetry.json');
  try {
    const stored: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const id = (stored as { anonymousId?: unknown } | null)?.anonymousId;
    if (typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) return id;
  } catch {
    // Not there yet, or not readable: a new one.
  }
  const id = randomUUID();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify({ anonymousId: id })}\n`);
  } catch {
    // Read-only home: this process keeps its id.
  }
  return id;
}

export interface SegmentOptions {
  writeKey: string;
  anonymousId: string;
  /** Segment's EU endpoint, unless a proxy or a test names another. */
  endpoint?: string | undefined;
  fetch?: typeof fetch;
}

/**
 * Batches events to Segment's HTTP API. Sending never throws and never retries: an event that fails is dropped. The
 * timers do not keep a process alive; flush() before it exits sends what is left.
 */
export function segmentSink(options: SegmentOptions): TelemetrySink {
  const post = options.fetch ?? fetch;
  const authorization = `Basic ${Buffer.from(`${options.writeKey}:`).toString('base64')}`;
  let queue: Record<string, unknown>[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const sending = new Set<Promise<void>>();

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (queue.length > 0) {
      const batch = queue;
      queue = [];
      const sent = post(options.endpoint ?? ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: authorization },
        body: JSON.stringify({ batch, sentAt: new Date().toISOString() }),
        signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      }).then(
        () => undefined,
        () => undefined,
      );
      sending.add(sent);
      void sent.finally(() => sending.delete(sent));
    }
    return Promise.all(sending).then(() => undefined);
  };

  return {
    send(event, properties) {
      queue.push({
        type: 'track',
        event,
        anonymousId: options.anonymousId,
        messageId: randomUUID(),
        timestamp: new Date().toISOString(),
        // 0.0.0.0 keeps Segment from recording the sender's IP address.
        context: { ip: '0.0.0.0', library: { name: 'conduktor-language-tools' } },
        properties,
      });
      if (queue.length >= BATCH_SIZE) void flush();
      else timer ??= setTimeout(() => void flush(), FLUSH_MS).unref();
    },
    flush,
  };
}

/**
 * Segment for this process, or nothing: without a write key (any build but a release's) or when the environment opts
 * out.
 */
export function openSegment(
  writeKey: string,
  env: Readonly<Record<string, string | undefined>>,
  home: string,
): TelemetrySink | undefined {
  if (writeKey === '' || !telemetryAllowed(env)) return undefined;
  const configured = env.XDG_CONFIG_HOME?.trim() ?? '';
  const configHome = configured === '' ? join(home, '.config') : configured;
  return segmentSink({ writeKey, anonymousId: anonymousId(configHome), endpoint: env.CONDUKTOR_TELEMETRY_URL });
}

/**
 * Typed events for one process, with what every event says about it. Without a sink it records nothing. Once an hour
 * with anything to report, a Lived event carries what is too frequent for an event each: the automatic dry runs.
 */
export class Telemetry {
  private readonly sessionId = randomUUID();
  private automaticChecks = 0;
  private active = false;
  private readonly lived: ReturnType<typeof setInterval> | undefined;

  constructor(
    private readonly sink: TelemetrySink | undefined,
    private context: TelemetryContext,
  ) {
    this.lived = sink ? setInterval(() => this.live(), LIVED_MS).unref() : undefined;
  }

  static readonly off = new Telemetry(undefined, { surface: 'editor', client: 'other', extensionVersion: '' });

  /** Once the editor or agent has said who it is. */
  identify(client: Client, clientVersion: string | undefined): void {
    const { clientVersion: _previous, ...rest } = this.context;
    const version = versionOf(clientVersion);
    this.context = { ...rest, client, ...(version && { clientVersion: version }) };
  }

  track(event: TelemetryEvent): void {
    if (!this.sink) return;
    this.active = true;
    this.sink.send(`${EVENT_PREFIX}${event.name}`, {
      ...this.context,
      os: platform(),
      arch: arch(),
      sessionId: this.sessionId,
      ...event.properties,
    });
  }

  /** A dry run made on open or save, rather than asked for. */
  countAutomaticCheck(): void {
    this.automaticChecks++;
  }

  async dispose(): Promise<void> {
    if (this.lived) clearInterval(this.lived);
    this.live();
    await this.sink?.flush();
  }

  private live(): void {
    if (!this.active && this.automaticChecks === 0) return;
    this.track({ name: 'Lived', properties: { automaticChecks: this.automaticChecks } });
    this.automaticChecks = 0;
    this.active = false;
  }
}
