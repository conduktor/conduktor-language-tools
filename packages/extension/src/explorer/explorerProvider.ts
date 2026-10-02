import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { ClusterSelection } from './clusterSelection';
import { toLiveUriParts } from '../liveFs/uris';
import { childrenOf, type ExplorerNode, type LocalMark, type ResourceNode } from './explorerModel';

const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;

const BADGES: Record<string, { label: string; color: string; tooltip: string }> = {
  new: { label: 'A', color: 'gitDecoration.addedResourceForeground', tooltip: 'New locally, not on the Console yet' },
  modified: { label: 'M', color: 'gitDecoration.modifiedResourceForeground', tooltip: 'Changed locally, not applied' },
  changed: {
    label: '⚠',
    color: 'gitDecoration.conflictingResourceForeground',
    tooltip: 'Changed on the Console since it was synced',
  },
  deleted: {
    label: '⚠',
    color: 'gitDecoration.conflictingResourceForeground',
    tooltip: 'Deleted from the Console since it was synced; applying creates it again',
  },
};

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly listeners: vscode.Disposable[];
  private onlyChanges = false;

  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
    private readonly clusters: ClusterSelection,
  ) {
    this.listeners = [
      sessions.onDidChange(() => this.refresh()),
      sync.onDidChange(() => this.refresh()),
      clusters.onDidChange(() => this.refresh()),
    ];
  }

  showOnlyChanges(only: boolean): void {
    this.onlyChanges = only;
    void vscode.commands.executeCommand('setContext', 'conduktor.onlyChanges', only);
    this.refresh();
  }

  refresh(): void {
    this.changed.fire(undefined);
  }

  async getChildren(node?: ExplorerNode): Promise<ExplorerNode[]> {
    const state = this.sessions.current();
    switch (state.status) {
      case 'none':
        return [];
      case 'loading':
        return [{ type: 'message', text: 'Connecting…' }];
      case 'error':
        return [{ type: 'message', text: 'Cannot connect', detail: state.message }];
      case 'ready':
        return childrenOf(
          {
            catalog: state.spec.catalog,
            client: state.client,
            cluster: this.clusters.current(),
            onlyChanges: this.onlyChanges,
            local: this.sync.list().map((entry) => ({
              kind: entry.kind,
              parents: entry.parents,
              name: entry.name,
              mark: { status: entry.status, drift: entry.drift, uri: entry.uri.toString() },
            })),
          },
          node,
        );
    }
  }

  liveUri(node: ResourceNode): vscode.Uri {
    const state = this.sessions.current();
    if (state.status !== 'ready') throw new Error('Not connected');
    const editable = state.connection.mode !== 'read-only';
    return vscode.Uri.from(
      toLiveUriParts(
        {
          connectionId: state.connection.id,
          kind: node.kind.kind,
          version: node.kind.version,
          parents: node.parents,
          name: node.name,
        },
        { editable },
      ),
    );
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    switch (node.type) {
      case 'scope': {
        if (node.scope === 'global') return item('Global', Expanded, 'globe', 'scope.global');
        const treeItem = item(
          node.cluster ? `Cluster ${node.cluster}` : 'Cluster',
          Expanded,
          'server',
          'scope.cluster',
        );
        treeItem.tooltip = 'Resources that live in a Kafka cluster. Select Cluster switches to another one.';
        return treeItem;
      }
      case 'group':
        return item(node.group, Collapsed, 'folder', 'group');
      case 'kind': {
        const treeItem = item(node.kind.kind, Collapsed, 'symbol-class', 'kind');
        treeItem.description = `v${node.kind.version}`;
        return treeItem;
      }
      case 'parent':
        return item(node.parents.at(-1)!, Collapsed, 'server', 'parent');
      case 'resource': {
        const badge = node.local && badgeFor(node.local);
        const treeItem = item(node.name, None, 'file-code', node.local ? `resource.${node.local.status}` : 'resource');
        if (badge) {
          treeItem.iconPath = new vscode.ThemeIcon('file-code', new vscode.ThemeColor(badge.color));
          treeItem.description = badge.label;
        }
        const target = node.local ? vscode.Uri.parse(node.local.uri) : this.liveUri(node);
        treeItem.command = { command: 'vscode.open', title: 'Open', arguments: [target] };
        treeItem.tooltip = [
          `${node.kind.kind} ${[...node.parents, node.name].join(' / ')}`,
          badge?.tooltip,
          node.local && 'Opens the local file',
        ]
          .filter(Boolean)
          .join('\n');
        return treeItem;
      }
      case 'message': {
        const treeItem = item(node.text, None, node.noAccess ? 'circle-slash' : 'info', 'message');
        treeItem.tooltip = node.detail;
        if (node.selectCluster) treeItem.command = { command: 'conduktor.selectCluster', title: 'Select Cluster' };
        return treeItem;
      }
    }
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
    this.changed.dispose();
  }
}

function badgeFor(mark: LocalMark) {
  if (mark.drift) return BADGES[mark.drift];
  return mark.status === 'synced' ? undefined : BADGES[mark.status];
}

function item(label: string, state: vscode.TreeItemCollapsibleState, icon: string, contextValue: string) {
  const treeItem = new vscode.TreeItem(label, state);
  treeItem.iconPath = new vscode.ThemeIcon(icon);
  treeItem.contextValue = contextValue;
  return treeItem;
}
