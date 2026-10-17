import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createMessageConnection,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import { expect } from 'vitest';
import type {
  ApplyWorkspaceEditParams,
  Command,
  ConfigurationParams,
  Diagnostic,
  ExecuteCommandParams,
  ShowDocumentParams,
  PublishDiagnosticsParams,
  ShowMessageParams,
  ShowMessageRequestParams,
} from 'vscode-languageserver';
import { snapshotPath } from './fixtures';

interface ConsoleRequest {
  method: string;
  url: string;
  /** The request's Authorization header, `undefined` when it had none. */
  authorization: string | undefined;
  body: string;
}

export interface FakeConsole {
  url: string;
  requests: ConsoleRequest[];
  close(): void;
}

/**
 * A Console that serves the bundled OpenAPI, accepts the token `secret` as an admin key, holds the clusters
 * `local-kafka` (with the topics `orders` and `payments`, labelled) and `prod-kafka`, and dry-runs or applies topics: more than 12 partitions breaks a policy, `orders`
 * exists already, anything else would be created.
 */
export async function fakeConsole(
  options: {
    delayMs?: number;
    /** Leaves every PUT unanswered: dry runs never finish, so nothing they publish gets in a test's way. */
    silentWrites?: boolean;
  } = {},
): Promise<FakeConsole> {
  const requests: ConsoleRequest[] = [];
  const server: Server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk: Buffer) => (body += chunk.toString()));
    request.on('end', () => {
      if (options.silentWrites && request.method === 'PUT') {
        requests.push({
          method: request.method,
          url: request.url!,
          authorization: request.headers.authorization,
          body,
        });
        return;
      }
      setTimeout(answer, options.delayMs ?? 0);
    });
    const answer = () => {
      requests.push({ method: request.method!, url: request.url!, authorization: request.headers.authorization, body });
      const json = (status: number, value: unknown) =>
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(value));
      if (request.url === '/api/public/docs/docs.yaml') {
        response.writeHead(200, { 'Content-Type': 'application/yaml' }).end(readFileSync(snapshotPath, 'utf8'));
      } else if (request.url === '/api/token/v1/whoami') {
        if (request.headers.authorization === 'Bearer secret') json(200, { type: 'AdminToken', name: 'ci' });
        else json(401, { title: 'Unauthorized' });
      } else if (request.method === 'GET' && request.url === '/api/public/console/v2/kafka-cluster') {
        const cluster = (name: string) => ({ apiVersion: 'v2', kind: 'KafkaCluster', metadata: { name }, spec: {} });
        json(200, [cluster('local-kafka'), cluster('prod-kafka')]);
      } else if (request.method === 'GET' && request.url === '/api/public/kafka/v2/cluster/local-kafka/topic') {
        const topic = (name: string, labels: Record<string, string>) => ({
          apiVersion: 'v2',
          kind: 'Topic',
          metadata: { name, cluster: 'local-kafka', labels },
        });
        json(200, [
          topic('orders', { team: 'data', domain: 'sales', 'conduktor.io/application': 'shop' }),
          topic('payments', { team: 'payments' }),
        ]);
      } else if (request.method === 'PUT' && /^\/api\/public\/kafka\/v2\/cluster\/[^/]+\/topic/.test(request.url!)) {
        const topic = JSON.parse(body) as { metadata: { name: string }; spec?: { partitions?: number } };
        if ((topic.spec?.partitions ?? 0) > 12)
          json(400, { title: 'Invalid resource', msg: 'TopicPolicy limits: - spec.partitions must be <= 12' });
        else json(200, { resource: topic, upsertResult: topic.metadata.name === 'orders' ? 'Updated' : 'Created' });
      } else {
        json(404, { title: 'Not found' });
      }
    };
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    requests,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
}

// Vitest types its asymmetric matchers `any`; a field of an expected object takes them as the opaque values they are.
export const matching = (pattern: RegExp): unknown => expect.stringMatching(pattern);
export const anything = (): unknown => expect.anything();

