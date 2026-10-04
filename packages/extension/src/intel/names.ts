import * as vscode from 'vscode';
import {
  catalogDocuments,
  listPath,
  NameIndex,
  parentsOf,
  type NameSource,
  type Resource,
} from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';

export class Names implements vscode.Disposable {
  private lists = new Map<string, Promise<Resource[] | undefined>>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly listener: vscode.Disposable;

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    this.listener = sessions.onDidChange(() => this.clear());
  }

  clear(): void {
    this.lists = new Map();
    this.changed.fire();
  }

  /** `checked` is true only when the Console answered: a missing name is only missing then. */
  async lookup(
    kind: string,
    parents: readonly string[],
  ): Promise<{ names: { name: string; sources: NameSource[] }[]; checked: boolean }> {
    const index = new NameIndex();
    const params = this.parentParams(kind);
    for (const resource of await this.repoResources(kind))
      if (sameParents(parentsIn(resource, params), parents)) index.add(kind, parents, resource.metadata.name, 'repo');
    const live = await this.resources(kind, parents);
    for (const resource of live ?? []) index.add(kind, parents, resource.metadata.name, 'console');
    return { names: index.list(kind, parents), checked: live !== undefined };
  }

  resources(kind: string, parents: readonly string[]): Promise<Resource[] | undefined> {
    const state = this.sessions.current();
    const target = state.status === 'ready' ? state.spec.catalog.latest(kind) : undefined;
    if (state.status !== 'ready' || !target) return Promise.resolve(undefined);
    const path = listPath(target, parentsOf(target, [...parents]));
    const cached = this.lists.get(path);
    if (cached) return cached;
    const list = state.client.list(path).then(
      (resources) => {
        this.changed.fire();
        return resources;
      },
      () => undefined,
    );
    this.lists.set(path, list);
    return list;
  }

  /** The repository's documents of a kind: the sync folder's files, with open documents' unsaved text winning. */
  async repoResources(kind: string): Promise<Resource[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const open = new Map<string, string>();
    for (const document of vscode.workspace.textDocuments)
      if (document.languageId === 'yaml') open.set(document.uri.toString(), document.getText());
    const texts = [...open.values()];
    for (const entry of this.sync.list())
      if (entry.kind === kind && !open.has(entry.uri.toString()))
        texts.push(new TextDecoder().decode(await vscode.workspace.fs.readFile(entry.uri)));
    const found: Resource[] = [];
    for (const text of texts)
      for (const document of catalogDocuments(text, state.spec.catalog))
        if (document.kind === kind && document.resource) found.push(document.resource);
    return found;
  }

  private parentParams(kind: string): string[] {
    const state = this.sessions.current();
    return state.status === 'ready' ? (state.spec.catalog.latest(kind)?.parentPathParams ?? []) : [];
  }

  dispose(): void {
    this.listener.dispose();
    this.changed.dispose();
  }
}

function parentsIn(resource: Resource, params: readonly string[]): string[] {
  return params.map((param) => {
    const value = resource.metadata[param];
    return typeof value === 'string' ? value : '';
  });
}

function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.join('/') === b.join('/');
}
