import { describe, expect, it } from 'vitest';
import { defaultKinds, environments, resolveEnvironment, withEnvironment } from '../src/sync/repoConfig';
import { snapshotCatalog } from './fixtures';

const config = `# Conduktor environments
environments:
  dev:
    console: http://localhost:8080/
    kinds: [Topic, Group] # what this repository manages
owner: platform-team
`;

describe('conduktor.yaml', () => {
  it('reads environments and finds the one bound to a Console, else names it after the connection', () => {
    expect(environments(config)).toEqual({ dev: { console: 'http://localhost:8080/', kinds: ['Topic', 'Group'] } });
    expect(resolveEnvironment(config, 'http://localhost:8080', 'local')).toEqual({ environment: 'dev' });
    expect(resolveEnvironment(config, 'http://localhost:9090', 'staging')).toEqual({ environment: 'staging' });
    expect(resolveEnvironment(undefined, 'http://localhost:8080', 'local:8080')).toEqual({ environment: 'local-8080' });
  });

  it('refuses a bound name that is not a single safe folder', () => {
    for (const name of ['../../Documents', 'team/dev', '..']) {
      const text = `environments:\n  "${name}": { console: http://localhost:8080 }\n`;
      expect(resolveEnvironment(text, 'http://localhost:8080', 'local').problem).toMatch(/not a folder name/);
    }
  });

  it("will not fall back onto another Console's environment", () => {
    const text = 'environments:\n  prod: { console: https://prod.example }\n';
    const resolved = resolveEnvironment(text, 'https://staging.example', 'prod');
    expect(resolved.environment).toBeUndefined();
    expect(resolved.problem).toMatch(/environments\/prod belongs to https:\/\/prod.example/);
  });

  it('updates one environment and keeps comments and other keys', () => {
    const updated = withEnvironment(config, 'dev', { console: 'http://localhost:8080', kinds: ['Topic'] });
    expect(updated).toContain('# Conduktor environments');
    expect(updated).toContain('owner: platform-team');
    expect(environments(updated).dev).toEqual({ console: 'http://localhost:8080', kinds: ['Topic'] });
  });

  it('starts a file from nothing', () => {
    const created = withEnvironment(undefined, 'prod', { console: 'https://console.example', kinds: ['Topic'] });
    expect(environments(created)).toEqual({ prod: { console: 'https://console.example', kinds: ['Topic'] } });
  });

  it('refuses to rewrite a broken file', () => {
    expect(() => withEnvironment('environments: [', 'dev', {})).toThrow(/conduktor.yaml/);
    expect(() => environments('environments: [')).toThrow(/conduktor.yaml/);
  });

  it('manages every kind but User by default, in apply order', () => {
    const kinds = defaultKinds(snapshotCatalog);
    expect(kinds).not.toContain('User');
    expect(kinds).toEqual(expect.arrayContaining(['KafkaCluster', 'Topic', 'Group', 'Application']));
    expect(kinds.indexOf('KafkaCluster')).toBeLessThan(kinds.indexOf('Topic'));
  });
});
