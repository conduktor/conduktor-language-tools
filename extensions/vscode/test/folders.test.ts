import { describe, expect, it } from 'vitest';
import { inWorkspace } from '../src/sync/folders';

describe('inWorkspace', () => {
  it.each([
    ['a workspace folder is in it', '/a/foo', ['/b', '/a/foo'], true],
    ['a folder under one is in it', '/a/foo/conduktor', ['/a/foo'], true],
    ['a sibling sharing its prefix is not', '/a/foobar', ['/a/foo'], false],
    ['nothing is without workspace folders', '/a/foo', undefined, false],
  ])('%s', (_case, target, folders, expected) => {
    expect(inWorkspace(target, folders)).toBe(expected);
  });
});
