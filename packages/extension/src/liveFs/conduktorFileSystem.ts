import * as vscode from 'vscode';
import { stringify } from 'yaml';
import { ConsoleError, describeError, itemPath, parentsOf } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import { parseLiveUriParts } from './uris';

export class ConduktorFileSystem implements vscode.FileSystemProvider {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changed.event;

  constructor(private readonly sessions: SessionManager) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(): vscode.FileStat {
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: 0, permissions: vscode.FilePermission.Readonly };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const ref = parseLiveUriParts(uri.authority, uri.path);
    if (!ref) throw vscode.FileSystemError.FileNotFound(uri);
    const state = this.sessions.current();
    if (state.status !== 'ready' || state.connection.id !== ref.connectionId) {
      throw vscode.FileSystemError.Unavailable('Switch to this connection to open its resources.');
    }
    const kind = state.spec.catalog.resolve(`v${ref.version}`, ref.kind);
    if (!kind) throw vscode.FileSystemError.FileNotFound(uri);
    try {
      const resource = await state.client.get(itemPath(kind, parentsOf(kind, ref.parents), ref.name));
      return new TextEncoder().encode(stringify(resource));
    } catch (error) {
      if (error instanceof ConsoleError && error.status === 404) throw vscode.FileSystemError.FileNotFound(uri);
      if (error instanceof ConsoleError && error.status === 403) throw vscode.FileSystemError.NoPermissions(uri);
      throw vscode.FileSystemError.Unavailable(describeError(error));
    }
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  writeFile(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}
