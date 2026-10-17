import { rangeOf } from '../resources/yamlPaths';
import { isRecord } from '../util';
import { checkTopicConfig } from './check';
import type { TopicConfigDoc } from './kafkaDocs';
import { configValueYaml } from './lookup';

/** The values a config takes when Kafka lists them (`[compact, delete]`), not a range or an open list. */
export function configChoices(config: TopicConfigDoc | undefined): string[] | undefined {
  const [range = ''] = config?.validValues?.split(/\s+or\s+/) ?? [];
  const [, choices] = /^\[([^\]]*)\]$/.exec(range.trim()) ?? [];
  if (choices === undefined || choices.includes('...')) return undefined;
  return choices.split(',').map((value) => value.trim());
}

/** A config's docs, as Markdown: what it does, its type, default, valid values and importance, and a link. */
export function configMarkdown(config: TopicConfigDoc): string {
  const facts = [
    `**Type** ${config.type}`,
    config.default !== undefined &&
      `**Default** \`${config.default}\`${config.defaultNote ? ` (${config.defaultNote})` : ''}`,
    config.validValues && `**Valid values** \`${config.validValues}\``,
    config.importance && `**Importance** ${config.importance}`,
  ].filter(Boolean);
  return `**${config.key}**\n\n${config.doc}\n\n${facts.join(' · ')}\n\n[Docs](${config.url})`;
}

/**
 * A config as a snippet, its default as the placeholder — inside the quotes Console needs for anything but a whole
 * number. With `choices`, a config that lists its values offers them as a snippet choice; clients that cannot show one
 * get the default (or the first value) instead.
 */
export function configKeySnippet(config: TopicConfigDoc, options: { choices: boolean }): string {
  const choices = configChoices(config);
  const quoted = choices !== undefined || configValueYaml(config.key, config.default ?? '') !== config.default;
  const placeholder =
    choices && options.choices
      ? `\${1|${choices.join(',')}|}`
      : `\${1:${snippetText(config.default ?? choices?.[0] ?? '')}}`;
  return `${config.key}: ${quoted ? `"${placeholder}"` : placeholder}`;
}

export interface TopicConfigRangeProblem {
  /** Offsets in the document's text: the key for an unknown config, the value for one Kafka would refuse. */
  start: number;
  end: number;
  message: string;
  severity: 'error' | 'warning';
}

/** What is wrong with a Topic's configs: unknown keys (warnings) and values Kafka would refuse (errors). */
export function topicConfigProblems(text: string, resource: unknown): TopicConfigRangeProblem[] {
  const spec = isRecord(resource) && isRecord(resource.spec) ? resource.spec : {};
  const configs = isRecord(spec.configs) ? spec.configs : {};
  return Object.entries(configs).flatMap(([key, value]) => {
    const problem = checkTopicConfig(key, value);
    const range = rangeOf(text, ['spec', 'configs', key]);
    if (!problem || !range) return [];
    const lineStart = text.lastIndexOf('\n', range[0]) + 1;
    const line = text.slice(lineStart);
    const keyStart = lineStart + line.length - line.trimStart().length;
    const [start, end] = problem.severity === 'warning' ? [keyStart, keyStart + key.length] : range;
    return [{ start, end, message: problem.message, severity: problem.severity }];
  });
}

function snippetText(text: string): string {
  return text.replace(/[$}\\]/g, '\\$&');
}
