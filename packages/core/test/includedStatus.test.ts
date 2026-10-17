import { describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import type { Resource } from '../src/resources/types';
import { collapseIncludes, expandedText, includeRestores, statusWithIncludes } from '../src/sync/includedStatus';
import { driftOf, syncStatus } from '../src/sync/status';

const subject = stringify({
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 's', cluster: 'c' },
  spec: { format: 'AVRO', schemaFile: 's.avsc' },
});
const appliedResource: Resource = {
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 's', cluster: 'c' },
  spec: { format: 'AVRO', schema: 'A' },
};
const applied = stringify(appliedResource);
const reading = (content: string) => () => content;

describe('included files in status', () => {
  it('drifts against the applied copy, not the file as written', () => {
    expect(driftOf(applied, appliedResource)).toBeUndefined();
    expect(driftOf(subject, appliedResource)).toBe('changed');
  });

  it('is modified when an included file changed since it was applied', () => {
    expect(statusWithIncludes(subject, subject, applied, reading('B'))).toBe('modified');
    expect(statusWithIncludes(subject, subject, applied, reading('A'))).toBe('synced');
  });

  it('is new without a base, and reads as before for a file without includes', () => {
    expect(statusWithIncludes(subject, undefined, undefined, reading('A'))).toBe('new');
    const plain = applied;
    expect(expandedText(plain, reading('A'))).toBeUndefined();
    expect(statusWithIncludes(plain, plain, undefined, reading('A'))).toBe(syncStatus(plain, plain));
  });

  it('expands an include it can read, and gives up on one it cannot', () => {
    expect(expandedText(subject, reading('A'))).toBe(applied);
    expect(
      expandedText(subject, () => {
        throw new Error('missing');
      }),
    ).toBeUndefined();
  });

  it('says which included files to write back when discarding', () => {
    expect(includeRestores(subject, applied)).toEqual([{ path: 's.avsc', content: 'A' }]);
    const topic = (metadata: Record<string, unknown>) =>
      stringify({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 't', cluster: 'c', ...metadata }, spec: {} });
    expect(
      includeRestores(
        topic({ labels: { 'conduktor.io/descriptionFile': 'd.md' } }),
        topic({ description: 'Applied text' }),
      ),
    ).toEqual([{ path: 'd.md', content: 'Applied text' }]);
    expect(includeRestores(applied, applied)).toEqual([]);
  });

  it("syncs what the Console holds into the file's includes, keeping the references", () => {
    const live = {
      apiVersion: 'v2',
      kind: 'Subject',
      metadata: { name: 's', cluster: 'c' },
      spec: { format: 'AVRO', schema: 'C', id: 1 },
    };
    expect(collapseIncludes(live, subject)).toEqual({
      resource: { ...live, spec: { format: 'AVRO', schemaFile: 's.avsc', id: 1 } },
      writes: [{ path: 's.avsc', content: 'C' }],
    });
    expect(collapseIncludes(live, applied)).toEqual({ resource: live, writes: [] });
  });

  it("syncs a Topic's description back into its descriptionFile", () => {
    const local = stringify({
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 't', cluster: 'c', labels: { team: 'a', 'conduktor.io/descriptionFile': 'd.md' } },
      spec: { partitions: 1 },
    });
    const live = {
      apiVersion: 'v2',
      kind: 'Topic',
      metadata: { name: 't', cluster: 'c', labels: { team: 'a' }, description: 'From the Console' },
      spec: { partitions: 1 },
    };
    expect(collapseIncludes(live, local)).toEqual({
      resource: {
        ...live,
        metadata: { name: 't', cluster: 'c', labels: { team: 'a', 'conduktor.io/descriptionFile': 'd.md' } },
      },
      writes: [{ path: 'd.md', content: 'From the Console' }],
    });
  });
});
