import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envSearchPath, fileVariables, parseDotenv } from '../src/resources/dotenv';

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

  it('compares folders without case where the file system does, as on Windows', () => {
    const stops = { home: '/Users/M', isRepoRoot: () => false, caseInsensitive: true };
    expect(envSearchPath('/users/m/x/t.yaml', stops)).toEqual(['/users/m/x', '/users/m']);
  });

  it('stops at home outside any workspace and repository, or at the root outside home', () => {
    expect(envSearchPath('/home/u/x/t.yaml', { home, isRepoRoot: () => false })).toEqual(['/home/u/x', '/home/u']);
    expect(envSearchPath('/tmp/x/t.yaml', { home, isRepoRoot: () => false })).toEqual(['/tmp/x', '/tmp', '/']);
  });
});

describe('fileVariables', () => {
  const tree = () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'conduktor-vars-')));
    mkdirSync(join(home, 'repo', '.git'), { recursive: true });
    mkdirSync(join(home, 'repo', 'topics'), { recursive: true });
    return home;
  };

  it("puts the nearest .env's values over the editor's environment", () => {
    const home = tree();
    writeFileSync(join(home, 'repo', '.env'), 'CLUSTER=local\nSHARED=from-file\n');
    const vars = fileVariables(join(home, 'repo', 'topics', 't.yaml'), { SHARED: 'from-env', PATH: '/bin' }, { home });
    expect(vars).toMatchObject({ CLUSTER: 'local', SHARED: 'from-file', PATH: '/bin' });
  });

  it('never reads a .env above the repository root', () => {
    const home = tree();
    writeFileSync(join(home, '.env'), 'CLUSTER=stranger\n');
    expect(fileVariables(join(home, 'repo', 'topics', 't.yaml'), {}, { home }).CLUSTER).toBeUndefined();
  });

  it('reads a .env again once it changed', () => {
    const home = tree();
    const env = join(home, 'repo', '.env');
    writeFileSync(env, 'CLUSTER=one\n');
    const file = join(home, 'repo', 'topics', 't.yaml');
    expect(fileVariables(file, {}, { home }).CLUSTER).toBe('one');
    writeFileSync(env, 'CLUSTER=two\n');
    utimesSync(env, new Date(), new Date(Date.now() + 5_000));
    expect(fileVariables(file, {}, { home }).CLUSTER).toBe('two');
  });
});
