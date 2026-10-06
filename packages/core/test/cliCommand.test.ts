import { describe, expect, it } from 'vitest';
import { cliCommand, cliEnvironment } from '../src/cli';

const docker = { kind: 'docker' as const, image: 'conduktor/conduktor-ctl:v0.9.2', platform: 'darwin' as const };
const base = { env: 'dev', syncRoot: '/repo-on-host', consoleUrl: 'http://localhost:8080' };

describe('cliCommand', () => {
  it('plans an environment in Docker, with the sync root mounted and the token passed by name only', () => {
    const plan = cliCommand({
      ...base,
      action: 'plan',
      runner: docker,
      variables: ['CDK_SECRET_X', 'TEAM'],
    });
    expect(plan.command).toBe('docker');
    expect(plan.args).toEqual([
      'run',
      '--rm',
      '-v',
      '/repo-on-host:/repo',
      '-w',
      '/repo',
      '-e',
      'CDK_BASE_URL',
      '-e',
      'CDK_API_KEY',
      '-e',
      'CDK_SECRET_X',
      '-e',
      'TEAM',
      'conduktor/conduktor-ctl:v0.9.2',
      'apply',
      '-r',
      '-f',
      'environments/dev',
      '--dry-run',
      '--enable-state',
      '--state-file',
      '/repo/.conduktor/state/dev.json',
    ]);
    expect(plan.env).toEqual({ CDK_BASE_URL: 'http://host.docker.internal:8080' });
    expect(plan.cwd).toBe('/repo-on-host');
  });

  it('reaches the host and writes as the user on Linux, and applies without the dry run', () => {
    const apply = cliCommand({
      ...base,
      action: 'apply',
      runner: { ...docker, platform: 'linux', uid: 1000, gid: 1001 },
    });
    expect(apply.args).toContain('--add-host=host.docker.internal:host-gateway');
    expect(apply.args.slice(apply.args.indexOf('--user'), apply.args.indexOf('--user') + 2)).toEqual([
      '--user',
      '1000:1001',
    ]);
    expect(apply.args).not.toContain('--dry-run');
    expect(apply.args).not.toContain('--print-diff');
    // ctl's --print-diff fails any resource the Console does not have yet, so a plan with a create would fail.
    expect(cliCommand({ ...base, action: 'plan', runner: docker }).args).not.toContain('--print-diff');
    expect(apply.args.at(-3)).toBe('--enable-state');
  });

  it('runs a local binary in the sync root, with the Console as it is and the state on the host', () => {
    const plan = cliCommand({
      ...base,
      consoleUrl: 'http://127.0.0.1:8080',
      action: 'plan',
      runner: { kind: 'path', binary: 'conduktor' },
    });
    expect(plan.command).toBe('conduktor');
    expect(plan.args.slice(-2)).toEqual(['--state-file', '/repo-on-host/.conduktor/state/dev.json']);
    expect(plan.env).toEqual({ CDK_BASE_URL: 'http://127.0.0.1:8080' });
    expect(plan.cwd).toBe('/repo-on-host');
  });

  it('only rewrites a local Console for Docker', () => {
    const remote = cliCommand({ ...base, consoleUrl: 'https://console.example.com', action: 'plan', runner: docker });
    expect(remote.env.CDK_BASE_URL).toBe('https://console.example.com');
    const loopback = cliCommand({ ...base, consoleUrl: 'http://127.0.0.1:8080/', action: 'plan', runner: docker });
    expect(loopback.env.CDK_BASE_URL).toBe('http://host.docker.internal:8080/');
  });

  it('gives ctl the bound Console only: no CDK_ setting from the shell or the .env reaches it', () => {
    const env = cliEnvironment(
      {
        PATH: '/bin',
        CDK_STATE_REMOTE_URI: 's3://prod/state',
        CDK_DEBUG: 'true',
        CDK_USER: 'me',
        CDK_BASE_URL: 'https://prod',
      },
      { CDK_API_KEY: 'from-env-file', CDK_SECRET_TOPIC_X: 's3cret', TEAM: 'data' },
      { CDK_BASE_URL: 'http://localhost:8080', CDK_API_KEY: 'bound' },
    );
    expect(env).toEqual({
      PATH: '/bin',
      CDK_SECRET_TOPIC_X: 's3cret',
      TEAM: 'data',
      CDK_BASE_URL: 'http://localhost:8080',
      CDK_API_KEY: 'bound',
    });
  });
});
