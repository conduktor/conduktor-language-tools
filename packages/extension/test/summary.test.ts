import type { UpsertItem } from '@conduktor/vscode-core';
import { describe, expect, it } from 'vitest';
import { summarise } from '../src/dryRun/summary';

const item = (outcome: UpsertItem['outcome']): UpsertItem => ({
  document: { index: 0, start: 0, end: 0, kind: 'Topic', apiVersion: 'v2' },
  outcome,
});

describe('summarise', () => {
  it('counts results and failures in a fixed order', () => {
    expect(
      summarise('local', [
        item({ status: 'ok', result: 'NotChanged' }),
        item({ status: 'error', message: 'x' }),
        item({ status: 'ok', result: 'Created' }),
        item({ status: 'ok', result: 'NotChanged' }),
      ]),
    ).toEqual({ text: 'Dry run on local: 1 Created, 2 NotChanged, 1 failed', failed: 1 });
  });

  it('handles a single unchanged resource', () => {
    expect(summarise('local', [item({ status: 'ok', result: 'NotChanged' })])).toEqual({
      text: 'Dry run on local: 1 NotChanged',
      failed: 0,
    });
  });
});
