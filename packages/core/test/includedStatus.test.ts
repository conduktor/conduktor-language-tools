import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { collapseIncludes, expandedText, includeRestores, statusWithIncludes } from '../src/sync/includedStatus';
import { driftOf, syncStatus } from '../src/sync/status';

const subject = stringify({
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 's', cluster: 'c' },
  spec: { format: 'AVRO', schemaFile: 's.avsc' },
});
const applied = stringify({
  apiVersion: 'v2',
  kind: 'Subject',
  metadata: { name: 's', cluster: 'c' },
  spec: { format: 'AVRO', schema: 'A' },
});
const reading = (content: string) => () => content;

describe('included files in status', () => {
  it('drifts against the applied copy, not the file as written', () => {
    const live = parse(applied);
    expect(driftOf(applied, live)).toBeUndefined();
    expect(driftOf(subject, live)).toBe('changed');
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
    const topic = (labels: Record<string, string>) =>
      stringify({ apiVersion: 'v2', kind: 'Topic', metadata: { name: 't', cluster: 'c', labels }, spec: {} });
    expect(
      includeRestores(
        topic({ 'conduktor.io/descriptionFile': 'd.md' }),
        topic({ 'conduktor.io/description': 'Applied text' }),
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
});
