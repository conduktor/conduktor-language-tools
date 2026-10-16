import * as fs from 'node:fs/promises';
import { dirname } from 'node:path';
import * as vscode from 'vscode';
import { eachLimit } from '@conduktor/core';

// The sync folder is on the disk the extension host runs on; going through workspace.fs costs a round trip per call,
// which a bootstrap of thousands of files makes minutes long.
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    if (uri.scheme === 'file') await fs.stat(uri.fsPath);
    else await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function read(uri: vscode.Uri): Promise<string | undefined> {
  try {
    if (uri.scheme === 'file') return await fs.readFile(uri.fsPath, 'utf8');
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

export async function write(uri: vscode.Uri, text: string): Promise<void> {
  if (uri.scheme === 'file') {
    await fs.mkdir(dirname(uri.fsPath), { recursive: true });
    await fs.writeFile(uri.fsPath, text);
    return;
  }
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}

export async function remove(uri: vscode.Uri): Promise<void> {
  if (uri.scheme === 'file') return fs.rm(uri.fsPath, { force: true });
  await Promise.resolve(vscode.workspace.fs.delete(uri)).catch(() => undefined);
}

/** Each file's text in order, `undefined` where there is no file or it cannot be read, a few reads at a time. */
export async function readAll(uris: readonly (vscode.Uri | undefined)[], limit = 32): Promise<(string | undefined)[]> {
  const texts: (string | undefined)[] = new Array(uris.length).fill(undefined);
  await eachLimit([...uris.keys()], limit, async (i) => {
    const uri = uris[i];
    if (uri) texts[i] = await read(uri);
  });
  return texts;
}
