import * as vscode from 'vscode';
import {
  blankDocumentAt,
  kindSchema,
  newResourceName,
  skeletonYaml,
  snippetOf,
  snippetVariants,
  type KindVersion,
} from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { ClusterSelection } from '../explorer/clusterSelection';
import type { Names } from './names';

export class SnippetCompletionProvider implements vscode.CompletionItemProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
    private readonly clusters: ClusterSelection,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return [];
    const blank = blankDocumentAt(document.getText(), document.offsetAt(position));
    if (!blank) return [];
    const range = new vscode.Range(document.positionAt(blank.start), document.positionAt(blank.end));
    const selected = this.clusters.current();
    const known = (await this.names.lookup('KafkaCluster', [])).names.map((n) => n.name);
    const clusters = selected ? [selected, ...known.filter((c) => c !== selected)] : known;
    const items: vscode.CompletionItem[] = [];
    for (const name of state.spec.catalog.kindNames()) {
      const kind = state.spec.catalog.latest(name)!;
      if (!kind.bodySchema) continue;
      const root = kindSchema(state.spec.schema, kind as KindVersion & { bodySchema: string });
      const inCluster = kind.parentPathParams.includes('cluster');
      const parents = Object.fromEntries(
        kind.parentPathParams.map((param) => [param, param === 'cluster' ? (clusters[0] ?? '') : '']),
      );
      const choices: Record<string, string[]> =
        inCluster && clusters.length > 0 ? { 'metadata.cluster': clusters } : {};
      for (const { label, answers } of snippetVariants(root)) {
        const text = skeletonYaml(root, kind, parents, newResourceName(kind), answers);
        const item = new vscode.CompletionItem(
          `Conduktor: ${name}${label ? ` (${label})` : ''}`,
          vscode.CompletionItemKind.Snippet,
        );
        item.insertText = new vscode.SnippetString(snippetOf(text, choices));
        item.filterText = `${name} ${label ?? ''} conduktor`;
        item.detail = `${kind.group} · v${kind.version}`;
        item.range = range;
        items.push(item);
      }
    }
    return items;
  }
}
