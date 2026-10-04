import { describe, expect, it } from 'vitest';
import {
  baseDir,
  environmentDir,
  environmentName,
  migrationPaths,
  planMigration,
  planRootMove,
  rootMovePaths,
} from '../src/sync/layout';

describe('layout', () => {
  it('names an environment after its connection, safe as one folder', () => {
    expect(environmentName('localhost:8080')).toBe('localhost-8080');
    expect(environmentName('Prod / EU')).toBe('Prod-EU');
    expect(environmentName('///')).toBe('console');
  });

  it('never names an environment . or .., which would point at the repository or environments/', () => {
    expect(environmentName('.')).toBe('console');
    expect(environmentName('..')).toBe('console');
  });

  it('keeps resources under environments/ and base copies outside them', () => {
    expect(environmentDir('dev')).toBe('environments/dev');
    expect(baseDir('dev')).toBe('.conduktor/base/dev');
  });
});

describe('planMigration', () => {
  const plan = (...existing: string[]) => planMigration('dev', new Set(['dev/.conduktor', ...existing]));

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

  it('moves only a folder the extension wrote, which always has its .conduktor', () => {
    expect(planMigration('dev', new Set(['dev']))).toEqual({ moves: [], refused: [] });
  });

  it('compares reserved folders without case, as macOS and Windows do', () => {
    for (const env of ['.Conduktor', 'Environments', 'ENVIRONMENTS'])
      expect(planMigration(env, new Set([env, `${env}/.conduktor`]))).toEqual({ moves: [], refused: [] });
  });

  it('lists every path the plan looks at', () => {
    expect(migrationPaths('dev').sort()).toEqual(
      ['.conduktor/base/dev', 'dev', 'dev/.conduktor', 'dev/.conduktor/base', 'environments/dev'].sort(),
    );
  });
});

describe('planRootMove', () => {
  const from = new Set([
    'environments/dev',
    '.conduktor/base/dev',
    'environments/prod',
    '.conduktor/base/prod',
    'conduktor.yaml',
    '.conduktor/.gitignore',
  ]);

  it('moves each environment with its base copies, and the repository files', () => {
    expect(planRootMove(['dev', 'prod'], from, new Set()).moves).toEqual([
      { from: 'environments/dev', to: 'environments/dev' },
      { from: '.conduktor/base/dev', to: '.conduktor/base/dev' },
      { from: 'environments/prod', to: 'environments/prod' },
      { from: '.conduktor/base/prod', to: '.conduktor/base/prod' },
      { from: 'conduktor.yaml', to: 'conduktor.yaml' },
      { from: '.conduktor/.gitignore', to: '.conduktor/.gitignore' },
    ]);
  });

  it('keeps an environment whole: if either half exists at the target, neither moves', () => {
    const { moves, refused } = planRootMove(['dev', 'prod'], from, new Set(['.conduktor/base/dev']));
    expect(moves.map((m) => m.from)).not.toContain('environments/dev');
    expect(moves.map((m) => m.from)).toContain('environments/prod');
    expect(refused).toEqual([{ from: '.conduktor/base/dev', to: '.conduktor/base/dev' }]);
  });

  it('leaves the repository files with an environment that could not move', () => {
    const { moves } = planRootMove(['dev', 'prod'], from, new Set(['.conduktor/base/dev']));
    expect(moves.map((m) => m.from)).not.toContain('conduktor.yaml');
    expect(moves.map((m) => m.from)).not.toContain('.conduktor/.gitignore');
  });

  it('lists every path it looks at', () => {
    expect(rootMovePaths(['dev'])).toEqual([
      'environments/dev',
      '.conduktor/base/dev',
      'conduktor.yaml',
      '.conduktor/.gitignore',
    ]);
  });
});
