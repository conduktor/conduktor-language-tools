import * as vscode from 'vscode';
import { parse, stringify } from 'yaml';
import {
  basePathOf,
  collectResources,
  ConsoleError,
  eachLimit,
  defaultKinds,
  collapseIncludes,
  expandedText,
  includeRestores,
  statusWithIncludes,
  describeError,
  driftOf,
  ENV_EXAMPLE,
  envExample,
  environmentDir,
  resolveEnvironment,
  environmentName,
  environments,
  ENVIRONMENTS_DIR,
  isRecord,
  itemPath,
  listPath,
  migrationPaths,
  parentsOf,
  planMigration,
  planRootMove,
  referencedVariables,
  REPO_CONFIG,
  rootMovePaths,
  STATE_DIR,
  syncPath,
  syncStatus,
  withEnvironment,
  withSecretPlaceholders,
  type BootstrapResult,
  type Drift,
  type KindVersion,
  type Resource,
  type SyncStatus,
} from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';
import type { Output } from '../output';
import { includePath, includeReaderFor } from '../editing/includes';
import { ContentCache } from './contentCache';
import { fileExists, read, readAll, remove, write } from './files';
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
  drift?: Drift;
}

interface RefreshOptions {
  drift?: boolean;
}

const ROOT_KEY = 'conduktor.syncRoot';

