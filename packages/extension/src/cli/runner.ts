import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { cliCommand, cliEnvironment, environmentDir, STATE_DIR, type CliRunnerChoice } from '@conduktor/vscode-core';
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
  private docker: Promise<boolean> | undefined;
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
    const dotenvValues = existsSync(envFile) ? dotenv(readFileSync(envFile, 'utf8')) : {};
    this.channel.show(true);
    const runner = await this.runner();
    const command = cliCommand({
      action,
      env,
      syncRoot: root,
      consoleUrl: state.client.baseUrl,
      runner,
      variables: Object.keys(cliEnvironment({}, dotenvValues, {})),
    });
    // The state goes beside the base copies, under the .gitignore that keeps .conduktor out of git.
    await this.sync.ensureStateDir();
    mkdirSync(join(root, STATE_DIR, 'state'), { recursive: true });
    const childEnv = cliEnvironment(process.env, dotenvValues, { ...command.env, CDK_API_KEY: token });
    this.channel.appendLine(`$ ${command.command} ${command.args.join(' ')}`);
    return vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `${action === 'plan' ? 'Planning' : 'Applying'} ${env} with ctl`,
        // Stopping ctl mid-apply skips saving its state, and what it had applied would never be deleted later.
        cancellable: action === 'plan',
      },
      (_progress, cancellation) =>
        new Promise<CliRun>((resolve, reject) => {
          // The token goes in the child's environment only, never into its arguments or the panel.
          const child = spawn(command.command, command.args, { cwd: command.cwd, env: childEnv });
          child.stdout.setEncoding('utf8');
          child.stderr.setEncoding('utf8');
          let stdout = '';
          let stderr = '';
          let cancelled = false;
          cancellation.onCancellationRequested(() => {
            cancelled = true;
            child.kill();
          });
          child.stdout.on('data', (chunk: string) => {
            stdout += chunk;
            this.channel.append(chunk);
          });
          child.stderr.on('data', (chunk: string) => {
            stderr += chunk;
            this.channel.append(chunk);
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

  private async runner(): Promise<CliRunnerChoice> {
    const settings = vscode.workspace.getConfiguration('conduktor.cli');
    const choice = settings.get<'auto' | 'docker' | 'path'>('runner', 'auto');
    const path: CliRunnerChoice = { kind: 'path', binary: settings.get<string>('path', 'conduktor') };
    if (choice === 'path' || (choice === 'auto' && !(await this.hasDocker()))) return path;
    const image = settings.get<string>('image', DEFAULT_IMAGE);
    if (!(await this.hasImage(image))) {
      if (choice === 'auto') {
        this.channel.appendLine(`${image} is not available; running ${path.binary} instead.`);
        return path;
      }
      throw new Error(
        `${image} could not be pulled; check conduktor.cli.image, or set conduktor.cli.runner to "path".`,
      );
    }
    return {
      kind: 'docker',
      image,
      platform: process.platform,
      ...(process.getuid && { uid: process.getuid(), gid: process.getgid?.() }),
    };
  }

  // Asked once until the settings change: whether a Docker daemon answers.
  private hasDocker(): Promise<boolean> {
    this.docker ??= succeeds('docker', ['version', '--format', '{{.Server.Version}}'], 5000);
    return this.docker;
  }

  // The image here already, or pulled now.
  private async hasImage(image: string): Promise<boolean> {
    if (await succeeds('docker', ['image', 'inspect', image], 10_000)) return true;
    this.channel.appendLine(`Pulling ${image}…`);
    return succeeds('docker', ['pull', image], 300_000);
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

function succeeds(command: string, args: string[], timeout: number): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore', timeout });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
