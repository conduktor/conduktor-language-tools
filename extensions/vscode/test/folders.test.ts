import { describe, expect, it } from 'vitest';
import { inWorkspace } from '../src/sync/folders';

describe('inWorkspace', () => {
  it('is true for a workspace folder and anything under it', () => {
    expect(inWorkspace('/a/foo', ['/b', '/a/foo'])).toBe(true);
    expect(inWorkspace('/a/foo/conduktor', ['/a/foo'])).toBe(true);
  });

  it('does not take a sibling sharing a prefix for a subfolder', () => {
    expect(inWorkspace('/a/foobar', ['/a/foo'])).toBe(false);
  });

  it('is false without workspace folders', () => {
    expect(inWorkspace('/a/foo', undefined)).toBe(false);
  });
});
