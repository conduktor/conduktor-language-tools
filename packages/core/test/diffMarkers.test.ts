import { describe, expect, it } from 'vitest';
import { DiffMarkers } from '../src/cli';

const red = (text: string) => `\x1b[31m${text}\x1b[0m`;
const green = (text: string) => `\x1b[32m${text}\x1b[0m`;

describe('DiffMarkers', () => {
  it("turns ctl's coloured diff into word-diff markers", () => {
    const markers = new DiffMarkers();
    expect(markers.push(`spec:\n    partitions: ${red('1')}${green('3')}\n`)).toBe(
      'spec:\n    partitions: [-1-]{+3+}\n',
    );
  });

  it('keeps an escape split across chunks together, and leaves plain lines alone', () => {
    const markers = new DiffMarkers();
    const text = `Applying resources\n${green('kind: Topic\nmetadata:')}\nTopic/a: Created\n`;
    const out =
      text
        .split('')
        .map((unit) => markers.push(unit))
        .join('') + markers.end();
    expect(out).toBe('Applying resources\n{+kind: Topic\nmetadata:+}\nTopic/a: Created\n');
  });

  it('leaves out the NUL byte ctl diffs a new resource against', () => {
    const markers = new DiffMarkers();
    expect(markers.push(`${red('\0')}${green('kind: Topic\n')}`) + markers.end()).toBe('{+kind: Topic\n+}');
  });

  it('drops an empty coloured run and any other escape', () => {
    const markers = new DiffMarkers();
    expect(markers.push(`${red(' ')}${green('')}\x1b[1mbold\x1b[0m\n`)).toBe('[- -]bold\n');
  });
});
