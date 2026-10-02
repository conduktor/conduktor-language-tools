import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

describe('manifest', () => {
  it('keeps connections out of workspace settings, so a repository cannot point a stored token at its own URL', () => {
    expect(manifest.contributes.configuration.properties['conduktor.connections'].scope).toBe('application');
  });
});
