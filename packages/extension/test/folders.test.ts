import { describe, expect, it } from 'vitest';
import { includeRoot, inWorkspace } from '../src/sync/folders';

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

describe('includeRoot', () => {
  it('is the workspace folder holding the file, where the CLI would run', () => {
    expect(includeRoot('/work/conduktor/local/clusters/c/kafka/Topic/t.yaml', ['/other', '/work'])).toBe('/work');
  });

  it('is the innermost workspace folder when folders nest', () => {
    expect(includeRoot('/work/gitops/topics/t.yaml', ['/work', '/work/gitops'])).toBe('/work/gitops');
  });

  it("is the file's own folder outside the workspace", () => {
    expect(includeRoot('/elsewhere/local/global/t.yaml', ['/work'])).toBe('/elsewhere/local/global');
    expect(includeRoot('/workshop/t.yaml', ['/work'])).toBe('/workshop');
  });
});
