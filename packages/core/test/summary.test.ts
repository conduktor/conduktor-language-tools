import type { UpsertItem } from '../src/plan/upsertDocuments';
import { describe, expect, it } from 'vitest';
import { outcomeProblems, summarise } from '../src/plan/summary';

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

  it('counts pending and skipped resources separately from failures', () => {
    expect(
      summarise('local', [
        item({ status: 'ok', result: 'Created' }),
        item({ status: 'pending', message: 'x', waitingFor: ['a'] }),
        item({ status: 'error', message: 'x' }),
        item({ status: 'skipped' }),
      ]),
    ).toEqual({ text: 'Dry run on local: 1 Created, 1 checked when applied, 1 failed, 1 skipped', failed: 1 });
  });

  it('handles a single unchanged resource', () => {
    expect(summarise('local', [item({ status: 'ok', result: 'NotChanged' })])).toEqual({
      text: 'Dry run on local: 1 NotChanged',
      failed: 0,
    });
  });
});

describe('outcomeProblems', () => {
  it('gives one error per policy rule', () => {
    const message = 'Policy violated: - partitions must be <= 12\n- name must start with team-';
    expect(outcomeProblems({ status: 'error', message }, 'here').map((p) => p.severity)).toEqual(['error', 'error']);
  });

  it('says what a pending resource waits for, and where it is created', () => {
    const [problem] = outcomeProblems(
      { status: 'pending', message: 'Group g not found', waitingFor: ['g'] },
      'in this file',
    );
    expect(problem).toEqual({
      message: 'Checked when applied: waits for g, created in this file. The Console says: Group g not found',
      severity: 'warning',
    });
  });

  it('has nothing to say about a success', () => {
    expect(outcomeProblems({ status: 'ok', result: 'Updated' }, 'here')).toEqual([]);
  });
});
