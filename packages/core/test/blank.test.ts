import { describe, expect, it } from 'vitest';
import { blankDocumentAt } from '../src/templates/blank';

describe('blankDocumentAt', () => {
  it('is the typed word in an empty document', () => {
    expect(blankDocumentAt('', 0)).toEqual({ start: 0, end: 0 });
    expect(blankDocumentAt('Top', 3)).toEqual({ start: 0, end: 3 });
  });

  it('is found after a separator, not inside a document', () => {
    const text = 'kind: Topic\nmetadata: { name: a }\n---\nTo';
    expect(blankDocumentAt(text, text.length)).toEqual({ start: text.length - 2, end: text.length });
    expect(blankDocumentAt(text, text.indexOf('Topic') + 2)).toBeUndefined();
  });

  it('ignores comments but not content', () => {
    expect(blankDocumentAt('# a note\n', 9)).toEqual({ start: 9, end: 9 });
    expect(blankDocumentAt('# a note\nkind: Topic\n', 0)).toBeUndefined();
  });
});
