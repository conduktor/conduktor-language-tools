import { describe, expect, it } from 'vitest';
import { ConnectionSettingsError, connectionFrom } from '../src/connectionSettings';

describe('the connection settings', () => {
  it('name the Console, its mode and the token', () => {
    const settings = { url: 'https://console.acme.io/', name: 'acme', mode: 'dev', token: 'from-settings' };
    expect(connectionFrom(settings, { CONDUKTOR_TOKEN: 'from-env' })).toEqual({
      name: 'acme',
      url: 'https://console.acme.io/',
      mode: 'dev',
      token: 'from-settings',
      from: 'settings',
    });
  });

  it('take the token from CONDUKTOR_TOKEN when they leave it out', () => {
    expect(connectionFrom({ url: 'http://localhost:8080' }, { CONDUKTOR_TOKEN: 'from-env' })?.token).toBe('from-env');
  });

  it('default to prod, named after the host', () => {
    expect(connectionFrom({ url: 'http://localhost:8080' }, {})).toEqual({
      name: 'localhost:8080',
      url: 'http://localhost:8080',
      mode: 'prod',
      token: undefined,
      from: 'settings',
    });
  });

  it('are optional: without them, there is no Console', () => {
    expect(connectionFrom(undefined, {})).toBeUndefined();
    expect(connectionFrom(null, {})).toBeUndefined();
    expect(connectionFrom({}, {})).toBeUndefined();
  });

  it('fall back to the Console the conduktor CLI points at, in prod', () => {
    const cli = { CDK_BASE_URL: 'https://console.acme.io', CDK_API_KEY: 'cli-key', CONDUKTOR_TOKEN: 'other' };
    expect(connectionFrom(undefined, cli)).toEqual({
      name: 'console.acme.io',
      url: 'https://console.acme.io',
      mode: 'prod',
      token: 'cli-key',
      from: 'cli',
    });
    expect(connectionFrom({}, cli)?.from).toBe('cli');
  });

  it("win over the CLI's environment", () => {
    const cli = { CDK_BASE_URL: 'https://cli.acme.io', CDK_API_KEY: 'cli-key' };
    expect(connectionFrom({ url: 'https://settings.acme.io' }, cli)).toMatchObject({
      url: 'https://settings.acme.io',
      token: undefined,
      from: 'settings',
    });
  });

  it('refuse a CLI address that is not one, naming the variable', () => {
    expect(() => connectionFrom(undefined, { CDK_BASE_URL: 'localhost' })).toThrow(/^CDK_BASE_URL: /);
  });

  it.each([
    ['not an object', 'http://localhost:8080', /expected an object/],
    ['no url', { name: 'x' }, /"url"/],
    ['a url that is not one', { url: 'localhost' }, /"url"/],
    ['an unknown mode', { url: 'http://localhost:8080', mode: 'apply' }, /"mode" must be "dev" or "prod"/],
    ['an empty token', { url: 'http://localhost:8080', token: '' }, /"token"/],
  ])('refuse %s, saying where they are', (_case, settings, message) => {
    expect(() => connectionFrom(settings, {})).toThrow(ConnectionSettingsError);
    expect(() => connectionFrom(settings, {})).toThrow(/^lsp\.conduktor-console\.settings: /);
    expect(() => connectionFrom(settings, {})).toThrow(message);
  });
});
