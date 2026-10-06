import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import { isLiveScheme, parseLiveUriParts } from '../liveFs/uris';
import type { SyncFolder } from '../sync/syncFolder';
import type { ClusterSelection } from './clusterSelection';
import { scopeOf, type ExplorerNode, type ResourceNode } from './explorerModel';
import type { ExplorerProvider } from './explorerProvider';

export const AUTO_REVEAL = 'conduktor.explorer.autoReveal';

/** The tree node for a document: a live resource of this connection, or a file the sync folder tracks. */
function nodeFor(uri: vscode.Uri, sessions: SessionManager, sync: SyncFolder): ResourceNode | undefined {
  const state = sessions.current();
  if (state.status !== 'ready') return undefined;
  if (isLiveScheme(uri.scheme)) {
    const ref = parseLiveUriParts(uri.authority, uri.path);
    const kind =
      ref && ref.connectionId === state.connection.id && state.spec.catalog.resolve(`v${ref.version}`, ref.kind);
    return kind ? { type: 'resource', kind, parents: ref.parents, name: ref.name } : undefined;
  }
  const entry = sync.entryAt(uri);
  const kind = entry && state.spec.catalog.resolve(entry.apiVersion, entry.kind);
  if (!entry || !kind) return undefined;
  const local = { status: entry.status, drift: entry.drift, uri: entry.uri.toString() };
  return { type: 'resource', kind, parents: entry.parents, name: entry.name, local };
}

export class Reveal implements vscode.Disposable {
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly view: vscode.TreeView<ExplorerNode>,
    private readonly explorer: ExplorerProvider,
    private readonly clusters: ClusterSelection,
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
  ) {
    this.listeners = [
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && vscode.workspace.getConfiguration().get<boolean>(AUTO_REVEAL))
          void this.follow(editor.document.uri);
      }),
    ];
  }

  /** Reveal in Conduktor Explorer: shows the view, and selects the resource's cluster when it lives in another. */
  async reveal(uri: vscode.Uri): Promise<void> {
    const node = nodeFor(uri, this.sessions, this.sync);
    if (!node) {
      void vscode.window.showInformationMessage('This file is not a resource of the current connection.');
      return;
    }
    if (scopeOf(node.kind) === 'cluster' && node.parents[0] !== this.clusters.current())
      await this.clusters.set(node.parents[0]);
    if (!this.explorer.shows(node)) {
      void vscode.window.showInformationMessage('Show Only Changes hides it; Show All to see it in the Explorer.');
      return;
    }
    await this.view.reveal(node, { select: true, focus: true, expand: false });
  }

  // Following the editor never changes the tree's cluster or filter, nor opens the view: like the file explorer's
  // auto reveal, it only selects what the tree already shows.
  private async follow(uri: vscode.Uri): Promise<void> {
    const node = this.view.visible ? nodeFor(uri, this.sessions, this.sync) : undefined;
    if (node && this.explorer.shows(node)) await this.view.reveal(node, { select: true, focus: false, expand: false });
  }

  dispose(): void {
    this.listeners.forEach((listener) => listener.dispose());
  }
}
