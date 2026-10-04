import { describe, expect, it } from 'vitest';
import { baseDir, environmentDir, environmentName, migrationPaths, planMigration } from '../src/sync/layout';

describe('layout', () => {
  it('names an environment after its connection, safe as one folder', () => {
    expect(environmentName('localhost:8080')).toBe('localhost-8080');
    expect(environmentName('Prod / EU')).toBe('Prod-EU');
    expect(environmentName('///')).toBe('console');
  });

  it('keeps resources under environments/ and base copies outside them', () => {
    expect(environmentDir('dev')).toBe('environments/dev');
    expect(baseDir('dev')).toBe('.conduktor/base/dev');
  });
});

describe('planMigration', () => {
  const plan = (...existing: string[]) => planMigration('dev', new Set(existing));

  it('moves the base out first, then the folder', () => {
    expect(plan('dev', 'dev/.conduktor/base')).toEqual({
      moves: [
        { from: 'dev/.conduktor/base', to: '.conduktor/base/dev' },
        { from: 'dev', to: 'environments/dev' },
      ],
      refused: [],
    });
  });

  it('moves a folder that has no base yet', () => {
    expect(plan('dev').moves).toEqual([{ from: 'dev', to: 'environments/dev' }]);
  });

  it('moves nothing when any target exists, so stale base copies never land where the CLI applies them', () => {
    expect(plan('dev', 'dev/.conduktor/base', '.conduktor/base/dev')).toEqual({
      moves: [],
      refused: [{ from: 'dev/.conduktor/base', to: '.conduktor/base/dev' }],
    });
  });

  it('has nothing to do without a legacy folder, or when the name is a reserved folder', () => {
    expect(plan('environments/dev')).toEqual({ moves: [], refused: [] });
    expect(planMigration('environments', new Set(['environments']))).toEqual({ moves: [], refused: [] });
    expect(planMigration('.conduktor', new Set(['.conduktor']))).toEqual({ moves: [], refused: [] });
  });

  it('lists every path the plan looks at', () => {
    expect(migrationPaths('dev').sort()).toEqual(
      ['.conduktor/base/dev', 'dev', 'dev/.conduktor/base', 'environments/dev'].sort(),
    );
  });
});
