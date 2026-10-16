import { createHash } from 'node:crypto';
import * as vscode from 'vscode';
import type { SpecCache } from '@conduktor/core';

export class FileSpecCache implements SpecCache {
  constructor(private readonly directory: vscode.Uri) {}

  async read(key: string): Promise<string | undefined> {
    try {
      return new TextDecoder().decode(await vscode.workspace.fs.readFile(this.file(key)));
    } catch {
      return undefined;
    }
  }

  async write(key: string, text: string): Promise<void> {
    await vscode.workspace.fs.createDirectory(this.directory);
    await vscode.workspace.fs.writeFile(this.file(key), new TextEncoder().encode(text));
  }

  private file(key: string): vscode.Uri {
    const name = createHash('sha1').update(key).digest('hex').slice(0, 16);
    return vscode.Uri.joinPath(this.directory, `openapi-${name}.yaml`);
  }
}
