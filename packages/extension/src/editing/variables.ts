import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import * as vscode from 'vscode';
import { envSearchPath, parseDotenv } from '@conduktor/vscode-core';

const read = new Map<string, { mtimeMs: number; values: Record<string, string> }>();

/**
 * The ${VAR} values for a file: VS Code's environment, with the nearest .env's on top — searched up to the file's
 * workspace folder, repository root or home folder. Synchronous, because CodeLenses are.
 */
export function variablesFor(uri: vscode.Uri): Readonly<Record<string, string | undefined>> {
  if (uri.scheme !== 'file') return process.env;
  const stops = {
    workspace: vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath,
    home: homedir(),
    isRepoRoot: (dir: string) => existsSync(join(dir, '.git')),
    caseInsensitive: process.platform === 'win32',
  };
  for (const dir of envSearchPath(uri.fsPath, stops)) {
    const values = dotenvAt(join(dir, '.env'));
    if (values) return { ...process.env, ...values };
  }
  return process.env;
}

function dotenvAt(file: string): Record<string, string> | undefined {
  let mtimeMs: number;
  try {
    ({ mtimeMs } = statSync(file));
  } catch {
    return undefined;
  }
  const cached = read.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.values;
  const values = parseDotenv(readFileSync(file, 'utf8'));
  read.set(file, { mtimeMs, values });
  return values;
}
