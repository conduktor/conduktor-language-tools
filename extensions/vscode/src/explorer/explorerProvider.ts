import * as vscode from 'vscode';
import { LOCAL_LOOKS, treeUriOf } from './decorations';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { ClusterSelection } from './clusterSelection';
import { toLiveUriParts } from '../liveFs/uris';
import { childrenOf, idOf, parentOf, shownInTree, type ExplorerNode, type ResourceNode } from './explorerModel';

const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;

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
    return vscode.Uri.from(
      toLiveUriParts(
        {
          connectionId: state.connection.id,
          kind: node.kind.kind,
          version: node.kind.version,
          parents: node.parents,
          name: node.name,
        },
        { editable: true },
      ),
    );
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    const treeItem = this.itemFor(node);
    const id = idOf(node);
    if (id) treeItem.id = id;
    // Decorations colour labels by this URI, and roll a resource's state up its path to the kind and cluster.
    const resourceUri = treeUriOf(node);
    if (resourceUri) treeItem.resourceUri = resourceUri;
    // Without one, a tree item with a resourceUri hovers with that URI's path.
    treeItem.tooltip ??= [treeItem.label, treeItem.description].filter((part) => typeof part === 'string').join(' ');
    return treeItem;
  }

  getParent(node: ExplorerNode): ExplorerNode | undefined {
    return parentOf(node, this.clusters.current());
  }

  /** Whether the tree shows this resource, now or once the given cluster is selected. */
  shows(node: ResourceNode, cluster = this.clusters.current()): boolean {
    const state = this.sessions.current();
    return state.status === 'ready' && shownInTree(state.spec.catalog, cluster, this.onlyChanges, node);
  }

  private itemFor(node: ExplorerNode): vscode.TreeItem {
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
        return item(node.group, Collapsed, 'library', 'group');
      case 'kind': {
        const treeItem = item(node.kind.kind, Collapsed, 'symbol-class', 'kind');
        treeItem.description = `v${node.kind.version}`;
        return treeItem;
      }
      case 'parent':
        return item(node.parents.at(-1) ?? '', Collapsed, 'server', 'parent');
      case 'resource': {
        const look = node.local && LOCAL_LOOKS[node.local.drift ?? node.local.status];
        const icon = !node.local ? 'cloud' : node.local.status === 'new' ? 'file-code' : 'check';
        const treeItem = item(node.name, None, icon, node.local ? `resource.${node.local.status}` : 'resource');
        const target = node.local ? vscode.Uri.parse(node.local.uri) : this.liveUri(node);
        treeItem.command = { command: 'vscode.open', title: 'Open', arguments: [target] };
        treeItem.tooltip = [
          `${node.kind.kind} ${[...node.parents, node.name].join(' / ')}`,
          look?.tooltip,
          node.local ? 'Opens the local file' : 'Only in the Console',
        ]
          .filter(Boolean)
          .join('\n');
        return treeItem;
      }
      case 'message': {
        const treeItem = item(node.text, None, node.problem ? PROBLEM_ICON[node.problem] : 'info', 'message');
        treeItem.tooltip = node.detail;
        if (node.selectCluster) treeItem.command = { command: 'conduktor.selectCluster', title: 'Select Cluster' };
        return treeItem;
      }
    }
  }

  dispose(): void {
    for (const listener of this.listeners) listener.dispose();
    this.changed.dispose();
  }
}

const PROBLEM_ICON = { noAccess: 'circle-slash', unavailable: 'dash', failed: 'warning' } as const;

function item(label: string, state: vscode.TreeItemCollapsibleState, icon: string, contextValue: string) {
  const treeItem = new vscode.TreeItem(label, state);
  treeItem.iconPath = new vscode.ThemeIcon(icon);
  treeItem.contextValue = contextValue;
  return treeItem;
}
