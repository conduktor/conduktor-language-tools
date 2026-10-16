import * as vscode from 'vscode';
import { catalogDocuments, listPath, NameIndex, parentsOf, type NameSource, type Resource } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { ContentCache } from '../sync/contentCache';
import { readAll } from '../sync/files';
import type { SyncFolder } from '../sync/syncFolder';

/** A Console document in the repository: its file, its text and where it starts in the file. */
export interface RepoDocument {
  uri: vscode.Uri;
  start: number;
  text: string;
  fullText: string;
  resource: Resource;
}

export class Names implements vscode.Disposable {
  private lists = new Map<string, Promise<Resource[] | undefined>>();
  private files = new Map<string, Promise<RepoDocument[]>>();
  private others: Promise<RepoDocument[]> | undefined;
  private readonly fileDocuments = new ContentCache<RepoDocument[]>();
  private readonly parsed = new Map<string, { version: number; documents: RepoDocument[] }>();
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    this.listeners = [
      sessions.onDidChange(() => {
        // Parsed against the session's catalog; the Console's answers alone do not change a file.
        this.fileDocuments.clear();
        this.clear();
      }),
      sync.onDidChange(() => {
        this.fileDocuments.retain(this.sync.list().map((entry) => entry.uri.toString()));
        this.files = new Map();
        this.others = undefined;
        this.changed.fire();
      }),
      vscode.workspace.onDidCloseTextDocument((document) => this.parsed.delete(document.uri.toString())),
    ];
  }

  /** Forgets what the Console said, after a refresh or a change the extension made there itself. */
  clear(): void {
    this.lists = new Map();
    this.files = new Map();
    this.others = undefined;
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
    const unindexed = [...this.openResources(kind), ...(await this.otherDocuments(kind)).map((d) => d.resource)];
    for (const resource of unindexed)
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

  async repoResources(kind: string): Promise<Resource[]> {
    return (await this.repoDocuments(kind)).map((document) => document.resource);
  }

  /** The repository's documents of a kind: open documents win over their files, which are read once per change. */
  async repoDocuments(kind: string): Promise<RepoDocument[]> {
    const open = new Set(this.openDocuments().map((document) => document.uri.toString()));
    const files = this.files.get(kind) ?? this.readFiles(kind);
    this.files.set(kind, files);
    const fromFiles = [...(await files), ...(await this.otherDocuments(kind))].filter(
      (document) => !open.has(document.uri.toString()),
    );
    return [...this.openRepoDocuments(kind), ...fromFiles];
  }

  // Files the sync folder does not index as one resource each, read once per change.
  private async otherDocuments(kind: string): Promise<RepoDocument[]> {
    this.others ??= (async () => {
      const found: RepoDocument[] = [];
      for (const uri of this.sync.others())
        found.push(...this.documentsIn(uri, new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))));
      return found;
    })();
    return (await this.others).filter((document) => document.resource.kind === kind);
  }

  private async readFiles(kind: string): Promise<RepoDocument[]> {
    const entries = this.sync.list().filter((e) => e.kind === kind);
    const texts = await readAll(entries.map((entry) => entry.uri));
    return entries.flatMap((entry, i) => {
      const text = texts[i];
      if (text === undefined) return [];
      return this.fileDocuments
        .get(entry.uri.toString(), [text], () => this.documentsIn(entry.uri, text))
        .filter((document) => document.resource.kind === kind);
    });
  }

  private documentsIn(uri: vscode.Uri, fullText: string): RepoDocument[] {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    return catalogDocuments(fullText, state.spec.catalog).flatMap((document) =>
      document.resource
        ? [
            {
              uri,
              start: document.start,
              text: fullText.slice(document.start, document.end),
              fullText,
              resource: document.resource,
            },
          ]
        : [],
    );
  }

  // What the user is writing counts as the repository: untitled documents and files in the sync folder, not git
  // diff sides or other folders that happen to be open.
  private openDocuments(): vscode.TextDocument[] {
    return vscode.workspace.textDocuments.filter(
      (d) => d.languageId === 'yaml' && (d.uri.scheme === 'untitled' || this.sync.contains(d.uri)),
    );
  }

  private openResources(kind: string): Resource[] {
    return this.openRepoDocuments(kind).map((document) => document.resource);
  }

  private openRepoDocuments(kind: string): RepoDocument[] {
    return this.openDocuments().flatMap((document) => {
      const key = document.uri.toString();
      let parsed = this.parsed.get(key);
      if (parsed?.version !== document.version) {
        parsed = { version: document.version, documents: this.documentsIn(document.uri, document.getText()) };
        this.parsed.set(key, parsed);
      }
      return parsed.documents.filter((d) => d.resource.kind === kind);
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

function parentsIn(resource: Resource, params: readonly string[]): string[] {
  return params.map((param) => {
    const value = resource.metadata[param];
    return typeof value === 'string' ? value : '';
  });
}

function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.join('/') === b.join('/');
}
