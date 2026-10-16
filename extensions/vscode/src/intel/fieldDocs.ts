import * as vscode from 'vscode';
import {
  fieldAt,
  fieldDocs,
  kindDoc,
  kindSchema,
  REFERENCE_URL,
  referenceAt,
  schemaAt,
  type KindVersion,
  type Resource,
  type YamlPath,
  documentAt,
} from '@conduktor/core';
import type { SessionManager, SessionState } from '../connections/session';
import type { ExplorerProvider } from '../explorer/explorerProvider';
import type { SyncFolder } from '../sync/syncFolder';
import type { Names } from './names';
import { referenceTarget } from './referenceProviders';

type Ready = Extract<SessionState, { status: 'ready' }>;

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
    const kind = state.spec.catalog.resolve(resource.apiVersion, resource.kind);
    const text =
      at.path.length === 1 && at.path[0] === 'kind'
        ? kindSummary(resource.kind)
        : await this.field(state, kind, resource, at.path);
    const markdown = new vscode.MarkdownString(text);
    markdown.isTrusted = { enabledCommands: ['vscode.open'] };
    return new vscode.Hover(
      markdown,
      new vscode.Range(document.positionAt(parsed.start + at.start), document.positionAt(parsed.start + at.end)),
    );
  }

  private async field(
    state: Ready,
    kind: KindVersion | undefined,
    resource: Resource,
    path: YamlPath,
  ): Promise<string> {
    const schema = kind?.bodySchema
      ? schemaAt(kindSchema(state.spec.schema, kind as KindVersion & { bodySchema: string }), resource, path)
      : undefined;
    const docs = fieldDocs(resource.kind, path);
    const sections = new Set(docs.map((doc) => doc.url));
    const parts = [
      [`**${code(dotted(path))}**`, schema?.type, schema?.required && 'required'].filter(Boolean).join(' · '),
      // The docs can describe a field once per variant, each in its own section: say which is which.
      ...docs.map((doc) => (sections.size > 1 ? `[${doc.section}](${doc.url}): ${doc.text}` : doc.text)),
    ];
    if (schema?.default !== undefined) parts.push(`Default ${code(JSON.stringify(schema.default))}`);
    const reference = referenceAt(resource, state.spec.catalog, path);
    if (reference && reference.value !== '' && !reference.pattern && !reference.wildcard) {
      const target = await referenceTarget(state, this.sync, this.names, this.explorer, reference);
      const named = `References ${reference.kind} ${code(reference.value)}`;
      if (target) {
        const open = `command:vscode.open?${encodeURIComponent(JSON.stringify([target.uri]))}`;
        parts.push(
          `${named}: [open it ${target.where === 'repository' ? 'in the repository' : 'in the Console'}](${open})`,
        );
      } else if (reference.parents && (await this.names.lookup(reference.kind, reference.parents)).checked) {
        // Only a Console that answered can say a name is missing; without parents it was never asked.
        parts.push(`${named}: not found in the repository or the Console`);
      }
    }
    const section = sections.size === 1 ? docs[0]!.url : undefined;
    parts.push(`[Docs](${section ?? kindDoc(resource.kind)?.url ?? REFERENCE_URL})`);
    return parts.join('\n\n');
  }
}

function kindSummary(kind: string): string {
  const doc = kindDoc(kind);
  if (!doc) return `**${kind}**\n\n[Docs](${REFERENCE_URL})`;
  return [`**${kind}** — ${doc.summary}`, doc.facts.join(' · '), `[Docs](${doc.url})`].filter(Boolean).join('\n\n');
}

// A code span fenced longer than any backtick run inside it, so a value from the file cannot end it and add markdown
// (the hover is trusted to run vscode.open).
function code(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function dotted(path: YamlPath): string {
  return path
    .map((segment, i) => (typeof segment === 'number' ? `[${segment}]` : i === 0 ? segment : `.${segment}`))
    .join('');
}
