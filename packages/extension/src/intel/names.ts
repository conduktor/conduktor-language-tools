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
  private files = new Map<string, Promise<Resource[]>>();
  private readonly parsed = new Map<string, { version: number; resources: Resource[] }>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    this.listeners = [
      sessions.onDidChange(() => this.clear()),
      sync.onDidChange(() => {
        this.files = new Map();
        this.changed.fire();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.parsed.delete(document.uri.toString())),
    ];
  }

  /** Forgets what the Console said, after a refresh or a change the extension made there itself. */
  clear(): void {
    this.lists = new Map();
    this.files = new Map();
    this.changed.fire();
  }

  /** `checked` is true only when the Console answered: a missing name is only missing then. */
  async lookup(
    kind: string,
    parents: readonly string[],
  ): Promise<{ names: { name: string; sources: NameSource[] }[]; checked: boolean }> {
    const index = new NameIndex();
    for (const entry of this.sync.list())
      if (entry.kind === kind && sameParents(entry.parents, parents)) index.add(kind, parents, entry.name, 'repo');
    const params = this.parentParams(kind);
    for (const resource of this.openResources(kind))
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

  /** The repository's full documents of a kind (for overlap): open documents win over their files. */
  async repoResources(kind: string): Promise<Resource[]> {
    const open = new Set(this.openDocuments().map((document) => document.uri.toString()));
    const files = this.files.get(kind) ?? this.readFiles(kind);
    this.files.set(kind, files);
    const fromFiles = (await files).filter((resource) => !open.has(sourceOf.get(resource) ?? ''));
    return [...this.openResources(kind), ...fromFiles];
  }

  private async readFiles(kind: string): Promise<Resource[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const found: Resource[] = [];
    for (const entry of this.sync.list().filter((e) => e.kind === kind)) {
      const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(entry.uri));
      for (const document of catalogDocuments(text, state.spec.catalog))
        if (document.kind === kind && document.resource) {
          sourceOf.set(document.resource, entry.uri.toString());
          found.push(document.resource);
        }
    }
    return found;
  }

  // What the user is writing counts as the repository: untitled documents and files in the sync folder, not git
  // diff sides or other folders that happen to be open.
  private openDocuments(): vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter(
      (d) => d.languageId === 'yaml' && (d.uri.scheme === 'untitled' || this.sync.contains(d.uri)),
    );
  }

  private openResources(kind: string): Resource[] {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    return this.openDocuments().flatMap((document) => {
      const key = document.uri.toString();
      let parsed = this.parsed.get(key);
      if (parsed?.version !== document.version) {
        const resources = catalogDocuments(document.getText(), state.spec.catalog).flatMap((d) =>
          d.resource ? [d.resource] : [],
        );
        parsed = { version: document.version, resources };
        this.parsed.set(key, parsed);
      }
      return parsed.resources.filter((resource) => resource.kind === kind);
    });
  }

  private parentParams(kind: string): string[] {
    const state = this.sessions.current();
    return state.status === 'ready' ? (state.spec.catalog.latest(kind)?.parentPathParams ?? []) : [];
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.changed.dispose();
  }
}

const sourceOf = new WeakMap<Resource, string>();

function parentsIn(resource: Resource, params: readonly string[]): string[] {
  return params.map((param) => {
    const value = resource.metadata[param];
    return typeof value === 'string' ? value : '';
  });
}

function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.join('/') === b.join('/');
}
