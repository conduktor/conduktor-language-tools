import * as vscode from 'vscode';
import { stringify } from 'yaml';
import { ConsoleError, describeError, itemPath, parentsOf } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import { parseLiveUriParts, type LiveRef } from './uris';

export class ConduktorFileSystem implements vscode.FileSystemProvider {
  private readonly changed = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  private readonly revisions = new Map<string, number>();
  readonly onDidChangeFile = this.changed.event;

  constructor(
    private readonly sessions: SessionManager,
    private readonly save: (text: string, liveName: string) => Promise<void>,
    private readonly stage: (ref: LiveRef, text: string) => Promise<void>,
    private readonly staging: () => boolean,
    private readonly editable: boolean,
  ) {}

  watch(): vscode.Disposable {
    return new vscode.Disposable(() => undefined);
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const state = this.sessions.current();
    const writable =
      this.editable &&
      state.status === 'ready' &&
      state.connection.mode !== 'read-only' &&
      state.connection.id === uri.authority;
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: this.revisions.get(uri.toString()) ?? 1,
      size: 0,
      permissions: writable ? undefined : vscode.FilePermission.Readonly,
    };
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

  async writeFile(uri: vscode.Uri, content: Uint8Array): Promise<void> {
    const ref = parseLiveUriParts(uri.authority, uri.path);
    if (!ref) throw vscode.FileSystemError.FileNotFound(uri);
    const state = this.sessions.current();
    if (state.status !== 'ready' || state.connection.id !== ref.connectionId) {
      throw vscode.FileSystemError.Unavailable('Switch to this connection to save its resources.');
    }
    if (state.connection.mode === 'read-only') throw vscode.FileSystemError.NoPermissions(uri);
    const text = new TextDecoder().decode(content);
    // Saving applies only in apply mode without a sync folder; otherwise the edit is staged as a local file and the
    // live document reloads what the Console holds.
    const applies = state.connection.mode === 'apply' && !this.staging();
    try {
      await (applies ? this.save(text, ref.name) : this.stage(ref, text));
    } catch (error) {
      throw vscode.FileSystemError.Unavailable(describeError(error));
    }
    const saved = (this.revisions.get(uri.toString()) ?? 1) + 1;
    this.revisions.set(uri.toString(), saved);
    if (!applies) {
      // VS Code records the revision it stats right after saving; a later one makes it reload what the Console holds.
      setTimeout(() => {
        this.revisions.set(uri.toString(), saved + 1);
        this.changed.fire([{ type: vscode.FileChangeType.Changed, uri }]);
      }, 100);
    }
  }

  delete(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }

  rename(uri: vscode.Uri): void {
    throw vscode.FileSystemError.NoPermissions(uri);
  }
}
