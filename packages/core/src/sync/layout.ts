export const ENVIRONMENTS_DIR = 'environments';
export const STATE_DIR = '.conduktor';

export interface Move {
  from: string;
  to: string;
}

export function environmentName(connectionName: string): string {
  return connectionName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'console';
}

export function environmentDir(env: string): string {
  return `${ENVIRONMENTS_DIR}/${env}`;
}

export function baseDir(env: string): string {
  return `${STATE_DIR}/base/${env}`;
}

// The sync folder used to be <root>/<env>/ with its base inside it. The base moves first because it sits inside the
// folder; if either target exists nothing moves, so base copies never end up under environments/ where `ctl` would
// apply them.
function candidates(env: string): Move[] {
  return [
    { from: `${env}/${STATE_DIR}/base`, to: baseDir(env) },
    { from: env, to: environmentDir(env) },
  ];
}

export function migrationPaths(env: string): string[] {
  return candidates(env).flatMap((move) => [move.from, move.to]);
}

export function planMigration(env: string, existing: ReadonlySet<string>): { moves: Move[]; refused: Move[] } {
  if (env === ENVIRONMENTS_DIR || env === STATE_DIR || !existing.has(env)) return { moves: [], refused: [] };
  const wanted = candidates(env).filter((move) => existing.has(move.from));
  const refused = wanted.filter((move) => existing.has(move.to));
  return refused.length > 0 ? { moves: [], refused } : { moves: wanted, refused: [] };
}
