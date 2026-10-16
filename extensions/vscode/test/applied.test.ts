import type { UpsertItem, UpsertOutcome } from '@conduktor/core';
import { describe, expect, it } from 'vitest';
import { appliedText } from '../src/editing/applied';

const item = (index: number, outcome: UpsertOutcome): UpsertItem => ({
  document: { index, start: 0, end: 0, kind: 'Topic', apiVersion: 'v2' },
  outcome,
});
const created: UpsertOutcome = { status: 'ok', result: 'Created' };

describe('appliedText', () => {
  it('is the text that was applied once every document in the file reached the Console', () => {
    expect(appliedText('a\n---\nb\n', 2, [item(0, created), item(1, { status: 'ok', result: 'NotChanged' })])).toBe(
      'a\n---\nb\n',
    );
  });

  it('is nothing when only some of the documents in the file were applied', () => {
    expect(appliedText('a\n---\nb\n', 2, [item(1, created)])).toBeUndefined();
  });

  it('is nothing when a document failed or was skipped', () => {
    expect(appliedText('a\n---\nb\n', 2, [item(0, created), item(1, { status: 'skipped' })])).toBeUndefined();
    expect(appliedText('a\n', 1, [item(0, { status: 'error', message: 'No' })])).toBeUndefined();
  });
});
