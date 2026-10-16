import * as vscode from 'vscode';
import {
  blankDocumentAt,
  catalogDocuments,
  parseResourceDocuments,
  resourceSnippets,
  type KindCatalog,
} from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { ClusterSelection } from '../explorer/clusterSelection';
import type { SyncFolder } from '../sync/syncFolder';
import type { Names } from './names';

export class SnippetCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
    private readonly clusters: ClusterSelection,
    private readonly sync: SyncFolder,
  ) {}

  // A Kubernetes, Argo or Helm file is left alone, as the schema is: snippets go where Console resources live.
  private isConduktorFile(document: vscode.TextDocument, text: string, catalog: KindCatalog): boolean {
    const all = parseResourceDocuments(text);
    const console = catalogDocuments(text, catalog);
    if (all.length > console.length) return false;
    return document.isUntitled || this.sync.contains(document.uri) || console.length > 0;
  }

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const text = document.getText();
    const blank = blankDocumentAt(text, document.offsetAt(position));
    if (!blank || !this.isConduktorFile(document, text, state.spec.catalog)) return [];
    const range = new vscode.Range(document.positionAt(blank.start), document.positionAt(blank.end));
    const selected = this.clusters.current();
    const known = (await this.names.lookup('KafkaCluster', [])).names.map((n) => n.name);
    const clusters = selected ? [selected, ...known.filter((c) => c !== selected)] : known;
    return resourceSnippets(state.spec.catalog, state.spec.schema, clusters).map(
      ({ kind, variant, snippet, detail }) => {
        const item = new vscode.CompletionItem(
          `Conduktor: ${kind}${variant ? ` (${variant})` : ''}`,
          vscode.CompletionItemKind.Snippet,
        );
        item.insertText = new vscode.SnippetString(snippet);
        item.filterText = `${kind} ${variant ?? ''} conduktor`;
        item.detail = detail;
        item.range = range;
        return item;
      },
    );
  }
}
