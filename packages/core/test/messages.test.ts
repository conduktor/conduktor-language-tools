import { describe, expect, it } from 'vitest';
import { splitPolicyMessages } from '../src/plan/messages';

describe('splitPolicyMessages', () => {
  it('splits a policy failure into one message per rule', () => {
    expect(splitPolicyMessages('Policy violation: - partitions must be < 10\n- name must start with app-')).toEqual([
      'Policy violation: partitions must be < 10',
      'Policy violation: name must start with app-',
    ]);
  });

  it('keeps a single message as is', () => {
    expect(splitPolicyMessages('No Ownership: You do not own orders')).toEqual(['No Ownership: You do not own orders']);
  });
});
