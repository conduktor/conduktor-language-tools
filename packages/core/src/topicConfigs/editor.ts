import { closest, type Fix } from '../fixes';
import { rangeOf } from '../resources/yamlPaths';
import { snippetText } from '../templates/snippet';
import { isRecord } from '../util';
import { checkTopicConfig, configChoices } from './check';
import type { TopicConfigDoc } from './kafkaDocs';
import { configValueYaml, TOPIC_CONFIGS } from './lookup';

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
  fixes: Fix[];
}

const KEYS = TOPIC_CONFIGS.map((config) => config.key);

/**
 * What is wrong with a Topic's configs: unknown keys (warnings), with the closest known ones, and values Kafka would
 * refuse (errors), with the values it takes or the quotes Console needs.
 */
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
    const fix = (title: string, newText: string): Fix => ({ title, edit: { start, end, newText } });
    const fixes =
      problem.severity === 'warning'
        ? closest(key, KEYS).map((near) => fix(`Change to '${near}'`, near))
        : (problem.replacements ?? []).map((replacement) => {
            const yaml = configValueYaml(key, replacement);
            return fix(replacement === String(value) ? `Quote it: ${yaml}` : `Change to '${replacement}'`, yaml);
          });
    return [{ start, end, message: problem.message, severity: problem.severity, fixes }];
  });
}
