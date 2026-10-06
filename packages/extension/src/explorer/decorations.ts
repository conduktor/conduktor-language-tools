import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { ClusterSelection } from './clusterSelection';
import { resourceAtTreePath, scopeOf, treePathOf, type ExplorerNode } from './explorerModel';

/** Only tree items use this scheme, so decorating it never reaches an editor tab. */
export const TREE_SCHEME = 'conduktor-tree';

export function treeUriOf(node: ExplorerNode): vscode.Uri | undefined {
  const path = treePathOf(node);
  return path === undefined ? undefined : vscode.Uri.from({ scheme: TREE_SCHEME, path });
}

const DIMMED = new vscode.FileDecoration(
  undefined,
  'Only in the Console',
  new vscode.ThemeColor('gitDecoration.ignoredResourceForeground'),
);

export const LOCAL_LOOKS: Readonly<Record<string, { badge: string; color: string; tooltip: string }>> = {
  new: { badge: 'A', color: 'gitDecoration.addedResourceForeground', tooltip: 'New locally, not applied yet' },
  modified: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Changed locally, not applied' },
  changed: {
    badge: '⚠',
    color: 'gitDecoration.conflictingResourceForeground',
    tooltip: 'Changed on the Console since it was synced',
  },
  deleted: {
    badge: '⚠',
    color: 'gitDecoration.conflictingResourceForeground',
    tooltip: 'Deleted from the Console since it was synced; applying creates it again',
  },
};

/**
 * The Explorer's states the way git shows files: dimmed when only in the Console, a coloured label and letter for a
 * local copy not applied yet (rolled up to the kind, group and cluster), nothing when synced. Read from the sync folder
 * when asked, so it is as current as the folder's last scan.
 */
export class TreeDecorations implements vscode.FileDecorationProvider, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<undefined>();
  readonly onDidChangeFileDecorations = this.changed.event;
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
    private readonly clusters: ClusterSelection,
  ) {
    const all = () => this.changed.fire(undefined);
    this.listeners = [sync.onDidChange(all), clusters.onDidChange(all), sessions.onDidChange(all)];
  }

  provideFileDecoration(uri: vscode.Uri, _token: vscode.CancellationToken): vscode.FileDecoration | undefined {
    const state = this.sessions.current();
    if (uri.scheme !== TREE_SCHEME || state.status !== 'ready') return undefined;
    const at = resourceAtTreePath(uri.path, state.spec.catalog);
    if (!at) return undefined;
    const cluster = this.clusters.current();
    const parents = scopeOf(at.kind) === 'cluster' ? [cluster ?? '', ...at.parents] : at.parents;
    const entry = this.sync.entryFor(at.kind.kind, parents, at.name);
    if (!entry) return DIMMED;
    const look = LOCAL_LOOKS[entry.drift ?? entry.status];
    if (!look) return undefined;
    const decoration = new vscode.FileDecoration(look.badge, look.tooltip, new vscode.ThemeColor(look.color));
    decoration.propagate = true;
    return decoration;
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.changed.dispose();
  }
}
