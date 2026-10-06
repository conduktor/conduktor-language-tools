import { describe, expect, it } from 'vitest';
import { cliCommand } from '../src/cli';

const docker = { kind: 'docker' as const, image: 'conduktor/conduktor-ctl:v0.9.2', platform: 'darwin' as const };
const base = { env: 'dev', syncRoot: '/repo-on-host', consoleUrl: 'http://localhost:8080' };

describe('cliCommand', () => {
  it('plans an environment in Docker, with the sync root mounted and the token passed by name only', () => {
    const plan = cliCommand({
      ...base,
      action: 'plan',
      runner: docker,
      envFile: '/repo-on-host/environments/dev/.env',
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
      '--env-file',
      '/repo-on-host/environments/dev/.env',
      'conduktor/conduktor-ctl:v0.9.2',
      'apply',
      '-r',
      '-f',
      'environments/dev',
      '--dry-run',
      '--print-diff',
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
});
