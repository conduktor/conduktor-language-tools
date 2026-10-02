import { describe, expect, it } from 'vitest';
import { toJsPattern } from '../src/openapi/patterns';

describe('toJsPattern', () => {
  it('keeps patterns JavaScript already understands', () => {
    expect(toJsPattern('^[0-9a-z_\\-.]+$')).toBe('^[0-9a-z_\\-.]+$');
  });

  it('turns a Java DOTALL flag into dot-matches-newline classes', () => {
    const pattern = toJsPattern('(?s).*\\S.*')!;
    expect(pattern).toBe('[\\s\\S]*\\S[\\s\\S]*');
    expect(new RegExp(pattern, 'u').test('line one\n  ')).toBe(true);
    expect(new RegExp(`^${pattern}$`, 'u').test('  \n ')).toBe(false);
  });

  it('leaves escaped dots and dots inside classes alone under DOTALL', () => {
    expect(toJsPattern('(?s)a\\.b[.]c.')).toBe('a\\.b[.]c[\\s\\S]');
  });

  it('drops identity escapes that unicode mode rejects', () => {
    expect(toJsPattern('^[0-9a-z\\_-]+$')).toBe('^[0-9a-z_-]+$');
  });

  it('gives up on patterns it cannot translate', () => {
    expect(toJsPattern('(?<!x')).toBeUndefined();
  });
});
