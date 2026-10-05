import { describe, expect, it } from 'vitest';
import { topicConfigContext } from '../src/topicConfigs';

const text = `apiVersion: v2
kind: Topic
metadata: { name: t, cluster: c }
spec:
  partitions: 1
  re
  configs:
    retention.ms: "86400000"
    clean
    cleanup.policy: com
`;
const at = (needle: string, after = needle.length) => text.indexOf(needle) + after;

describe('topicConfigContext', () => {
  it('knows a config key being typed, and the keys already set', () => {
    expect(topicConfigContext(text, at('    clean\n', 9))).toEqual({
      where: 'configKey',
      start: at('    clean\n', 4),
      end: at('    clean\n', 9),
      present: ['retention.ms', 'cleanup.policy'],
    });
  });

  it('knows a config value being typed, and its key', () => {
    expect(topicConfigContext(text, at('cleanup.policy: com'))).toEqual({
      where: 'configValue',
      key: 'cleanup.policy',
      start: at('cleanup.policy: com', 16),
      end: at('cleanup.policy: com'),
    });
  });

  it('knows an existing key under the cursor, for hovers', () => {
    expect(topicConfigContext(text, at('retention.ms', 3))).toMatchObject({
      where: 'configKeyName',
      key: 'retention.ms',
    });
  });

  it('knows a key typed directly under spec, for presets', () => {
    expect(topicConfigContext(text, at('  re\n', 4))).toEqual({
      where: 'specKey',
      start: at('  re\n', 2),
      end: at('  re\n', 4),
    });
  });

  it('offers keys in an empty configs block, and nothing elsewhere', () => {
    const empty = 'kind: Topic\nspec:\n  configs:\n    \n';
    expect(topicConfigContext(empty, empty.indexOf('    \n') + 4)).toMatchObject({ where: 'configKey', present: [] });
    expect(topicConfigContext(text, at('partitions', 3))).toBeUndefined();
    expect(topicConfigContext(text, at('metadata', 2))).toBeUndefined();
  });
});
