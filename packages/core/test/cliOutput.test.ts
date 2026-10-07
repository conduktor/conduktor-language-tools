import { describe, expect, it } from 'vitest';
import { readCliOutput } from '../src/cli';

describe('readCliOutput', () => {
  it("reads ctl's line for each resource, results and failures alike", () => {
    const stdout = [
      'Applying resources',
      '--- live',
      '+++ local',
      '-  partitions: 1',
      '+  partitions: 3',
      'Topic/orders: Updated',
      'KafkaCluster/local-kafka: NotChanged',
      'Topic/new-one: Created',
      '',
    ].join('\n');
    const stderr = [
      'Could not apply resource Topic/bad: Invalid value for: body (retention.ms must be a long)',
      'Error: one or more resources could not be applied',
    ].join('\n');
    expect(readCliOutput(stdout, stderr)).toEqual([
      { kind: 'Topic', name: 'orders', result: 'Updated' },
      { kind: 'KafkaCluster', name: 'local-kafka', result: 'NotChanged' },
      { kind: 'Topic', name: 'new-one', result: 'Created' },
      {
        kind: 'Topic',
        name: 'bad',
        result: 'failed',
        message: 'Invalid value for: body (retention.ms must be a long)',
      },
    ]);
  });

  it('reads no deletes: they only come from the state ctl is never given', () => {
    expect(readCliOutput('Topic/old: Deleted (dry-run)\nSubject/gone: Deleted\n', '')).toEqual([]);
  });

  it('ignores a diff line that merely looks like a result', () => {
    expect(readCliOutput('+  description: "Topic/x: Created"\n', '')).toEqual([]);
  });
});
