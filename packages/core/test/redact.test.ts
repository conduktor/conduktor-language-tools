import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Resource } from '../src/resources/types';
import { isDrifted } from '../src/sync/status';
import { withSecretPlaceholders } from '../src/sync/placeholders';
import { redactedPaths, redactSecrets } from '../src/tools/redact';

describe('redactSecrets', () => {
  it('leaves numbers, booleans and objects under secret-looking names alone', () => {
    const value = { maxTokens: 4096, tokenRefresh: true, machineTokens: { active: 2 }, apiKey: 'k' };
    expect(redactSecrets(value)).toEqual({
      value: { maxTokens: 4096, tokenRefresh: true, machineTokens: { active: 2 }, apiKey: '<redacted>' },
      redacted: 1,
    });
  });

  it('redacts the password in a URL, keeping the rest readable', () => {
    expect(redactSecrets({ 'connection.url': 'postgresql://app:hunter2@db:5432/orders' }).value).toEqual({
      'connection.url': 'postgresql://app:<redacted>@db:5432/orders',
    });
    expect(redactSecrets({ url: 'https://ghp_abc123@github.com/org/repo.git' }).value).toEqual({
      url: 'https://<redacted>@github.com/org/repo.git',
    });
  });

  it('redacts secret query parameters in a URL', () => {
    expect(
      redactSecrets({ 'connection.url': 'jdbc:mysql://db:3306/orders?user=app&password=hunter2&ssl=true' }).value,
    ).toEqual({ 'connection.url': 'jdbc:mysql://db:3306/orders?user=app&password=<redacted>&ssl=true' });
    expect(redactSecrets({ url: 'jdbc:sqlserver://db:1433;user=app;password=hunter2' }).value).toEqual({
      url: 'jdbc:sqlserver://db:1433;user=app;password=<redacted>',
    });
    expect(redactSecrets({ hook: 'https://hooks.example.com/x?api_key=k1;token=t1#top' })).toEqual({
      value: { hook: 'https://hooks.example.com/x?api_key=<redacted>;token=<redacted>#top' },
      redacted: 2,
    });
  });

  it('leaves URLs and plain text without credentials as they are', () => {
    const value = {
      url: 'http://gw:8888/admin?limit=10',
      note: 'user:pass@example is not a URL',
      topic: 'a=b&password=c',
    };
    expect(redactSecrets(value)).toEqual({ value, redacted: 0 });
  });
});

describe('redactedPaths', () => {
  it('finds a redaction inside a URL', () => {
    expect(redactedPaths({ spec: { url: 'postgresql://app:<redacted>@db/orders' } })).toEqual(['/spec/url']);
  });
});

describe('secret placeholders and drift follow the same rule', () => {
  const connector: Resource = {
    apiVersion: 'v2',
    kind: 'Connector',
    metadata: { name: 'sink', cluster: 'local', connectCluster: 'main' },
    spec: {
      config: {
        'connection.url': 'jdbc:postgresql://app:hunter2@db/orders?sslpassword=s3cr3t&ssl=true',
        'tasks.max': 2,
        maxTokens: 10,
      },
    },
  };

  it('replaces URL credentials with variables and keeps non-strings', () => {
    const { resource, variables } = withSecretPlaceholders(connector);
    expect(resource.spec).toEqual({
      config: {
        'connection.url':
          'jdbc:postgresql://app:${CDK_SECRET_CONNECTOR_SINK_SPEC_CONFIG_CONNECTION_URL_PASSWORD}@db/orders?sslpassword=${CDK_SECRET_CONNECTOR_SINK_SPEC_CONFIG_CONNECTION_URL_SSLPASSWORD}&ssl=true',
        'tasks.max': 2,
        maxTokens: 10,
      },
    });
    expect(variables).toEqual([
      'CDK_SECRET_CONNECTOR_SINK_SPEC_CONFIG_CONNECTION_URL_PASSWORD',
      'CDK_SECRET_CONNECTOR_SINK_SPEC_CONFIG_CONNECTION_URL_SSLPASSWORD',
    ]);
  });

  it('is not drift while only the secrets in a URL differ', () => {
    expect(isDrifted(stringify(withSecretPlaceholders(connector).resource), connector)).toBe(false);
  });

  it('placeholders an already placeholdered resource the same way', () => {
    const once = withSecretPlaceholders(connector).resource;
    expect(withSecretPlaceholders(once).resource).toEqual(once);
  });
});
