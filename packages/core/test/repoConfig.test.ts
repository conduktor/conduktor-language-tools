import { describe, expect, it } from 'vitest';
import { defaultKinds, environmentFor, environments, withEnvironment } from '../src/sync/repoConfig';
import { snapshotCatalog } from './fixtures';

const config = `# Conduktor environments
environments:
  dev:
    console: http://localhost:8080/
    kinds: [Topic, Group] # what this repository manages
owner: platform-team
`;

describe('conduktor.yaml', () => {
  it('reads environments and finds the one bound to a Console', () => {
    expect(environments(config)).toEqual({ dev: { console: 'http://localhost:8080/', kinds: ['Topic', 'Group'] } });
    expect(environmentFor(config, 'http://localhost:8080')).toBe('dev');
    expect(environmentFor(config, 'http://localhost:9090')).toBeUndefined();
    expect(environmentFor(undefined, 'http://localhost:8080')).toBeUndefined();
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
