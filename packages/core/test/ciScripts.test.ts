import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ctlArgs } from '../src/cli';
import { CI_SCRIPTS, ciScript, GENERATED_MARK } from '../src/gitops';

function repo(dotenv?: string) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-script-'));
  mkdirSync(join(dir, 'repo', 'ci'), { recursive: true });
  mkdirSync(join(dir, 'repo', 'environments', 'dev'), { recursive: true });
  if (dotenv !== undefined) writeFileSync(join(dir, 'repo', 'environments', 'dev', '.env'), dotenv);
  for (const action of ['plan', 'apply'] as const)
    writeFileSync(join(dir, 'repo', CI_SCRIPTS[action]), ciScript(action));
  writeFileSync(
    join(dir, 'fake-ctl'),
    `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\nenv > "${dir}/env"\npwd > "${dir}/pwd"\n`,
    { mode: 0o755 },
  );
  const run = (action: 'plan' | 'apply', ...args: string[]) =>
    spawnSync('sh', [join(dir, 'repo', CI_SCRIPTS[action]), ...args], {
      cwd: tmpdir(),
      env: { PATH: process.env.PATH, CONDUKTOR_CLI: join(dir, 'fake-ctl'), CDK_BASE_URL: 'http://console' },
      encoding: 'utf8',
    });
  const lines = (file: string) => readFileSync(join(dir, file), 'utf8').trimEnd().split('\n');
  return { run, lines };
}

describe.runIf(process.platform !== 'win32')('ci scripts', () => {
  it('run the same ctl arguments as the extension, from the repository root', () => {
    const { run, lines } = repo();
    for (const action of ['plan', 'apply'] as const) {
      expect(run(action, 'dev').status).toBe(0);
      expect(lines('args')).toEqual(ctlArgs(action, 'dev'));
      expect(lines('pwd')[0]).toMatch(/\/repo$/);
    }
    expect(ciScript('plan')).toContain(GENERATED_MARK);
  });

  it('read the .env literally, the way the extension does', () => {
    const { run, lines } = repo(
      '# a comment\n\nTEAM=data\r\n  PRICE=$5 `x`\nCDK_BASE_URL=http://elsewhere\nCDK_SECRET_PW=s3cret\nnot a line\n9X=no',
    );
    expect(run('plan', 'dev').status).toBe(0);
    const env = Object.fromEntries(
      lines('env').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
    );
    expect(env.TEAM).toBe('data');
    expect(env.PRICE).toBe('$5 `x`');
    expect(env.CDK_SECRET_PW).toBe('s3cret');
    expect(env.CDK_BASE_URL).toBe('http://console');
    expect(env['9X']).toBeUndefined();
  });

  it('refuse a missing or unknown environment', () => {
    const { run } = repo();
    expect(run('plan').status).not.toBe(0);
    const unknown = run('apply', 'prod');
    expect(unknown.status).toBe(1);
    expect(unknown.stderr).toContain('environments/prod');
  });
});
