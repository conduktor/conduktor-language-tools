import { describe, expect, it } from 'vitest';
import { gitTopLevel } from '../src/gitops';

describe('gitTopLevel', () => {
  it('reads the top level, no repository, or a failure that must not become a git init', () => {
    expect(gitTopLevel({ code: 0, stdout: '/repo\n', stderr: '' })).toEqual({ top: '/repo' });
    expect(
      gitTopLevel({
        code: 128,
        stdout: '',
        stderr: 'fatal: not a git repository (or any of the parent directories): .git',
      }),
    ).toEqual({});
    expect(
      gitTopLevel({
        code: 128,
        stdout: '',
        stderr: "fatal: detected dubious ownership in repository at '/repo'\nTo add an exception …",
      }),
    ).toEqual({ error: "git failed: fatal: detected dubious ownership in repository at '/repo'" });
  });
});
