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
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { conduktorDiagnostic, debouncedDiagnostics, rangeIn } from './diagnostics';
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
    const { parsed, context, range } = found;
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
    return config && new vscode.Hover(docs(config), found.range);
  }

  private topicAt(document: vscode.TextDocument, position: vscode.Position) {
    const state = this.sessions.current();
    if (state.status !== 'ready') return undefined;
    const offset = document.offsetAt(position);
    const parsed = documentAt(document.getText(), offset, state.spec.catalog);
    if (parsed?.resource?.kind !== 'Topic') return undefined;
    const context = topicConfigContext(parsed.text, offset - parsed.start);
    return context && { parsed, context, range: rangeIn(document, parsed, context.start, context.end) };
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
  edit.replace(uri, rangeIn(document, parsed, 0, parsed.text.length), applyPreset(parsed.text, preset));
  await vscode.workspace.applyEdit(edit);
}

/** Problems for a Topic's configs: unknown keys (warnings) and values Kafka would refuse (errors). */
export function topicConfigDiagnostics(sessions: SessionManager): vscode.Disposable {
  const check = (document: vscode.TextDocument, collection: vscode.DiagnosticCollection) => {
    const state = sessions.current();
    if (state.status !== 'ready' || document.isClosed) return;
    const diagnostics = parsedDocuments(document.getText(), state.spec.catalog)
      .filter((parsed) => parsed.resource?.kind === 'Topic')
      .flatMap((parsed) =>
        topicConfigProblems(parsed.text, parsed.resource).map(({ start, end, message, severity }) =>
          conduktorDiagnostic(rangeIn(document, parsed, start, end), message, severity),
        ),
      );
    collection.set(document.uri, diagnostics);
  };
  return debouncedDiagnostics('conduktor-topic-configs', check, { recheckAllOn: [sessions.onDidChange] });
}

function docs(config: TopicConfigDoc): vscode.MarkdownString {
  return new vscode.MarkdownString(configMarkdown(config));
}
