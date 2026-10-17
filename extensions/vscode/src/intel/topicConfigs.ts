import * as vscode from 'vscode';
import {
  applyPreset,
  configChoices,
  configKeySnippet,
  configMarkdown,
  configValueYaml,
  presetFromTemplate,
  topicConfig,
  topicConfigProblems,
  topicConfigContext,
  TOPIC_CONFIGS,
  TOPIC_PRESETS,
  type TopicConfigDoc,
  type TopicPreset,
  documentAt,
  parsedDocuments,
  type ParsedDocument,
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { Names } from './names';

export const APPLY_PRESET = 'conduktor.applyTopicPreset';

export class TopicConfigProvider implements vscode.CompletionItemProvider, vscode.HoverProvider {
  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {}

  async provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.CompletionItem[]> {
    const found = this.topicAt(document, position);
    if (!found) return [];
    const { parsed, context } = found;
    const range = new vscode.Range(
      document.positionAt(parsed.start + context.start),
      document.positionAt(parsed.start + context.end),
    );
    switch (context.where) {
      case 'configKey':
        return TOPIC_CONFIGS.filter((config) => !context.present.includes(config.key)).map((config) => {
          const item = new vscode.CompletionItem(config.key, vscode.CompletionItemKind.Property);
          item.detail = [config.type, config.default !== undefined && `default ${config.default}`]
            .filter(Boolean)
            .join(' · ');
          item.documentation = docs(config);
          item.insertText = new vscode.SnippetString(configKeySnippet(config, { choices: true }));
          item.range = range;
          return item;
        });
      case 'configValue': {
        const config = topicConfig(context.key);
        const values = [
          ...new Set([...(configChoices(config) ?? []), ...(config?.default !== undefined ? [config.default] : [])]),
        ];
        return values.map((value) => {
          const item = new vscode.CompletionItem(value, vscode.CompletionItemKind.Value);
          if (value === config?.default) item.detail = 'default';
          item.insertText = configValueYaml(context.key, value);
          if (document.getText(range).startsWith('"')) item.filterText = item.insertText;
          item.range = range;
          return item;
        });
      }
      case 'specKey':
        return (await this.presets()).map((preset, i) => {
          const item = new vscode.CompletionItem(`Preset: ${preset.label}`, vscode.CompletionItemKind.Snippet);
          item.detail = preset.detail;
          item.insertText = '';
          item.range = range;
          item.sortText = `0${i}`;
          item.command = {
            title: 'Apply preset',
            command: APPLY_PRESET,
            arguments: [document.uri, parsed.start, preset],
          };
          return item;
        });
      default:
        return [];
    }
  }

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const found = this.topicAt(document, position);
    if (found?.context.where !== 'configKeyName') return undefined;
    const config = topicConfig(found.context.key);
    if (!config) return undefined;
    const { parsed, context } = found;
    return new vscode.Hover(
      docs(config),
      new vscode.Range(
        document.positionAt(parsed.start + context.start),
        document.positionAt(parsed.start + context.end),
      ),
    );
  }

  private topicAt(document: vscode.TextDocument, position: vscode.Position) {
    const state = this.sessions.current();
    if (state.status !== 'ready') return undefined;
    const offset = document.offsetAt(position);
    const parsed = documentAt(document.getText(), offset, state.spec.catalog);
    if (parsed?.resource?.kind !== 'Topic') return undefined;
    const context = topicConfigContext(parsed.text, offset - parsed.start);
    return context && { parsed, context };
  }

  private async presets(): Promise<TopicPreset[]> {
    const templates = (await this.names.resources('TopicTemplate', [])) ?? [];
    return [...TOPIC_PRESETS, ...templates.flatMap((template) => presetFromTemplate(template) ?? [])];
  }
}

export async function applyTopicPreset(uri: vscode.Uri, start: number, preset: TopicPreset, sessions: SessionManager) {
  const state = sessions.current();
  if (state.status !== 'ready') return;
  const document = await vscode.workspace.openTextDocument(uri);
  const parsed = parsedDocuments(document.getText(), state.spec.catalog).find((d) => d.start === start);
  if (!parsed) return;
  const edit = new vscode.WorkspaceEdit();
  const range = new vscode.Range(
    document.positionAt(parsed.start),
    document.positionAt(parsed.start + parsed.text.length),
  );
  edit.replace(uri, range, applyPreset(parsed.text, preset));
  await vscode.workspace.applyEdit(edit);
}

/** Problems for a Topic's configs: unknown keys (warnings) and values Kafka would refuse (errors). */
export class TopicConfigDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('conduktor-topic-configs');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners: vscode.Disposable[];

  constructor(private readonly sessions: SessionManager) {
    const all = () => vscode.workspace.textDocuments.forEach((d) => this.schedule(d));
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
      vscode.workspace.onDidChangeTextDocument((e) => this.schedule(e.document)),
      vscode.workspace.onDidCloseTextDocument((d) => {
        this.collection.delete(d.uri);
        this.timers.delete(d.uri.toString());
      }),
      sessions.onDidChange(all),
    ];
    all();
  }

  private schedule(document: vscode.TextDocument): void {
    if (document.languageId !== 'yaml') return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => this.check(document), 300),
    );
  }

  private check(document: vscode.TextDocument): void {
    const state = this.sessions.current();
    if (state.status !== 'ready' || document.isClosed) return;
    const diagnostics = parsedDocuments(document.getText(), state.spec.catalog)
      .filter((parsed) => parsed.resource?.kind === 'Topic')
      .flatMap((parsed) => problems(parsed, document));
    this.collection.set(document.uri, diagnostics);
  }

  dispose(): void {
    for (const l of this.listeners) l.dispose();
    this.timers.forEach((t) => clearTimeout(t));
    this.collection.dispose();
  }
}

function problems(parsed: ParsedDocument, document: vscode.TextDocument): vscode.Diagnostic[] {
  return topicConfigProblems(parsed.text, parsed.resource).map(({ start, end, message, severity }) => {
    const diagnostic = new vscode.Diagnostic(
      new vscode.Range(document.positionAt(parsed.start + start), document.positionAt(parsed.start + end)),
      message,
      severity === 'error' ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning,
    );
    diagnostic.source = 'Conduktor';
    return diagnostic;
  });
}

function docs(config: TopicConfigDoc): vscode.MarkdownString {
  return new vscode.MarkdownString(configMarkdown(config));
}
