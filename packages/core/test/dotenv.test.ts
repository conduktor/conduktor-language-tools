import { describe, expect, it } from 'vitest';
import { envSearchPath, parseDotenv } from '../src/resources/dotenv';

describe('parseDotenv', () => {
  it('reads NAME=value lines literally, as docker --env-file does', () => {
    expect(parseDotenv('# a comment\n\nTEAM=data\r\n  PRICE=$5 `x`\nnot a line\n9X=no\nEMPTY=\nURL=a=b\n')).toEqual({
      TEAM: 'data',
      PRICE: '$5 `x`',
      EMPTY: '',
      URL: 'a=b',
    });
  });
});

describe('envSearchPath', () => {
  const home = '/home/u';
  it('walks up from the file to the repository root', () => {
    expect(
      envSearchPath('/w/repo/a/b/t.yaml', { workspace: '/w', home, isRepoRoot: (dir) => dir === '/w/repo' }),
    ).toEqual(['/w/repo/a/b', '/w/repo/a', '/w/repo']);
  });

  it('stops at the workspace folder when there is no repository', () => {
    expect(envSearchPath('/w/a/t.yaml', { workspace: '/w', home, isRepoRoot: () => false })).toEqual(['/w/a', '/w']);
  });

  it('stops at home outside any workspace and repository, or at the root outside home', () => {
    expect(envSearchPath('/home/u/x/t.yaml', { home, isRepoRoot: () => false })).toEqual(['/home/u/x', '/home/u']);
    expect(envSearchPath('/tmp/x/t.yaml', { home, isRepoRoot: () => false })).toEqual(['/tmp/x', '/tmp', '/']);
  });
});
