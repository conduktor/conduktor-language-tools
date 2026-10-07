import { describe, expect, it } from 'vitest';
import { canChange, migrateMode } from '../src/connectionMode';

describe('connection modes', () => {
  it('reads every stored mode as dev or prod, and only apply or dev as dev', () => {
    expect(migrateMode('apply')).toBe('dev');
    expect(migrateMode('dev')).toBe('dev');
    expect(migrateMode('dry-run')).toBe('prod');
    expect(migrateMode('read-only')).toBe('prod');
    expect(migrateMode('prod')).toBe('prod');
    expect(migrateMode(undefined)).toBe('prod');
    expect(migrateMode('anything')).toBe('prod');
  });

  it('lets only dev change the Console', () => {
    expect(canChange('dev')).toBe(true);
    expect(canChange('prod')).toBe(false);
  });
});
