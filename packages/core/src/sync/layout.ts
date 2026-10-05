export const ENVIRONMENTS_DIR = 'environments';
export const STATE_DIR = '.conduktor';
const REPO_FILES = ['conduktor.yaml', `${STATE_DIR}/.gitignore`, 'templates'];

export interface Move {
  from: string;
  to: string;
}

export function environmentName(connectionName: string): string {
  const name = connectionName.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return name === '' || /^\.+$/.test(name) ? 'console' : name;
}

export function environmentDir(env: string): string {
  return `${ENVIRONMENTS_DIR}/${env}`;
}

export function baseDir(env: string): string {
  return `${STATE_DIR}/base/${env}`;
}

// The sync folder used to be <root>/<env>/ with its base inside it. Only a folder carrying the extension's .conduktor
// is one of those, so a repository's own dev/ is never taken for it. The base moves first because it sits inside the
// folder; if either target exists nothing moves, so base copies never end up under environments/ where `ctl` would
// apply them.
function candidates(env: string): Move[] {
  return [
    { from: `${env}/${STATE_DIR}/base`, to: baseDir(env) },
    { from: env, to: environmentDir(env) },
  ];
}

export function migrationPaths(env: string): string[] {
  return [`${env}/${STATE_DIR}`, ...candidates(env).flatMap((move) => [move.from, move.to])];
}

export function planMigration(env: string, existing: ReadonlySet<string>): { moves: Move[]; refused: Move[] } {
  const reserved = [ENVIRONMENTS_DIR, STATE_DIR].includes(env.toLowerCase());
  if (reserved || !existing.has(env) || !existing.has(`${env}/${STATE_DIR}`)) return { moves: [], refused: [] };
  const wanted = candidates(env).filter((move) => existing.has(move.from));
  const refused = wanted.filter((move) => existing.has(move.to));
  return refused.length > 0 ? { moves: [], refused } : { moves: wanted, refused: [] };
}

export function rootMovePaths(envs: readonly string[]): string[] {
  return [...envs.flatMap((env) => [environmentDir(env), baseDir(env)]), ...REPO_FILES];
}

// Moving the repository to another root: each environment travels with its base copies or not at all, so files are
// never paired with another root's bases.
export function planRootMove(
  envs: readonly string[],
  from: ReadonlySet<string>,
  to: ReadonlySet<string>,
): { moves: Move[]; refused: Move[] } {
  const moves: Move[] = [];
  const refused: Move[] = [];
  const plan = (group: readonly string[]) => {
    const wanted = group.filter((path) => from.has(path)).map((path) => ({ from: path, to: path }));
    const blocked = wanted.filter((move) => to.has(move.to));
    if (blocked.length > 0) refused.push(...blocked);
    else moves.push(...wanted);
  };
  envs.forEach((env) => plan([environmentDir(env), baseDir(env)]));
  // The repository's files stay with any environment that could not move.
  if (refused.length === 0) REPO_FILES.forEach((file) => plan([file]));
  return { moves, refused };
}