/** Polls until the check holds: for what the server does on its own, with nothing to wait on. */
export async function until(check: () => boolean | Promise<boolean>, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`Still not true after ${timeoutMs} ms: ${check.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Bundles the server as it ships, into a fresh folder. */
export function buildServer(): string {
  const directory = mkdtempSync(join(tmpdir(), 'conduktor-ls-'));
  execFileSync(process.execPath, ['esbuild.mjs', '--outdir', join(directory, 'dist')], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    stdio: 'pipe',
  });
  return directory;
}

export interface StartOptions {
  /** The server's settings, as Zed would send them: what `lsp.conduktor-console.settings` holds. */
  settings?: unknown;
  /** Whether ~/.config/zed/settings.json exists, for the server to offer to open it. */
  zedSettings?: boolean;
  /** Workspace folders, by path. */
  folders?: string[];
  /** What to answer when the server asks: the titles of the actions to pick, or none. */
  answer?: string | string[];
  /** The server's environment, besides PATH and HOME; by default, CONDUKTOR_TOKEN=secret. */
  env?: Record<string, string>;
}

export interface Started {
  connection: MessageConnection;
  /** The first diagnostics published for a URI that satisfy the predicate. */
  diagnostics(uri: string, predicate: (d: Diagnostic[]) => boolean): Promise<Diagnostic[]>;
  /** The first message shown that satisfies the predicate. */
  message(predicate: (m: ShowMessageParams) => boolean): Promise<ShowMessageParams>;
  messages: ShowMessageParams[];
  prompts: ShowMessageRequestParams[];
  /** The documents the server asked to show. */
  shown: ShowDocumentParams[];
  /** The edits the server asked to apply. */
  edits: ApplyWorkspaceEditParams[];
  open(uri: string, text: string): void;
  /** Changes the settings, as Zed does when the user edits them. */
  configure(settings: unknown): void;
  command(command: string, ...args: unknown[]): Promise<unknown>;
  /** Runs a code action's command, as the editor does once the user picks it. */
  run(command: Command): Promise<unknown>;
  stop(): void;
}

export async function startServer(directory: string, options: StartOptions = {}): Promise<Started> {
  const home = mkdtempSync(join(directory, 'home-'));
  if (options.zedSettings) {
    mkdirSync(join(home, '.config', 'zed'), { recursive: true });
    writeFileSync(join(home, '.config', 'zed', 'settings.json'), '{}');
  }
  let settings = options.settings;
  const child: ChildProcess = spawn(process.execPath, [join(directory, 'dist', 'server.cjs'), '--stdio'], {
    env: { PATH: process.env.PATH, HOME: home, ...(options.env ?? { CONDUKTOR_TOKEN: 'secret' }) },
    stdio: 'pipe',
  });
  const connection = createMessageConnection(
    new StreamMessageReader(child.stdout!),
    new StreamMessageWriter(child.stdin!),
  );
  // A server that dies fails the test with what it said, rather than leaving it to time out.
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const exited = new Promise<never>((_, reject) =>
    child.once('exit', (code) => reject(new Error(`The server exited with ${code}:\n${stderr}`))),
  );
  exited.catch(() => undefined);

  const waiters: { test: (value: unknown) => boolean; resolve: (value: unknown) => void }[] = [];
  const settle = (value: unknown) => {
    for (const waiter of waiters.filter((w) => w.test(value))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(value);
    }
  };
  const waitFor = <T>(test: (value: unknown) => boolean, seen: readonly unknown[] = []): Promise<T> => {
    const already = seen.find(test);
    if (already !== undefined) return Promise.resolve(already as T);
    return Promise.race([new Promise<T>((resolve) => waiters.push({ test, resolve: resolve as never })), exited]);
  };

  const messages: ShowMessageParams[] = [];
  const prompts: ShowMessageRequestParams[] = [];
  connection.onNotification('window/showMessage', (params: ShowMessageParams) => {
    messages.push(params);
    settle(params);
  });
  connection.onNotification('textDocument/publishDiagnostics', (params: PublishDiagnosticsParams) => settle(params));
  connection.onRequest('window/showMessageRequest', (params: ShowMessageRequestParams) => {
    prompts.push(params);
    const answers = [options.answer ?? []].flat();
    return params.actions?.find((action) => answers.includes(action.title)) ?? null;
  });
  connection.onRequest('window/workDoneProgress/create', () => null);
  const edits: ApplyWorkspaceEditParams[] = [];
  connection.onRequest('workspace/applyEdit', (params: ApplyWorkspaceEditParams) => {
    edits.push(params);
    return { applied: true };
  });
  const shown: ShowDocumentParams[] = [];
  connection.onRequest('window/showDocument', (params: ShowDocumentParams) => {
    shown.push(params);
    return { success: true };
  });
  // Zed answers a section of what the extension returns, `{ conduktor: <settings> }`, and null for anything else.
  connection.onRequest('workspace/configuration', (params: ConfigurationParams) =>
    params.items.map((item) => (item.section === 'conduktor' ? (settings ?? null) : null)),
  );
  const execute = (params: ExecuteCommandParams) =>
    Promise.race([connection.sendRequest('workspace/executeCommand', params), exited]);
  const push = () =>
    void connection.sendNotification('workspace/didChangeConfiguration', { settings: { conduktor: settings ?? null } });
  connection.listen();

  const folders = options.folders ?? [];
  await Promise.race([
    connection.sendRequest('initialize', {
      processId: process.pid,
      rootUri: null,
      workspaceFolders: folders.map((folder) => ({ uri: pathToFileURL(folder).href, name: folder })),
      clientInfo: { name: 'Zed', version: '1.24.2' },
      capabilities: { window: { workDoneProgress: true }, workspace: { configuration: true } },
    }),
    exited,
  ]);
  await connection.sendNotification('initialized', {});
  push();

  return {
    connection,
    messages,
    prompts,
    shown,
    edits,
    configure: (next) => {
      settings = next;
      push();
    },
    diagnostics: (uri, predicate) =>
      waitFor<PublishDiagnosticsParams>((value) => {
        const params = value as PublishDiagnosticsParams;
        return params.uri === uri && Array.isArray(params.diagnostics) && predicate(params.diagnostics);
      }).then((params) => params.diagnostics),
    message: (predicate) =>
      waitFor<ShowMessageParams>(
        (value) => typeof (value as ShowMessageParams).type === 'number' && predicate(value as ShowMessageParams),
        messages,
      ),
    open: (uri, text) =>
      void connection.sendNotification('textDocument/didOpen', {
        textDocument: { uri, languageId: 'yaml', version: 1, text },
      }),
    command: (command, ...args) => execute({ command, arguments: args }),
    run: ({ command, arguments: args = [] }) => execute({ command, arguments: args }),
    stop: () => {
      connection.dispose();
      child.kill();
    },
  };
}
