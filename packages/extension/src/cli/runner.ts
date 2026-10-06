import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { cliCommand, environmentDir, STATE_DIR, type CliRunnerChoice } from '@conduktor/vscode-core';
import type { ConnectionStore } from '../connections/connectionStore';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';

export const DEFAULT_IMAGE = 'conduktor/conduktor-ctl:v0.9.2';

export interface CliRun {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  cancelled: boolean;
}

/** Runs ctl over the bound environment of the sync folder, in Docker or from PATH, into the Conduktor CLI panel. */
export class CliRunner implements vscode.Disposable {
  readonly channel = vscode.window.createOutputChannel('Conduktor CLI');
  private docker: boolean | undefined;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly connections: ConnectionStore,
    private readonly sync: SyncFolder,
  ) {
    this.listeners = [
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('conduktor.cli')) this.docker = undefined;
      }),
    ];
  }

  async run(action: 'plan' | 'apply'): Promise<CliRun | undefined> {
    const state = this.sessions.current();
    const env = this.sync.environment();
    const syncRoot = this.sync.syncRoot();
    if (state.status !== 'ready' || !env || !syncRoot || syncRoot.scheme !== 'file')
      throw new Error('Connect to a Console and choose a local sync folder first.');
    const token = await this.connections.token(state.connection.id);
    if (!token) throw new Error(`No token is stored for ${state.connection.name}.`);
    const root = syncRoot.fsPath;
    const envFile = join(root, environmentDir(env), '.env');
    const runner = this.runner();
    const command = cliCommand({
      action,
      env,
      syncRoot: root,
      consoleUrl: state.client.baseUrl,
      runner,
      ...(runner.kind === 'docker' && existsSync(envFile) && { envFile }),
    });
    mkdirSync(join(root, STATE_DIR, 'state'), { recursive: true });
    const variables = runner.kind === 'path' && existsSync(envFile) ? dotenv(readFileSync(envFile, 'utf8')) : {};
    this.channel.show(true);
    this.channel.appendLine(`$ ${command.command} ${command.args.join(' ')}`);
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${action === 'plan' ? 'Planning' : 'Applying'} ${env} with ctl`,
        cancellable: true,
      },
      (_progress, cancellation) =>
        new Promise<CliRun>((resolve, reject) => {
          // The token goes in the child's environment only, never into its arguments or the panel.
          const child = spawn(command.command, command.args, {
            cwd: command.cwd,
            env: { ...process.env, ...variables, ...command.env, CDK_API_KEY: token },
          });
          let stdout = '';
          let stderr = '';
          let cancelled = false;
          cancellation.onCancellationRequested(() => {
            cancelled = true;
            child.kill();
          });
          child.stdout.on('data', (chunk: Buffer) => {
            stdout += chunk.toString();
            this.channel.append(chunk.toString());
          });
          child.stderr.on('data', (chunk: Buffer) => {
            stderr += chunk.toString();
            this.channel.append(chunk.toString());
          });
          child.on('error', (error: NodeJS.ErrnoException) =>
            reject(
              error.code === 'ENOENT'
                ? new Error(
                    runner.kind === 'docker'
                      ? 'Docker is not installed or not on PATH; install it, or set conduktor.cli.runner to "path".'
                      : `${command.command} was not found; install the Conduktor CLI or set conduktor.cli.path.`,
                  )
                : error,
            ),
          );
          child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr, cancelled }));
        }),
    );
  }

  private runner(): CliRunnerChoice {
    const settings = vscode.workspace.getConfiguration('conduktor.cli');
    const choice = settings.get<'auto' | 'docker' | 'path'>('runner', 'auto');
    const binary = settings.get<string>('path', 'conduktor');
    if (choice === 'path' || (choice === 'auto' && !this.hasDocker())) return { kind: 'path', binary };
    return {
      kind: 'docker',
      image: settings.get<string>('image', DEFAULT_IMAGE),
      platform: process.platform,
      ...(process.getuid && { uid: process.getuid(), gid: process.getgid?.() }),
    };
  }

  // Asked once until the settings change: whether a Docker daemon answers.
  private hasDocker(): boolean {
    this.docker ??= spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { timeout: 5000 }).status === 0;
    return this.docker;
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.channel.dispose();
  }
}

// KEY=value lines, as docker --env-file reads them: no expansion, comments and blank lines skipped.
function dotenv(text: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match && !line.trimStart().startsWith('#')) variables[match[1]!] = match[2]!;
  }
  return variables;
}
