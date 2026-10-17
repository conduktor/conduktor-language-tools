import * as vscode from 'vscode';
import {
  buildSpec,
  capabilityOf,
  ConsoleClient,
  describeError,
  loadSpec,
  type Capability,
  type LoadedSpec,
  type TokenInfo,
} from '@conduktor/core';
import type { Output } from '../output';
import type { Connection, ConnectionStore } from './connectionStore';
import { FileSpecCache } from './specCache';

export type SessionState =
  | { status: 'none' }
  | { status: 'loading'; connection: Connection }
  | {
      status: 'ready';
      connection: Connection;
      client: ConsoleClient;
      spec: LoadedSpec;
      token: TokenInfo;
      capability: Capability;
    }
  | { status: 'error'; connection: Connection; message: string; spec?: LoadedSpec };

export class SessionManager implements vscode.Disposable {
  private state: SessionState = { status: 'none' };
  private generation = 0;
  private snapshot: Promise<LoadedSpec> | undefined;
  private snapshotValue: LoadedSpec | undefined;
  private readonly cache: FileSpecCache;
  private readonly changed = new vscode.EventEmitter<SessionState>();
  readonly onDidChange = this.changed.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly store: ConnectionStore,
    private readonly output: Output,
  ) {
    this.cache = new FileSpecCache(context.globalStorageUri);
  }

  get userAgent(): string {
    return `VSCode/${(this.context.extension.packageJSON as { version: string }).version}`;
  }

  current(): SessionState {
    return this.state;
  }

  loadedSpec(): LoadedSpec | undefined {
    const state = this.state;
    return ('spec' in state ? state.spec : undefined) ?? this.snapshotValue;
  }

  snapshotSpec(): Promise<LoadedSpec> {
    this.snapshot ??= this.readSnapshot().then((text) => (this.snapshotValue = buildSpec(text, 'snapshot')));
    return this.snapshot;
  }

  async reload(): Promise<void> {
    const generation = ++this.generation;
    const connection = this.store.active();
    await vscode.commands.executeCommand('setContext', 'conduktor.hasConnection', connection !== undefined);
    if (!connection) {
      this.update(generation, { status: 'none' });
      return;
    }

    this.update(generation, { status: 'loading', connection });
    const token = await this.store.token(connection.id);
    const client = new ConsoleClient({
      baseUrl: connection.url,
      token,
      userAgent: this.userAgent,
      onRequest: (event) => this.output.request(event),
    });
    let spec: LoadedSpec | undefined;
    try {
      spec = await loadSpec({
        cacheKey: client.baseUrl,
        fetchText: () => client.fetchOpenApiText(),
        cache: this.cache,
        snapshotText: () => this.readSnapshot(),
      });
      if (spec.liveError) this.output.warn(`${connection.name}: using the ${spec.source} OpenAPI (${spec.liveError})`);
      if (!token) throw new Error('No token is stored for this connection. Remove it and add it again.');
      const info = await client.whoami();
      this.update(generation, {
        status: 'ready',
        connection,
        client,
        spec,
        token: info,
        capability: capabilityOf(info),
      });
    } catch (error) {
      this.output.error(`${connection.name}: ${describeError(error)}`);
      this.update(generation, { status: 'error', connection, message: describeError(error), ...(spec && { spec }) });
    }
  }

  dispose(): void {
    this.changed.dispose();
  }

  private update(generation: number, state: SessionState): void {
    if (generation !== this.generation) return;
    this.state = state;
    this.changed.fire(state);
  }

  private async readSnapshot(): Promise<string> {
    const uri = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'public-api-doc.yaml');
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  }
}
