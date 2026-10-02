import { describe, expect, it } from 'vitest';
import { capabilityOf, describeToken, UnsupportedTokenError, type TokenInfo } from '../src/client/tokenInfo';

describe('capabilityOf', () => {
  it.each<[TokenInfo, string]>([
    [{ type: 'AdminToken', id: '1', name: 'ci' }, 'admin'],
    [{ type: 'PersonalAccessToken', id: '1', email: 'a@b', name: 'laptop' }, 'user'],
    [{ type: 'ApplicationInstanceToken', id: '1', name: 't', applicationInstanceName: 'shop-dev' }, 'app'],
  ])('%o → %s', (info, capability) => expect(capabilityOf(info)).toBe(capability));

  it('rejects machine tokens, which have no REST audience', () => {
    expect(() => capabilityOf({ type: 'MachineToken', id: '1', name: 'bot', actor: 'a@b' })).toThrow(
      UnsupportedTokenError,
    );
  });

  it('rejects browser session tokens, which expire', () => {
    expect(() => capabilityOf({ type: 'UserToken', email: 'a@b' })).toThrow(/session/);
  });
});

describe('describeToken', () => {
  it('names the owner', () => {
    expect(describeToken({ type: 'PersonalAccessToken', id: '1', email: 'a@b', name: 'laptop' })).toBe(
      'a@b (personal access token “laptop”)',
    );
    expect(describeToken({ type: 'AdminToken', id: '1', name: 'ci' })).toBe('admin API key “ci”');
  });
});
