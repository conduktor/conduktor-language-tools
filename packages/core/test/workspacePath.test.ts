import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { containedFile, isInside, workspaceFile } from '../src/tools/workspacePath';
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

describe('containedFile', () => {
  const fixture = () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'contained-')));
    const work = join(base, 'work');
    const outside = join(base, 'outside');
    mkdirSync(work);
    mkdirSync(outside);
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    writeFileSync(join(work, 'real.txt'), 'real');
    symlinkSync(join(outside, 'secret.txt'), join(work, 'out-file'));
    symlinkSync(outside, join(work, 'out-dir'));
    symlinkSync(join(work, 'real.txt'), join(work, 'in-file'));
    return work;
  };

  it('refuses a symlink that leads outside the root, to a file or through a folder', () => {
    const work = fixture();
    expect(() => containedFile(work, 'out-file')).toThrow(/outside/);
    expect(() => containedFile(work, 'out-dir/secret.txt')).toThrow(/outside/);
    expect(() => workspaceFile(work, 'out-file')).toThrow(ToolError);
  });

  it('follows a symlink that stays inside, and refuses .. and absolute paths', () => {
    const work = fixture();
    expect(containedFile(work, 'in-file')).toBe(join(work, 'in-file'));
    expect(() => containedFile(work, '../outside/secret.txt')).toThrow(/outside/);
    expect(() => containedFile(work, join(work, 'real.txt'))).toThrow(/relative/);
  });

  it('refuses a path that does not exist yet when it would land outside', () => {
    const work = fixture();
    symlinkSync(join(work, '..', 'outside', 'nothing.txt'), join(work, 'dangling'));
    expect(() => containedFile(work, 'dangling')).toThrow(/outside/);
    expect(() => containedFile(work, 'out-dir/new.avsc')).toThrow(/outside/);
    expect(containedFile(work, 'schemas/new.avsc')).toBe(join(work, 'schemas', 'new.avsc'));
  });
});
