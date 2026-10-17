import {
  applyPreset,
  configChoices,
  configKeySnippet,
  configMarkdown,
  configValueYaml,
  documentAt,
  parsedDocuments,
  topicConfig,
  topicConfigContext,
  topicConfigProblems,
  TOPIC_CONFIGS,
  type KindCatalog,
  type TopicPreset,
} from '@conduktor/core';
import {
  CompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  type CodeAction,
  type CompletionList,
  type Diagnostic,
  type Hover,
  type Position,
  type Range,
  type TextEdit,
} from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { valueEdit } from './completions';
import { withFixes } from './editing';

export const APPLY_PRESET = 'conduktor.applyTopicPreset';

/** Under a Topic's `spec.configs`: every Kafka topic config not set yet, or the values the one being written takes. */
export function topicConfigCompletions(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
): CompletionList | undefined {
  const found = topicAt(document, position, catalog);
  if (!found) return undefined;
  const { parsed, context } = found;
  const start = parsed.start + context.start;
  const range = rangeOf(document, start, parsed.start + context.end);
  if (context.where === 'configKey') {
    return {
      isIncomplete: false,
      items: TOPIC_CONFIGS.filter((config) => !context.present.includes(config.key)).map((config) => ({
        label: config.key,
        kind: CompletionItemKind.Property,
        detail: [config.type, config.default !== undefined && `default ${config.default}`].filter(Boolean).join(' · '),
        documentation: { kind: MarkupKind.Markdown, value: configMarkdown(config) },
        insertTextFormat: InsertTextFormat.Snippet,
        // Zed does not show snippet choices: the default stands in, and the values come once the value is typed.
        textEdit: { range, newText: configKeySnippet(config, { choices: false }) },
      })),
    };
  }
  if (context.where === 'configValue') {
    const config = topicConfig(context.key);
    const values = [
      ...new Set([...(configChoices(config) ?? []), ...(config?.default !== undefined ? [config.default] : [])]),
    ];
    const quoted = document.getText(range).startsWith('"');
    const edit = valueEdit(document, start, parsed.start + context.end);
    return {
      isIncomplete: false,
      items: values.map((value) => {
        const yaml = configValueYaml(context.key, value);
        return {
          label: value,
          kind: CompletionItemKind.Value,
          ...(value === config?.default && { detail: 'default' }),
          ...(quoted && { filterText: yaml }),
          textEdit: edit(yaml),
        };
      }),
    };
  }
  return undefined;
}

/** A config's docs, on its key. */
export function topicConfigHover(document: TextDocument, position: Position, catalog: KindCatalog): Hover | undefined {
  const found = topicAt(document, position, catalog);
  if (found?.context.where !== 'configKeyName') return undefined;
  const config = topicConfig(found.context.key);
  if (!config) return undefined;
  const { parsed, context } = found;
  return {
    contents: { kind: MarkupKind.Markdown, value: configMarkdown(config) },
    range: rangeOf(document, parsed.start + context.start, parsed.start + context.end),
  };
}

/** Unknown config keys (warnings, on the key) and values Kafka would refuse (errors, on the value), with their fixes. */
export function topicConfigDiagnostics(document: TextDocument, catalog: KindCatalog): Diagnostic[] {
  return parsedDocuments(document.getText(), catalog)
    .filter((parsed) => parsed.resource?.kind === 'Topic')
    .flatMap((parsed) =>
      topicConfigProblems(parsed.text, parsed.resource).map(({ start, end, message, severity, fixes }) =>
        withFixes(
          {
            range: rangeOf(document, parsed.start + start, parsed.start + end),
            message,
            severity: severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
            source: 'Conduktor',
          },
          document,
          parsed.start,
          fixes,
        ),
      ),
    );
}

/** A preset per code action on a Topic: partitions, replication and configs set in one go. */
export function presetActions(
  document: TextDocument,
  range: Range,
  catalog: KindCatalog,
  presets: readonly TopicPreset[],
): CodeAction[] {
  const parsed = documentAt(document.getText(), document.offsetAt(range.start), catalog);
  if (parsed?.resource?.kind !== 'Topic') return [];
  return presets.map((preset) => {
    const title = `Preset: ${preset.label}`;
    return { title, command: { title, command: APPLY_PRESET, arguments: [document.uri, parsed.start, preset.id] } };
  });
}

/** The Topic starting at `start`, rewritten with the preset. */
export function presetEdit(
  document: TextDocument,
  start: number,
  preset: TopicPreset,
  catalog: KindCatalog,
): TextEdit | undefined {
  const parsed = parsedDocuments(document.getText(), catalog).find((d) => d.start === start);
  if (!parsed) return undefined;
  return {
    range: rangeOf(document, parsed.start, parsed.start + parsed.text.length),
    newText: applyPreset(parsed.text, preset),
  };
}

function topicAt(document: TextDocument, position: Position, catalog: KindCatalog) {
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, catalog);
  if (parsed?.resource?.kind !== 'Topic') return undefined;
  const context = topicConfigContext(parsed.text, offset - parsed.start);
  return context && { parsed, context };
}

function rangeOf(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}
