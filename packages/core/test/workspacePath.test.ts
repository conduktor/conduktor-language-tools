import { describe, expect, it } from 'vitest';
import { isInside, workspaceFile } from '../src/tools/workspacePath';
import { ToolError } from '../src/tools/types';

describe('isInside', () => {
  it('compares whole path segments', () => {
    expect(isInside('/a/foo', '/a/foo')).toBe(true);
    expect(isInside('/a/foo', '/a/foo/bar.yaml')).toBe(true);
    expect(isInside('/a/foo', '/a/foobar')).toBe(false);
    expect(isInside('/a/foo', '/a')).toBe(false);
    expect(isInside('/a/foo/', '/a/foo/x')).toBe(true);
  });

  it('keeps a folder whose name starts with two dots inside', () => {
    expect(isInside('/a', '/a/..hidden/x')).toBe(true);
  });
});

describe('workspaceFile', () => {
  it('resolves a relative path inside the root', () => {
    expect(workspaceFile('/work', 'topics/orders.yaml')).toBe('/work/topics/orders.yaml');
    expect(workspaceFile('/work', './a/../b.yaml')).toBe('/work/b.yaml');
  });

  it('refuses absolute paths', () => {
    expect(() => workspaceFile('/work', '/etc/passwd')).toThrow(ToolError);
    expect(() => workspaceFile('/work', '/work/inside.yaml')).toThrow(/relative to the workspace/);
  });

  it('refuses paths that leave the root', () => {
    expect(() => workspaceFile('/work', '../secrets.yaml')).toThrow(ToolError);
    expect(() => workspaceFile('/work', 'a/../../x')).toThrow(/outside the workspace/);
    expect(() => workspaceFile('/work', '../work-other/x')).toThrow(/outside the workspace/);
  });

  it('needs a root', () => {
    expect(() => workspaceFile(undefined, 'a.yaml')).toThrow(/No workspace folder/);
  });
});
