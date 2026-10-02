import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import { toLiveUriParts } from '../liveFs/uris';
import { childrenOf, type ExplorerNode, type ResourceNode } from './explorerModel';

const { Collapsed, None } = vscode.TreeItemCollapsibleState;

export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly sessionListener: vscode.Disposable;

  constructor(private readonly sessions: SessionManager) {
    this.sessionListener = sessions.onDidChange(() => this.refresh());
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
        return childrenOf({ catalog: state.spec.catalog, client: state.client }, node);
    }
  }

  liveUri(node: ResourceNode): vscode.Uri {
    const state = this.sessions.current();
    if (state.status !== 'ready') throw new Error('Not connected');
    return vscode.Uri.from(
      toLiveUriParts({
        connectionId: state.connection.id,
        kind: node.kind.kind,
        version: node.kind.version,
        parents: node.parents,
        name: node.name,
      }),
    );
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    switch (node.type) {
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
        const treeItem = item(node.name, None, 'file-code', 'resource');
        treeItem.command = { command: 'vscode.open', title: 'Open', arguments: [this.liveUri(node)] };
        treeItem.tooltip = `${node.kind.kind} ${[...node.parents, node.name].join(' / ')}`;
        return treeItem;
      }
      case 'message': {
        const treeItem = item(node.text, None, node.noAccess ? 'circle-slash' : 'info', 'message');
        treeItem.tooltip = node.detail;
        return treeItem;
      }
    }
  }

  dispose(): void {
    this.sessionListener.dispose();
    this.changed.dispose();
  }
}

function item(label: string, state: vscode.TreeItemCollapsibleState, icon: string, contextValue: string) {
  const treeItem = new vscode.TreeItem(label, state);
  treeItem.iconPath = new vscode.ThemeIcon(icon);
  treeItem.contextValue = contextValue;
  return treeItem;
}
