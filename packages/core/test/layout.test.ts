import { describe, expect, it } from 'vitest';
import {
  baseDir,
  basePathOf,
  environmentDir,
  environmentName,
  migrationPaths,
  planMigration,
  planRootMove,
  rootMovePaths,
} from '../src/sync/layout';

describe('layout', () => {
  it('names an environment after its connection, safe as one folder and never . or ..', () => {
    expect(environmentName('localhost:8080')).toBe('localhost-8080');
    expect(environmentName('Prod / EU')).toBe('Prod-EU');
    expect(environmentName('///')).toBe('console');
    // . or .. would point at the repository or environments/.
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

  it.each([
    ['without a legacy folder', 'dev', ['dev/.conduktor', 'environments/dev']],
    ['for a folder the extension did not write, which would have its .conduktor', 'dev', ['dev']],
    ['for a reserved folder', 'environments', ['environments']],
    ['for a reserved folder', '.conduktor', ['.conduktor']],
    // macOS and Windows compare folder names without case.
    ['for a reserved folder in another case', '.Conduktor', ['.Conduktor', '.Conduktor/.conduktor']],
    ['for a reserved folder in another case', 'Environments', ['Environments', 'Environments/.conduktor']],
    ['for a reserved folder in another case', 'ENVIRONMENTS', ['ENVIRONMENTS', 'ENVIRONMENTS/.conduktor']],
  ])('moves nothing %s: %s', (_, env, existing) => {
    expect(planMigration(env, new Set(existing))).toEqual({ moves: [], refused: [] });
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

  it('keeps an environment whole, and the repository files with one that could not move', () => {
    const { moves, refused } = planRootMove(['dev', 'prod'], from, new Set(['.conduktor/base/dev']));
    // If either half of an environment exists at the target, neither moves.
    expect(moves.map((m) => m.from)).toEqual(['environments/prod', '.conduktor/base/prod']);
    expect(refused).toEqual([{ from: '.conduktor/base/dev', to: '.conduktor/base/dev' }]);
  });

  it('lists every path it looks at', () => {
    expect(rootMovePaths(['dev'])).toEqual([
      'environments/dev',
      '.conduktor/base/dev',
      'conduktor.yaml',
      '.conduktor/.gitignore',
      'templates',
    ]);
  });
});

describe('basePathOf', () => {
  it("maps a file to its own environment's base copy", () => {
    expect(basePathOf('/r', '/r/environments/a/clusters/c/kafka/Topic/t.yaml')).toBe(
      '/r/.conduktor/base/a/clusters/c/kafka/Topic/t.yaml',
    );
    expect(basePathOf('/r/', '/r/environments/b/global/console/KafkaCluster/k.yaml')).toBe(
      '/r/.conduktor/base/b/global/console/KafkaCluster/k.yaml',
    );
    expect(basePathOf('/r', '/r/environments/a/x.yaml', 'applied')).toBe('/r/.conduktor/applied/a/x.yaml');
  });

  it('has no base for a file outside environments/', () => {
    expect(basePathOf('/r', '/r/templates/Topic/x.yaml')).toBeUndefined();
    expect(basePathOf('/r', '/elsewhere/environments/a/x.yaml')).toBeUndefined();
    expect(basePathOf('/r', '/r/environments/a')).toBeUndefined();
  });
});
