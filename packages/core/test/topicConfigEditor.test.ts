import { describe, expect, it } from 'vitest';
import { topicConfig } from '../src/topicConfigs/lookup';
import { configChoices } from '../src/topicConfigs/check';
import { configKeySnippet, configMarkdown, topicConfigProblems } from '../src/topicConfigs/editor';

describe('the topic config editor helpers', () => {
  it('read the values a config lists, and none for a range', () => {
    expect(configChoices(topicConfig('cleanup.policy'))).toEqual(['compact', 'delete']);
    expect(configChoices(topicConfig('retention.ms'))).toBeUndefined();
  });

  it('write a config as a snippet, quoted as the Console needs, with or without a choice', () => {
    expect(configKeySnippet(topicConfig('cleanup.policy')!, { choices: true })).toBe(
      'cleanup.policy: "${1|compact,delete|}"',
    );
    expect(configKeySnippet(topicConfig('cleanup.policy')!, { choices: false })).toBe('cleanup.policy: "${1:delete}"');
    expect(configKeySnippet(topicConfig('segment.ms')!, { choices: false })).toBe('segment.ms: ${1:604800000}');
  });

  it('document a config with its default and a link', () => {
    const markdown = configMarkdown(topicConfig('retention.ms')!);
    expect(markdown).toMatch(/^\*\*retention\.ms\*\*/);
    expect(markdown).toMatch(/\*\*Default\*\* `604800000`/);
    expect(markdown).toMatch(/\[Docs\]\(https:/);
  });

  it('mark an unknown key on the key and a refused value on the value', () => {
    const text = 'spec:\n  configs:\n    retention.mss: "1"\n    cleanup.policy: "sometimes"\n';
    const resource = { spec: { configs: { 'retention.mss': '1', 'cleanup.policy': 'sometimes' } } };
    const problems = topicConfigProblems(text, resource).map((p) => [p.severity, text.slice(p.start, p.end)]);
    expect(problems).toEqual([
      ['warning', 'retention.mss'],
      ['error', '"sometimes"'],
    ]);
  });
});
