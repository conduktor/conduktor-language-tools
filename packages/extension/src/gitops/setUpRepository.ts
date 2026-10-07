import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import * as vscode from 'vscode';
import {
  describeError,
  ENV_EXAMPLE,
  environmentDir,
  environments,
  exampleVariables,
  fileAction,
  folderNameProblem,
  gitTopLevel,
  REPO_CONFIG,
  repoFiles,
} from '@conduktor/vscode-core';
import type { Output } from '../output';
import type { SyncFolder } from '../sync/syncFolder';

export interface SetUpResult {
  initialised: boolean;
  top: string;
  written: string[];
  rewritten: string[];
  kept: string[];
}

/** Set Up GitOps Repository: git, the ci/ scripts, the workflows and a README around the sync folder. */
export function registerRepositoryCommands(sync: SyncFolder, output: Output): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('conduktor.setUpRepository', async () => {
      try {
        const result = await setUp(sync);
        report(result, output);
        return result;
      } catch (error) {
        void vscode.window.showErrorMessage(describeError(error));
        return undefined;
      }
    }),
  ];
}

async function setUp(sync: SyncFolder): Promise<SetUpResult> {
  const syncRoot = sync.syncRoot();
  if (!syncRoot || syncRoot.scheme !== 'file') throw new Error('Choose a local sync folder first.');
  const root = realpathSync(syncRoot.fsPath);
  const configPath = join(root, REPO_CONFIG);
  const names = Object.keys(environments(existsSync(configPath) ? readFileSync(configPath, 'utf8') : undefined));
  if (names.length === 0) throw new Error(`${REPO_CONFIG} lists no environments; run Sync Everything first.`);
  const problem = names.map(folderNameProblem).find(Boolean);
  if (problem) throw new Error(problem);

  // A sync folder inside a larger repository is part of it: git's own top level, resolved like the root.
  const found = gitTopLevel(await git(['rev-parse', '--show-toplevel'], root));
  if (found.error) throw new Error(found.error);
  const top = found.top ? realpathSync(found.top) : root;
  if (!found.top) {
    await check(git(['init'], root));
    await check(git(['symbolic-ref', 'HEAD', 'refs/heads/main'], root));
  }
  const below = relative(top, root).split(sep).join('/');
  const prefix = below ? `${below}/` : '';

  const files = repoFiles({
    environments: names.map((name) => {
      const example = join(root, environmentDir(name), ENV_EXAMPLE);
      return { name, variables: existsSync(example) ? exampleVariables(readFileSync(example, 'utf8')) : [] };
    }),
    prefix,
  });
  const result: SetUpResult = { initialised: !found.top, top, written: [], rewritten: [], kept: [] };
  for (const file of files) {
    const path = join(top, ...file.path.split('/'));
    const action = fileAction(existsSync(path) ? readFileSync(path, 'utf8') : undefined, file);
    if (action === 'keep') result.kept.push(file.path);
    if (action !== 'write' && action !== 'rewrite') continue;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, file.text);
    if (file.executable) chmodSync(path, 0o755);
    (action === 'write' ? result.written : result.rewritten).push(file.path);
  }
  await sync.ensureIgnored(['.env', 'environments/*/.env']);
  return result;
}

function report(result: SetUpResult, output: Output): void {
  const changed = result.written.length + result.rewritten.length;
  output.info(`Set up ${result.top} for GitOps${result.initialised ? ' (new git repository on main)' : ''}`);
  result.written.forEach((path) => output.info(`  wrote ${path}`));
  result.rewritten.forEach((path) => output.info(`  rewrote ${path}`));
  result.kept.forEach((path) => output.info(`  kept ${path}: it is yours`));
  const kept = result.kept.length > 0 ? `; kept yours: ${result.kept.join(', ')}` : '';
  const message = `Set up ${result.top} for GitOps: ${changed} files written${kept}. Commit them to main.`;
  const show = result.kept.length > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(message, 'Show Output').then((choice) => {
    if (choice) output.show();
  });
}

function git(args: string[], cwd: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', (error: NodeJS.ErrnoException) =>
      reject(error.code === 'ENOENT' ? new Error('git is not installed or not on PATH.') : error),
    );
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

async function check(run: ReturnType<typeof git>): Promise<void> {
  const { code, stderr } = await run;
  if (code !== 0) throw new Error(`git failed: ${stderr.trim()}`);
}
