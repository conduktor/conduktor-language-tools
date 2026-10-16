import { describe, expect, it } from 'vitest';
import { outcomeLabel } from '../src/plan/summary';

describe('outcomeLabel', () => {
  it('marks each result so it reads at a glance', () => {
    expect(outcomeLabel({ status: 'ok', result: 'Created' })).toBe('+ Created');
    expect(outcomeLabel({ status: 'ok', result: 'Updated' })).toBe('~ Updated');
    expect(outcomeLabel({ status: 'ok', result: 'NotChanged' })).toBe('= NotChanged');
    expect(outcomeLabel({ status: 'error', message: 'No Ownership' })).toBe('✗ failed');
    expect(outcomeLabel({ status: 'pending', message: 'x', waitingFor: ['team-a'] })).toBe('⏳ pending');
    expect(outcomeLabel({ status: 'skipped' })).toBe('– skipped');
  });
});
