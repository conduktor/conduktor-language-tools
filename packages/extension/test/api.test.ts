import { describe, expect, it } from 'vitest';
import { exposedApi } from '../src/api';

describe('exposedApi', () => {
  const api = { connections: 'store with tokens' };

  it('hands the API to the extension tests', () => {
    expect(exposedApi(true, api)).toBe(api);
  });

  it('exports nothing to other extensions, since the API reaches stored tokens', () => {
    expect(exposedApi(false, api)).toBeUndefined();
  });
});