export class SyncFolder implements vscode.Disposable {
  private entries: LocalEntry[] = [];
  private entriesByUri = new Map<string, LocalEntry>();
  private otherFiles: vscode.Uri[] = [];
  private bootstrapping = false;
  private drift = new Map<string, Drift>();
  private exists = false;
  private binding: { environment?: string; problem?: string } = {};
  private watcher: vscode.FileSystemWatcher | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly refreshes = singleFlight<RefreshOptions>(
    (options) => this.rescan(options),
    (a, b) => ({ drift: a.drift || b.drift }),
  );
  private readonly scanned = new ContentCache<{ identity: Identity; status: SyncStatus } | undefined>();
  private scannedWith: SessionState | undefined;
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
      title: 'Where should Conduktor keep its repository? Each connection gets environments/<name> inside.',
      ignoreFocusOut: true,
    });
    if (!picked) return false;
    const root = picked.root ?? (await chooseFolder(suggested));
    if (!root) return false;
    await this.setSyncRoot(root);
    return true;
  }

  async moveConnectionFolders(from: vscode.Uri, to: vscode.Uri, connectionNames: readonly string[]): Promise<number> {
    let bound: string[] = [];
    try {
      bound = Object.keys(environments(await read(vscode.Uri.joinPath(from, REPO_CONFIG))));
    } catch (error) {
      this.output.warn(describeError(error));
    }
    const envs = [...new Set([...connectionNames.map(environmentName), ...bound])].filter(
      (env) => environmentName(env) === env,
    );
    const paths = rootMovePaths(envs);
    const present = async (root: vscode.Uri) => {
      const found = new Set<string>();
      for (const path of paths) if (await fileExists(vscode.Uri.joinPath(root, path))) found.add(path);
      return found;
    };
    const { moves, refused } = planRootMove(envs, await present(from), await present(to));
    for (const move of refused) this.output.warn(`Not moving ${move.from}: it already exists in ${to.fsPath}.`);
    for (const move of moves) {
      const target = vscode.Uri.joinPath(to, move.to);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
      await vscode.workspace.fs.rename(vscode.Uri.joinPath(from, move.from), target);
    }
    return envs.filter((env) => moves.some((move) => move.from === environmentDir(env))).length;
  }

  /** The environment the current connection is bound to: by its Console URL in conduktor.yaml, else its name. */
  environment(): string | undefined {
    return this.sessions.current().status === 'ready' ? this.binding.environment : undefined;
  }

  private requireEnvironment(): string {
    const env = this.environment();
    if (!env) throw new Error(this.binding.problem ?? 'Connect to a Conduktor Console first.');
    return env;
  }

  root(): vscode.Uri | undefined {
    const syncRoot = this.syncRoot();
    const env = this.environment();
    return syncRoot && env ? vscode.Uri.joinPath(syncRoot, environmentDir(env)) : undefined;
  }

  /** The environment a file under this folder's environments/ belongs to, when it is not the current connection's. */
  foreignEnvironment(uri: vscode.Uri): string | undefined {
    const syncRoot = this.syncRoot();
    const prefix = syncRoot && `${syncRoot.path.replace(/\/+$/, '')}/${ENVIRONMENTS_DIR}/`;
    if (!syncRoot || !prefix || uri.scheme !== syncRoot.scheme || !uri.path.startsWith(prefix)) return undefined;
    const env = uri.path.slice(prefix.length).split('/')[0];
    return env && env !== this.environment() ? env : undefined;
  }

  isActive(): boolean {
    return this.exists;
  }

  list(): readonly LocalEntry[] {
    return this.entries;
  }

  /** YAML files in the environment that are not one resource each: several documents, or hand-written layouts. */
  others(): readonly vscode.Uri[] {
    return this.otherFiles;
  }

  changes(): LocalEntry[] {
    return this.entries.filter((entry) => entry.status !== 'synced' || entry.drift);
  }

  entryAt(uri: vscode.Uri): LocalEntry | undefined {
    return this.entriesByUri.get(uri.toString());
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
    const root = this.requireRoot();
    const live = await state.client.get(itemPath(kind, parentsOf(kind, [...parents]), name));
    this.requireSameSession(state, `${kind.kind} ${name}`);
    const { uri, kept } = await this.writeSynced(kind, [...parents], live, root);
    // Asked for this one resource, so say why nothing happened; a bulk sync just leaves it.
    if (kept) throw new NotSyncedCopyError(syncPath(kind, [...parents], name), live);
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
    const root = this.requireRoot();
    const resources = await state.client.list(listPath(kind, parentsOf(kind, [...parents])));
    if (!(await proceed(resources.length))) return undefined;
    for (const resource of resources) {
      if (this.sessions.current() !== state) break;
      const staged = this.entryFor(kind.kind, parents, resource.metadata.name);
      if (staged && staged.status !== 'synced') continue;
      try {
        await this.writeSynced(kind, [...parents], resource, root);
      } catch (error) {
        this.output.warn(describeError(error));
      }
    }
    await this.refresh();
    return resources.length;
  }

  /** The kinds this environment manages: its entry in conduktor.yaml, else every kind but User. */
  async managedKinds(): Promise<string[]> {
    const state = this.ready();
    const config = await read(vscode.Uri.joinPath(this.requireSyncRoot(), REPO_CONFIG));
    return environments(config)[this.requireEnvironment()]?.kinds ?? defaultKinds(state.spec.catalog);
  }

  /** Bootstraps the environment: every chosen kind, globally and in every cluster, under the never-overwrite rules. */
  async syncEverything(
    kinds: readonly string[],
    options: { cancelled?: () => boolean; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<BootstrapResult> {
    await this.requireChosen();
    const state = this.ready();
    const syncRoot = this.requireSyncRoot();
    // Everything is written where this connection's environment was when the run started; a switch stops it.
    const root = this.requireRoot();
    const switched = () => this.sessions.current() !== state;
    const configUri = vscode.Uri.joinPath(syncRoot, REPO_CONFIG);
    const config = withEnvironment(await read(configUri), this.requireEnvironment(), {
      console: state.client.baseUrl,
      kinds: [...kinds],
    });
    await write(configUri, config);
    await this.ensureIgnored(['.env', `${ENVIRONMENTS_DIR}/*/.env`]);
    await this.refresh();

    const { fetched, skipped, builtIn, cancelled } = await collectResources(state.client, state.spec.catalog, kinds, {
      concurrency: 4,
      onProgress: options.onProgress,
      cancelled: () => switched() || (options.cancelled?.() ?? false),
    });
    const result: BootstrapResult = {
      written: {},
      unchanged: 0,
      conflicts: [],
      skipped,
      builtIn,
      cancelled: cancelled || switched(),
    };
    if (result.cancelled) return result;
    // Thousands of files are written; the watcher's rescans would re-read the folder after every one.
    this.bootstrapping = true;
    try {
      await this.ensureStateDir();
      await eachLimit(fetched, 8, async ({ kind, parents, resource }) => {
        if (switched()) {
          result.cancelled = true;
          return;
        }
        try {
          const { written } = await this.writeSynced(kind, parents, resource, root);
          if (written) result.written[kind.kind] = (result.written[kind.kind] ?? 0) + 1;
          else result.unchanged++;
        } catch (error) {
          if (error instanceof NotSyncedCopyError) result.conflicts.push(error.path);
          else
            result.skipped.push({
              kind: kind.kind,
              parents,
              reason: `${syncPath(kind, parents, resource.metadata.name)}: ${describeError(error)}`,
            });
        }
      });
      result.conflicts.sort();
    } finally {
      this.bootstrapping = false;
    }
    if (switched()) return result;
    await this.refresh();
    const texts = await Promise.all(this.entries.map(async (entry) => (await read(entry.uri)) ?? ''));
    await write(vscode.Uri.joinPath(root, ENV_EXAMPLE), envExample(texts));
    return result;
  }

  /**
   * Writes an edited live resource into the folder, tracked against the Console version as its base. A rename in the
   * edit stages a new resource; the original keeps its own file.
   */
  async stageEdit(kind: KindVersion, parents: readonly string[], name: string, text: string): Promise<vscode.Uri> {
    const state = this.ready();
    const identity = identify(text, state);
    const staged = withPlaceholders(text, identity?.parents ?? parents);
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
    const onDisk = entry && (await read(entry.uri));
    if (
      entry &&
      onDisk !== undefined &&
      (await this.changedLocally(entry.uri, onDisk, await read(this.baseOf(entry.uri)!)))
    )
      throw new LocalChangesError(entry);
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
    const base = this.baseOf(uri);
    if (base) await write(base, text);
    // What the included files held goes with it, so a later edit to them shows and drift compares like with like.
    const applied = this.baseOf(uri, 'applied');
    const expanded = includes(text) ? expandedText(text, includeReaderFor(uri) ?? unreadable) : undefined;
    if (applied) await (expanded === undefined ? remove(applied) : write(applied, expanded));
    this.drift.delete(uri.toString());
    await this.refresh();
  }

  async discard(uri: vscode.Uri): Promise<void> {
    const copy = this.baseOf(uri);
    const base = copy && (await read(copy));
    if (base === undefined) throw new Error('This file is new, so there is nothing to go back to.');
    await write(uri, base);
    const appliedCopy = this.baseOf(uri, 'applied');
    const applied = appliedCopy && (await read(appliedCopy));
    if (applied !== undefined && uri.scheme === 'file')
      for (const restore of includeRestores(base, applied))
        await write(vscode.Uri.file(includePath(uri, restore.path)), restore.content);
    await this.refresh();
  }

  async resync(uri: vscode.Uri): Promise<void> {
    const entry = this.entryAt(uri);
    const state = this.ready();
    const kind = entry && state.spec.catalog.resolve(entry.apiVersion, entry.kind);
    if (!entry || !kind) throw new Error('Not a Conduktor resource in the sync folder.');
    const live = await state.client.get(itemPath(kind, parentsOf(kind, entry.parents), entry.name));
    this.requireSameSession(state, `${entry.kind} ${entry.name}`);
    const text = stringify(withSecretPlaceholders(live, entry.parents).resource);
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
      this.setEntries([]);
      return;
    }
    const state = this.sessions.current();
    let entries = await this.scan(root, state);
    if (state.status === 'ready' && (await this.relocate(root, entries, state))) entries = await this.scan(root, state);
    if (options.drift && state.status === 'ready') await this.checkDrift(entries, state);
    this.setEntries(entries.map((entry) => ({ ...entry, drift: this.drift.get(entry.uri.toString()) })));
  }

  private setEntries(entries: LocalEntry[]): void {
    this.entries = entries;
    this.entriesByUri = new Map(entries.map((entry) => [entry.uri.toString(), entry]));
    this.changed.fire();
  }

  private async scan(root: vscode.Uri, state: SessionState): Promise<LocalEntry[]> {
    const files = await vscode.workspace.findFiles(
      new vscode.RelativePattern(root, '**/*.{yaml,yml}'),
      new vscode.RelativePattern(root, `${STATE_DIR}/**`),
    );
    // Identities depend on the session's catalog, so nothing carries over to another session.
    if (state !== this.scannedWith) {
      this.scanned.clear();
      this.scannedWith = state;
    }
    const texts = await readAll(files);
    const bases = await readAll(
      files.map((uri, i) => (texts[i] === undefined || state.status !== 'ready' ? undefined : this.baseOf(uri))),
    );
    const applied = await readAll(
      files.map((uri, i) => (state.status === 'ready' && includes(texts[i]) ? this.baseOf(uri, 'applied') : undefined)),
    );
    const entries: LocalEntry[] = [];
    const others: vscode.Uri[] = [];
    files.forEach((uri, i) => {
      const text = texts[i];
      if (text === undefined) return;
      const scan = () => {
        if (state.status !== 'ready') return undefined;
        const identity = identify(text, state);
        const status = includes(text)
          ? statusWithIncludes(text, bases[i], applied[i], includeReaderFor(uri) ?? unreadable)
          : syncStatus(text, bases[i]);
        return identity && { identity, status };
      };
      // A file that includes another depends on content the cache key does not hold, so it is read every scan.
      const found = includes(text) ? scan() : this.scanned.get(uri.toString(), [text, bases[i]], scan);
      if (!found) others.push(uri);
      else entries.push({ uri, path: uri.path.slice(root.path.length + 1), ...found.identity, status: found.status });
    });
    this.scanned.retain(files.map(String));
    this.otherFiles = others;
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
      const tracked = !!base && (await fileExists(base));
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
        for (const copy of ['base', 'applied'] as const) {
          const from = this.baseOf(entry.uri, copy)!;
          const to = this.baseOf(target, copy)!;
          if (!(await fileExists(from))) continue;
          await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, '..'));
          await vscode.workspace.fs.rename(from, to, { overwrite: true });
        }
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
    const tracked = entries.filter((entry) => entry.status !== 'new');
    const bases = await readAll(tracked.map((entry) => this.baseOf(entry.uri)));
    const applied = await readAll(tracked.map((entry) => this.baseOf(entry.uri, 'applied')));
    await eachLimit([...tracked.keys()], 8, async (i) => {
      const entry = tracked[i]!;
      const kind = state.spec.catalog.resolve(entry.apiVersion, entry.kind);
      const base = applied[i] ?? bases[i];
      if (!kind || base === undefined) return;
      try {
        const live = await state.client.get(itemPath(kind, parentsOf(kind, entry.parents), entry.name));
        const drift = driftOf(base, live);
        if (drift) this.drift.set(entry.uri.toString(), drift);
      } catch (error) {
        if (error instanceof ConsoleError && error.status === 404) this.drift.set(entry.uri.toString(), 'deleted');
        else this.output.warn(`Could not check ${entry.path} against the Console: ${describeError(error)}`);
      }
    });
  }

  private async writeSynced(
    kind: KindVersion,
    parents: string[],
    live: Resource,
    root: vscode.Uri = this.requireRoot(),
  ): Promise<{ uri: vscode.Uri; written: boolean; kept?: boolean }> {
    const path = syncPath(kind, parents, live.metadata.name);
    const uri = vscode.Uri.joinPath(root, path);
    const base = this.baseOf(uri)!;
    const appliedCopy = this.baseOf(uri, 'applied')!;
    const current = await read(uri);
    const baseText = current === undefined ? undefined : await read(base);
    const { resource: placeholdered, variables } = withSecretPlaceholders(live, parents);
    // A file that includes another keeps that layout: the Console's content goes back into the included files.
    const { resource, writes } =
      current !== undefined && includes(current)
        ? collapseIncludes(placeholdered, current)
        : { resource: placeholdered, writes: [] };
    const text = stringify(resource);
    if (current !== undefined) {
      // The disk decides, not the last scan. Nothing changed on the Console since the base: the file stays as it is,
      // comments and all. Both changed: the local edit is never overwritten.
      const applied = await read(appliedCopy);
      const appliedIncludes = applied === undefined || baseText === undefined ? [] : includeRestores(baseText, applied);
      const consoleChanged =
        baseText !== text || writes.some((w) => w.content !== appliedIncludes.find((a) => a.path === w.path)?.content);
      const changedLocally = await this.changedLocally(uri, current, baseText);
      if (!consoleChanged) return { uri, written: false, kept: changedLocally };
      if (changedLocally) throw new NotSyncedCopyError(path, live);
    }
    if (variables.length > 0) {
      this.output.info(
        `${live.kind} ${live.metadata.name}: secrets replaced with ${variables.map((v) => `\${${v}}`).join(', ')}`,
      );
    }
    if (!this.bootstrapping) await this.ensureStateDir();
    for (const include of writes) await write(vscode.Uri.file(includePath(uri, include.path)), include.content);
    await write(uri, text);
    await write(base, text);
    await (writes.length > 0 ? write(appliedCopy, stringify(placeholdered)) : remove(appliedCopy));
    return { uri, written: true };
  }

  // Byte for byte against the base, an added comment included, and through what the included files held when applied.
  private async changedLocally(uri: vscode.Uri, current: string, baseText: string | undefined): Promise<boolean> {
    if (current !== baseText) return true;
    if (!includes(current)) return false;
    const applied = await read(this.baseOf(uri, 'applied')!);
    return statusWithIncludes(current, baseText, applied, includeReaderFor(uri) ?? unreadable) !== 'synced';
  }

  private async ensureIgnored(patterns: readonly string[]): Promise<void> {
    const uri = vscode.Uri.joinPath(this.requireSyncRoot(), '.gitignore');
    const current = (await read(uri)) ?? '';
    const missing = patterns.filter((pattern) => !current.split('\n').includes(pattern));
    if (missing.length === 0) return;
    const separator = current && !current.endsWith('\n') ? '\n' : '';
    await write(uri, `${current}${separator}${missing.join('\n')}\n`);
  }

  private async ensureStateDir(): Promise<void> {
    const ignore = vscode.Uri.joinPath(this.requireSyncRoot(), STATE_DIR, '.gitignore');
    if (!(await fileExists(ignore))) await write(ignore, '*\n');
  }

  /** The base copy a file in the folder is compared with, if it has one. */
  baseUri(uri: vscode.Uri): vscode.Uri | undefined {
    return this.entryAt(uri) ? this.baseOf(uri) : undefined;
  }

  isBaseCopy(uri: vscode.Uri): boolean {
    const syncRoot = this.syncRoot();
    const base = syncRoot && `${syncRoot.path.replace(/\/+$/, '')}/${STATE_DIR}/base/`;
    return !!syncRoot && !!base && uri.scheme === syncRoot.scheme && uri.path.startsWith(base);
  }

  // From the file's own path, never from the current connection: a request that finishes after a switch still writes
  // its base copy beside the file it belongs to.
  private baseOf(uri: vscode.Uri, copy: 'base' | 'applied' = 'base'): vscode.Uri | undefined {
    const syncRoot = this.syncRoot();
    const path = syncRoot && basePathOf(syncRoot.path, uri.path, copy);
    return path === undefined ? undefined : uri.with({ path });
  }

  private requireSyncRoot(): vscode.Uri {
    const syncRoot = this.syncRoot();
    if (!syncRoot) throw new Error('Choose a sync folder (Conduktor: Set Sync Folder…) first.');
    return syncRoot;
  }

  // Says which is missing: the folder, the connection, or a usable environment binding in conduktor.yaml.
  private requireRoot(): vscode.Uri {
    return vscode.Uri.joinPath(this.requireSyncRoot(), environmentDir(this.requireEnvironment()));
  }

  private async requireChosen(): Promise<void> {
    if (!(await this.ensureChosen())) throw new Error('No sync folder chosen, so nothing was written.');
  }

  // Per workspace, so each repository can bind its own folder; machine-wide when no folder is open.
  private memory(): vscode.Memento {
    return vscode.workspace.workspaceFolders?.length ? this.context.workspaceState : this.context.globalState;
  }

  // A resource fetched before a connection switch belongs to the old connection, not to the folder now on show.
  private requireSameSession(state: Ready, subject: string): void {
    if (this.sessions.current() !== state)
      throw new Error(`The connection changed while ${subject} was fetched, so nothing was written.`);
  }

  private ready(): Ready {
    const state = this.sessions.current();
    if (state.status !== 'ready') throw new Error('Connect to a Conduktor Console first.');
    return state;
  }

  private async rebind(): Promise<void> {
    this.watcher?.dispose();
    this.watcher = undefined;
    this.binding = await this.bindEnvironment();
    if (this.binding.problem) this.output.warn(this.binding.problem);
    try {
      await this.migrate();
    } catch (error) {
      this.output.error(`Could not move the sync folder into environments/: ${describeError(error)}`);
    }
    const root = this.root();
    if (root) {
      this.watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(root, '**/*'));
      const schedule = () => {
        if (this.bootstrapping) return;
        if (this.refreshTimer) clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => void this.refresh(), 300);
      };
      this.watcher.onDidCreate(schedule);
      this.watcher.onDidChange(schedule);
      this.watcher.onDidDelete(schedule);
    }
    await this.refresh();
  }

  private async bindEnvironment(): Promise<{ environment?: string; problem?: string }> {
    const state = this.sessions.current();
    const syncRoot = this.syncRoot();
    if (state.status !== 'ready' || !syncRoot) return {};
    try {
      const config = await read(vscode.Uri.joinPath(syncRoot, REPO_CONFIG));
      return resolveEnvironment(config, state.client.baseUrl, state.connection.name);
    } catch (error) {
      return { problem: describeError(error) };
    }
  }

  private async migrate(): Promise<void> {
    const syncRoot = this.syncRoot();
    const env = this.environment();
    if (!syncRoot || !env) return;
    const existing = new Set<string>();
    for (const path of migrationPaths(env))
      if (await fileExists(vscode.Uri.joinPath(syncRoot, path))) existing.add(path);
    const { moves, refused } = planMigration(env, existing);
    for (const move of refused)
      this.output.warn(`Not moving ${move.from} to ${move.to}: ${move.to} already exists. Move it by hand.`);
    for (const move of moves) {
      const to = vscode.Uri.joinPath(syncRoot, move.to);
      await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(to, '..'));
      await vscode.workspace.fs.rename(vscode.Uri.joinPath(syncRoot, move.from), to);
      this.output.info(`Moved ${move.from} to ${move.to}`);
    }
    // Once the base has moved out, the old state folder should hold only the .gitignore the extension wrote; anything
    // else in it is left for the user.
    const leftover = vscode.Uri.joinPath(syncRoot, environmentDir(env), STATE_DIR);
    if (moves.length > 0 && (await fileExists(leftover))) {
      await Promise.resolve(vscode.workspace.fs.delete(vscode.Uri.joinPath(leftover, '.gitignore'))).catch(
        () => undefined,
      );
      await Promise.resolve(vscode.workspace.fs.delete(leftover)).catch(() => undefined);
    }
  }
}

class NotSyncedCopyError extends Error {
  constructor(
    readonly path: string,
    live: Resource,
  ) {
    super(`${path} is not a synced copy of ${live.kind} ${live.metadata.name}, so it is left as it is.`);
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
function withPlaceholders(text: string, parents: readonly string[]): string {
  try {
    const value: unknown = parse(text);
    return isRecord(value) ? stringify(withSecretPlaceholders(value as Resource, parents).resource) : text;
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

// A cheap first look; the parse decides whether a file really includes another.
function includes(text: string | undefined): boolean {
  return text !== undefined && /schemaFile|descriptionFile/.test(text);
}

function unreadable(): never {
  throw new Error('Included files can only be read from local files.');
}

type Identity = NonNullable<ReturnType<typeof identify>>;

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
