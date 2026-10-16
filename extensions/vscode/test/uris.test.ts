import { describe, expect, it } from 'vitest';
import { isLiveScheme, parseLiveUriParts, toLiveUriParts, type LiveRef } from '../src/liveFs/uris';

describe('live URIs', () => {
  it.each<LiveRef>([
    { connectionId: 'abc', kind: 'Topic', version: 2, parents: ['local'], name: 'orders' },
    { connectionId: 'abc', kind: 'Connector', version: 2, parents: ['my cluster', 'connect#1'], name: 'sink 50%.v2' },
    { connectionId: 'abc', kind: 'Application', version: 1, parents: [], name: 'shop/eu' },
  ])('round-trips $kind $name', (ref) => {
    const { authority, path } = toLiveUriParts(ref);
    expect(parseLiveUriParts(authority, path)).toEqual(ref);
  });

  it('ends in .yaml so the editor uses YAML', () => {
    expect(toLiveUriParts({ connectionId: 'a', kind: 'Topic', version: 2, parents: ['c'], name: 't' }).path).toBe(
      '/Topic/v2/c/t.yaml',
    );
  });

  it('rejects paths it did not make', () => {
    expect(parseLiveUriParts('a', '/Topic/t.yaml')).toBeUndefined();
    expect(parseLiveUriParts('a', '/Topic/two/c/t.yaml')).toBeUndefined();
    expect(parseLiveUriParts('a', '/Topic/v2/c/t.json')).toBeUndefined();
    expect(parseLiveUriParts('a', '/Topic/v2/%E0%A4%A/t.yaml')).toBeUndefined();
  });

  it('uses a separate scheme for documents that may be edited, so VS Code enforces read-only for the rest', () => {
    const ref = { connectionId: 'a', kind: 'Topic', version: 2, parents: ['c'], name: 't' };
    expect(toLiveUriParts(ref).scheme).toBe('conduktor');
    expect(toLiveUriParts(ref, { editable: true }).scheme).toBe('conduktor-edit');
    expect([isLiveScheme('conduktor'), isLiveScheme('conduktor-edit'), isLiveScheme('file')]).toEqual([
      true,
      true,
      false,
    ]);
  });
});
