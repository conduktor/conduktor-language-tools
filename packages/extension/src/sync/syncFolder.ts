import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import {
  ConsoleError,
  describeError,
  isDrifted,
  isRecord,
  itemPath,
  listPath,
  parentsOf,
  referencedVariables,
  syncPath,
  syncStatus,
  withSecretPlaceholders,
  type KindVersion,
  type Resource,
  type SyncStatus,
} from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';
import type { Output } from '../output';
import { singleFlight } from './singleFlight';

type Ready = Extract<SessionState, { status: 'ready' }>;

export interface LocalEntry {
  uri: vscode.Uri;
  path: string;
  kind: string;
  apiVersion: string;
  parents: string[];
  name: string;
  status: SyncStatus;
  drifted: boolean;
}

interface RefreshOptions {
  drift?: boolean;
}

const STATE_DIR = '.conduktor';
const ROOT_KEY = 'conduktor.syncRoot';

export class SyncFolder implements vscode.Disposable {
  private entries: LocalEntry[] = [];
  private drift = new Set<string>();
  private exists = false;
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly refreshes = singleFlight<RefreshOptions>(
    (options) => this.rescan(options),
    (a, b) => ({ drift: a.drift || b.drift }),
  );
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly sessionListener: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SessionManager,
    private readonly output: Output,
  ) {
    this.sessionListener = sessions.onDidChange(() => void this.rebind());
  }

  /** The folder the user picked for all connections, or `<workspace>/conduktor` until they pick one. */
  syncRoot(): vscode.Uri | undefined {
    const chosen = this.memory().get<string>(ROOT_KEY);
    if (chosen) return vscode.Uri.parse(chosen);
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder && vscode.Uri.joinPath(folder.uri, 'conduktor');
  }

  isRootChosen(): boolean {
    return this.memory().get<string>(ROOT_KEY) !== undefined;
  }

  async setSyncRoot(root: vscode.Uri): Promise<void> {
    await this.memory().update(ROOT_KEY, root.toString());
    this.output.info(`Sync folder: ${root.fsPath}`);
    await this.rebind();
  }

  /** Asks once where to put the files, the first time anything is written. */
  async ensureChosen(): Promise<boolean> {
    if (this.isRootChosen()) return true;
    const suggested = this.syncRoot();
    const picks = [
      ...(suggested
        ? [
            {
              label: `Use ${vscode.workspace.asRelativePath(suggested)}`,
              description: suggested.fsPath,
              root: suggested,
            },
          ]
        : []),
      { label: 'Choose a folder…', description: 'for example a GitOps repository', root: undefined },
    ];
    const picked = await vscode.window.showQuickPick(picks, {
      title: 'Where should Conduktor keep local copies? Each connection gets its own folder inside.',
      ignoreFocusOut: true,
    });
    if (!picked) return false;
    const root = picked.root ?? (await chooseFolder(suggested));
    if (!root) return false;
    await this.setSyncRoot(root);
    return true;
  }

  async moveConnectionFolders(from: vscode.Uri, to: vscode.Uri, connectionNames: readonly string[]): Promise<number> {
    let moved = 0;
    for (const name of connectionNames) {
      const source = vscode.Uri.joinPath(from, folderName(name));
      const target = vscode.Uri.joinPath(to, folderName(name));
      if ((await fileExists(source)) && !(await fileExists(target))) {
        await vscode.workspace.fs.createDirectory(to);
        await vscode.workspace.fs.rename(source, target);
        moved++;
      }
    }
    return moved;
  }

  root(): vscode.Uri | undefined {
    const state = this.sessions.current();
    const syncRoot = this.syncRoot();
    if (state.status !== 'ready' || !syncRoot) return undefined;
    return vscode.Uri.joinPath(syncRoot, folderName(state.connection.name));
  }

  isActive(): boolean {
    return this.exists;
  }

  list(): readonly LocalEntry[] {
    return this.entries;
  }

  changes(): LocalEntry[] {
    return this.entries.filter((entry) => entry.status !== 'synced' || entry.drifted);
  }

  entryAt(uri: vscode.Uri): LocalEntry | undefined {
    return this.entries.find((entry) => entry.uri.toString() === uri.toString());
  }

  entryFor(kind: string, parents: readonly string[], name: string): LocalEntry | undefined {
    return this.entries.find(
      (entry) => entry.kind === kind && entry.name === name && sameParents(entry.parents, parents),
    );
  }

  contains(uri: vscode.Uri): boolean {
    const root = this.root();
    return !!root && uri.scheme === root.scheme && uri.path.startsWith(`${root.path}/`);
  }

  async syncResource(kind: KindVersion, parents: readonly string[], name: string): Promise<vscode.Uri> {
    const staged = this.entryFor(kind.kind, parents, name);
    if (staged && staged.status !== 'synced') return staged.uri;
    await this.requireChosen();
    const state = this.ready();
    const live = await state.client.get(itemPath(kind, parentsOf(kind, [...parents]), name));
    const uri = await this.writeSynced(kind, [...parents], live);
    await this.refresh();
    return uri;
  }

  async syncAll(
    kind: KindVersion,
    parents: readonly string[],
    proceed: (total: number) => Promise<boolean> = async () => true,
  ): Promise<number | undefined> {
    await this.requireChosen();
    const state = this.ready();
    const resources = await state.client.list(listPath(kind, parentsOf(kind, [...parents])));
    if (!(await proceed(resources.length))) return undefined;
    for (const resource of resources) {
      const staged = this.entryFor(kind.kind, parents, resource.metadata.name);
      if (staged && staged.status !== 'synced') continue;
      try {
        await this.writeSynced(kind, [...parents], resource);
      } catch (error) {
        this.output.warn(describeError(error));
      }
    }
    await this.refresh();
    return resources.length;
  }

  /**
   * Writes an edited live resource into the folder, tracked against the Console version as its base. A rename in the
   * edit stages a new resource; the original keeps its own file.
   */
  async stageEdit(kind: KindVersion, parents: readonly string[], name: string, text: string): Promise<vscode.Uri> {
    const state = this.ready();
    const staged = withPlaceholders(text);
    const identity = identify(text, state);
    if (
      identity &&
      !(identity.kind === kind.kind && identity.name === name && sameParents(identity.parents, parents))
    ) {
      const renamed = state.spec.catalog.resolve(identity.apiVersion, identity.kind)!;
      const missing = renamed.parentPathParams.filter((_, i) => identity.parents[i] === '');
      if (missing.length > 0)
        throw new Error(`${identity.kind} ${identity.name} needs metadata.${missing.join(', metadata.')}.`);
      return this.writeNew(renamed, identity.parents, staged, identity.name);
    }
    const entry = this.entryFor(kind.kind, parents, name);
    if (entry && entry.status !== 'synced') throw new LocalChangesError(entry);
    const uri = entry?.uri ?? (await this.syncResource(kind, parents, name));
    await write(uri, staged);
    await this.refresh();
    return this.entryFor(kind.kind, parents, name)?.uri ?? uri;
  }

  async writeNew(kind: KindVersion, parents: readonly string[], text: string, name: string): Promise<vscode.Uri> {
    await this.requireChosen();
    const root = this.requireRoot();
    const existing = this.entryFor(kind.kind, parents, name);
    if (existing) throw new Error(`${kind.kind} ${name} already has a local file: ${existing.path}.`);
    const path = syncPath(kind, parents, name);
    const uri = vscode.Uri.joinPath(root, path);
    if (await fileExists(uri)) throw new Error(`${path} already exists.`);
    await this.ensureStateDir();
    await write(uri, text);
    await this.refresh();
    return uri;
  }

  /** The name, or the first `<name>-<n>` that no local file uses. */
  async freeName(kind: KindVersion, parents: readonly string[], name: string): Promise<string> {
    const root = this.requireRoot();
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? name : `${name}-${n}`;
      const taken =
        this.entryFor(kind.kind, parents, candidate) ||
        (await fileExists(vscode.Uri.joinPath(root, syncPath(kind, parents, candidate))));
      if (!taken) return candidate;
    }
  }

  async markApplied(uri: vscode.Uri, text: string): Promise<void> {
    await write(this.baseOf(uri), text);
    this.drift.delete(uri.toString());
    await this.refresh();
  }

  async discard(uri: vscode.Uri): Promise<void> {
    const base = await read(this.baseOf(uri));
    if (base === undefined) throw new Error('This file is new, so there is nothing to go back to.');
    await write(uri, base);
    await this.refresh();
  }

  async resync(uri: vscode.Uri): Promise<void> {
    const entry = this.entryAt(uri);
    const state = this.ready();
    const kind = entry && state.spec.catalog.resolve(entry.apiVersion, entry.kind);
    if (!entry || !kind) throw new Error('Not a Conduktor resource in the sync folder.');
    const live = await state.client.get(itemPath(kind, parentsOf(kind, entry.parents), entry.name));
    const text = stringify(withSecretPlaceholders(live).resource);
    await write(uri, text);
    await this.markApplied(uri, text);
  }

  refresh(options: RefreshOptions = {}): Promise<void> {
    return this.refreshes(options);
  }

  private async rescan(options: RefreshOptions): Promise<void> {
    const root = this.root();
    this.exists = !!root && (await fileExists(root));
    await vscode.commands.executeCommand('setContext', 'conduktor.syncFolder', this.exists);
    if (!root || !this.exists) {
      this.entries = [];
      this.changed.fire();
      return;
    }
    const state = this.sessions.current();
    let entries = await this.scan(root, state);
    if (state.status === 'ready' && (await this.relocate(root, entries, state))) entries = await this.scan(root, state);
    if (options.drift && state.status === 'ready') await this.checkDrift(entries, state);
    this.entries = entries.map((entry) => ({ ...entry, drifted: this.drift.has(entry.uri.toString()) }));
    this.changed.fire();
  }

  private async scan(root: vscode.Uri, state: SessionState): Promise<LocalEntry[]> {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/*.{yaml,yml}'),
      new vscode.RelativePattern(root, `${STATE_DIR}/**`),
    );
    const entries: LocalEntry[] = [];
    for (const uri of files) {
      const text = await read(uri);
      const identity = text === undefined || state.status !== 'ready' ? undefined : identify(text, state);
      if (!identity) continue;
      const base = await read(this.baseOf(uri));
      entries.push({
        uri,
        path: uri.path.slice(root.path.length + 1),
        ...identity,
        status: syncStatus(text!, base),
        drifted: false,
      });
    }
    return entries;
  }

  // Keeps synced files at <name>.yaml in their mirrored folder, after a rename in the file or a layout change. A file
  // with no base moves only when renamed where it already sits, so files laid out by hand (a GitOps repository) stay
  // put. Moves go through a WorkspaceEdit so open editors and git follow them.
  private async relocate(root: vscode.Uri, entries: readonly LocalEntry[], state: Ready): Promise<boolean> {
    let moved = false;
    for (const entry of entries) {
      const kind = state.spec.catalog.resolve(entry.apiVersion, entry.kind);
      if (!kind || entry.parents.includes('')) continue;
      const expected = syncPath(kind, entry.parents, entry.name);
      if (expected.toLowerCase() === entry.path.toLowerCase()) continue;
      const base = this.baseOf(entry.uri);
      const tracked = await fileExists(base);
      if (!tracked && folderOf(expected) !== folderOf(entry.path)) continue;
      const target = vscode.Uri.joinPath(root, expected);
      if (await fileExists(target)) {
        this.output.warn(`${entry.path} describes ${entry.kind} ${entry.name}, but ${expected} already exists.`);
        continue;
      }
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      const edit = new vscode.WorkspaceEdit();
      edit.renameFile(entry.uri, target);
      if (!(await vscode.workspace.applyEdit(edit))) continue;
      if (tracked) {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(this.baseOf(target), '..'));
        await vscode.workspace.fs.rename(base, this.baseOf(target), { overwrite: true });
      }
      this.output.info(`Moved ${entry.path} to ${expected}`);
      moved = true;
    }
    return moved;
  }

  async requiredVariables(): Promise<{ name: string; set: boolean }[]> {
    const names = new Set<string>();
    for (const entry of this.entries) referencedVariables((await read(entry.uri)) ?? '').forEach((n) => names.add(n));
    return [...names].map((name) => ({ name, set: process.env[name] !== undefined }));
  }

  dispose(): void {
    this.sessionListener.dispose();
    this.watcher?.dispose();
    this.changed.dispose();
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
  }

  private async checkDrift(entries: readonly LocalEntry[], state: Ready): Promise<void> {
    this.drift.clear();
    for (const entry of entries) {
      if (entry.status === 'new') continue;
      const kind = state.spec.catalog.resolve(entry.apiVersion, entry.kind);
      const base = await read(this.baseOf(entry.uri));
      if (!kind || base === undefined) continue;
      try {
        const live = await state.client.get(itemPath(kind, parentsOf(kind, entry.parents), entry.name));
        if (isDrifted(base, live)) this.drift.add(entry.uri.toString());
      } catch (error) {
        if (error instanceof ConsoleError && error.status === 404) this.drift.add(entry.uri.toString());
        else this.output.warn(`Could not check ${entry.path} against the Console: ${describeError(error)}`);
      }
    }
  }

  private async writeSynced(kind: KindVersion, parents: string[], live: Resource): Promise<vscode.Uri> {
    const root = this.requireRoot();
    const path = syncPath(kind, parents, live.metadata.name);
    const uri = vscode.Uri.joinPath(root, path);
    if ((await fileExists(uri)) && this.entryAt(uri)?.status !== 'synced')
      throw new Error(`${path} is not a synced copy of ${live.kind} ${live.metadata.name}, so it is left as it is.`);
    const { resource, variables } = withSecretPlaceholders(live);
    if (variables.length > 0) {
      this.output.info(
        `${live.kind} ${live.metadata.name}: secrets replaced with ${variables.map((v) => `\${${v}}`).join(', ')}`,
      );
    }
    const text = stringify(resource);
    await this.ensureStateDir();
    await write(uri, text);
    await write(this.baseOf(uri), text);
    return uri;
  }

  private async ensureStateDir(): Promise<void> {
    const ignore = vscode.Uri.joinPath(this.requireRoot(), STATE_DIR, '.gitignore');
    if (!(await fileExists(ignore))) await write(ignore, '*\n');
  }

  private baseOf(uri: vscode.Uri): vscode.Uri {
    const root = this.requireRoot();
    return vscode.Uri.joinPath(root, STATE_DIR, 'base', uri.path.slice(root.path.length + 1));
  }

  private requireRoot(): vscode.Uri {
    const root = this.root();
    if (!root) throw new Error('Choose a sync folder (Conduktor: Set Sync Folder…) and connect to a Console.');
    return root;
  }

  private async requireChosen(): Promise<void> {
    if (!(await this.ensureChosen())) throw new Error('No sync folder chosen, so nothing was written.');
  }

  // Per workspace, so each repository can bind its own folder; machine-wide when no folder is open.
  private memory(): vscode.Memento {
    return vscode.workspace.workspaceFolders?.length ? this.context.workspaceState : this.context.globalState;
  }

  private ready(): Ready {
    const state = this.sessions.current();
    if (state.status !== 'ready') throw new Error('Connect to a Conduktor Console first.');
    return state;
  }

  private async rebind(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = undefined;
    const root = this.root();
    if (root) {
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const schedule = () => {
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 300);
      };
      this.watcher.onDidCreate(schedule);
      this.watcher.onDidChange(schedule);
      this.watcher.onDidDelete(schedule);
    }
    await this.refresh();
  }
}

export class LocalChangesError extends Error {
  constructor(readonly entry: LocalEntry) {
    super(
      `${entry.kind} ${entry.name} has local changes in ${entry.path} that are not applied yet. Edit that file, or ` +
        'Discard Changes on it first.',
    );
  }
}

// No secret value is written to disk; unparseable YAML is staged as typed, so the user can fix it in the file.
function withPlaceholders(text: string): string {
  try {
    const value: unknown = parse(text);
    return isRecord(value) ? stringify(withSecretPlaceholders(value as Resource).resource) : text;
  } catch {
    return text;
  }
}

function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.join('/') === b.join('/');
}

function folderOf(path: string): string {
  return path.slice(0, path.lastIndexOf('/'));
}

function identify(text: string, state: Ready) {
  let value: unknown;
  try {
    value = parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.kind !== 'string' || typeof value.apiVersion !== 'string') return undefined;
  const metadata = isRecord(value.metadata) ? value.metadata : {};
  const kind = state.spec.catalog.resolve(value.apiVersion, value.kind);
  if (!kind || typeof metadata.name !== 'string') return undefined;
  const parents = kind.parentPathParams.map((param) =>
    typeof metadata[param] === 'string' ? (metadata[param] as string) : '',
  );
  return { kind: kind.kind, apiVersion: value.apiVersion, parents, name: metadata.name };
}

export async function chooseFolder(suggested: vscode.Uri | undefined): Promise<vscode.Uri | undefined> {
  const [folder] =
    (await vscode.window.showOpenDialog({
      title: 'Sync folder for Conduktor resources',
      openLabel: 'Use as Sync Folder',
      canSelectFolders: true,
      canSelectFiles: false,
      canSelectMany: false,
      defaultUri: suggested,
    })) ?? [];
  return folder;
}

function folderName(connectionName: string): string {
  return connectionName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'console';
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function read(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

async function write(uri: vscode.Uri, text: string): Promise<void> {
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
  await vscode.workspace.fs.writeFile(uri, new TextEncoder().encode(text));
}
