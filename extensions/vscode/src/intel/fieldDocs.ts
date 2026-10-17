import * as vscode from 'vscode';
import {
  documentAt,
  fieldAt,
  fieldHover,
  kindHover,
  markdownCode,
  referenceAt,
  type Resource,
  type YamlPath,
} from '@conduktor/core';
import type { Ready, SessionManager } from '../connections/session';
import type { ExplorerProvider } from '../explorer/explorerProvider';
import type { SyncFolder } from '../sync/syncFolder';
import type { Names } from './names';
import { referenceTarget } from './referenceProviders';

/** What a field of a Console resource is: its docs, its schema, where a reference points, and a link to the docs. */
export class FieldDocsHover implements vscode.HoverProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly sync: SyncFolder,
    private readonly names: Names,
    private readonly explorer: ExplorerProvider,
  ) {}

  async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | undefined> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return undefined;
    const offset = document.offsetAt(position);
    const parsed = documentAt(document.getText(), offset, state.spec.catalog);
    const resource = parsed?.resource;
    const at = parsed && fieldAt(parsed.text, offset - parsed.start);
    if (!resource || !at) return undefined;
    // A Topic's configs have the Kafka topic config hover.
    if (resource.kind === 'Topic' && at.path[0] === 'spec' && at.path[1] === 'configs' && at.path.length > 2)
      return undefined;
    const text =
      at.path.length === 1 && at.path[0] === 'kind'
        ? kindHover(resource.kind)
        : await this.field(state, resource, at.path);
    const markdown = new vscode.MarkdownString(text);
    markdown.isTrusted = { enabledCommands: ['vscode.open'] };
    return new vscode.Hover(
      markdown,
      new vscode.Range(document.positionAt(parsed.start + at.start), document.positionAt(parsed.start + at.end)),
    );
  }

  private async field(state: Ready, resource: Resource, path: YamlPath): Promise<string> {
    const reference = referenceAt(resource, state.spec.catalog, path);
    let line: string | undefined;
    if (reference && reference.value !== '' && !reference.pattern && !reference.wildcard) {
      const target = await referenceTarget(state, this.sync, this.names, this.explorer, reference);
      const named = `References ${reference.kind} ${markdownCode(reference.value)}`;
      if (target) {
        const open = `command:vscode.open?${encodeURIComponent(JSON.stringify([target.uri]))}`;
        line = `${named}: [open it ${target.where === 'repository' ? 'in the repository' : 'in the Console'}](${open})`;
      } else if (reference.parents && (await this.names.lookup(reference.kind, reference.parents)).checked) {
        // Only a Console that answered can say a name is missing; without parents it was never asked.
        line = `${named}: not found in the repository or the Console`;
      }
    }
    return fieldHover(state.spec.schema, state.spec.catalog, resource, path, line);
  }
}
