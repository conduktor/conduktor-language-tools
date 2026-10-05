import { describe, expect, it } from 'vitest';
import { checkTopicConfig } from '../src/topicConfigs';

describe('checkTopicConfig', () => {
  it('accepts valid values, as strings or numbers', () => {
    for (const [key, value] of [
      ['retention.ms', '604800000'],
      ['retention.ms', 604800000],
      ['retention.ms', -1],
      ['cleanup.policy', 'compact,delete'],
      ['compression.type', 'lz4'],
      ['min.cleanable.dirty.ratio', '0.5'],
      ['compression.gzip.level', -1],
      ['unclean.leader.election.enable', 'true'],
    ] as const)
      expect(checkTopicConfig(key, value), `${key}=${value}`).toBeUndefined();
  });

  it('says what is wrong with a value', () => {
    expect(checkTopicConfig('retention.ms', 'a week')).toEqual({
      message: 'retention.ms is a long (a whole number).',
      severity: 'error',
    });
    expect(checkTopicConfig('cleanup.policy', 'compact,archive')).toEqual({
      message: 'cleanup.policy takes compact, delete; archive is not one of them.',
      severity: 'error',
    });
    expect(checkTopicConfig('min.cleanable.dirty.ratio', 2)).toEqual({
      message: 'min.cleanable.dirty.ratio is at most 1.',
      severity: 'error',
    });
    expect(checkTopicConfig('compression.gzip.level', 10)?.severity).toBe('error');
    expect(checkTopicConfig('unclean.leader.election.enable', 'yes')?.message).toMatch(/true or false/);
  });

  it('warns about a key Kafka does not have', () => {
    expect(checkTopicConfig('retention.days', '7')).toEqual({
      message: 'retention.days is not a Kafka topic config (a broker may still accept it).',
      severity: 'warning',
    });
  });

  it('refuses values Console cannot send: booleans, decimals and unsafe numbers unquoted', () => {
    expect(checkTopicConfig('preallocate', false)?.message).toMatch(/quote it/);
    expect(checkTopicConfig('min.cleanable.dirty.ratio', 0.5)?.message).toMatch(/quote it/);
    expect(checkTopicConfig('flush.messages', Number('9223372036854775807'))?.message).toMatch(/quote it/);
    expect(checkTopicConfig('flush.messages', '9223372036854775807')).toBeUndefined();
  });

  it('refuses whole numbers beyond an int or a long', () => {
    expect(checkTopicConfig('max.message.bytes', '3000000000')?.severity).toBe('error');
    expect(checkTopicConfig('max.message.bytes', '2147483647')).toBeUndefined();
    expect(checkTopicConfig('retention.ms', '99999999999999999999')?.severity).toBe('error');
  });
});
