import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** KEY=value lines, as docker --env-file reads them: no expansion, comments, blank and malformed lines skipped. */
export function parseDotenv(text: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const [, name, value] = /^\s*([a-z_]\w*)=(.*)$/i.exec(line) ?? [];
    if (name !== undefined && value !== undefined) variables[name] = value;
  }
  return variables;
}

/**
 * The folders whose .env a file's ${VAR} values may come from, nearest first: from the file's own folder up to the
 * first that is its workspace folder, a repository root or the home folder — never a stranger's .env further up.
 */
export function envSearchPath(
  file: string,
  stops: {
    workspace?: string | undefined;
    home: string;
    isRepoRoot: (dir: string) => boolean;
    caseInsensitive?: boolean;
  },
): string[] {
  // Windows paths differ in case between sources (VS Code lower-cases the drive letter, os.homedir() does not).
  const same = (a: string, b: string | undefined) =>
    b !== undefined && (stops.caseInsensitive ? a.toLowerCase() === b.toLowerCase() : a === b);
  const folders: string[] = [];
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    folders.push(dir);
    if (same(dir, stops.workspace) || same(dir, stops.home) || stops.isRepoRoot(dir) || dirname(dir) === dir)
      return folders;
  }
}

const read = new Map<string, { mtimeMs: number; values: Record<string, string> }>();

/**
 * The ${VAR} values for a file: `base` (the editor's environment), with the nearest .env's on top — searched up to the
 * file's workspace folder, repository root or home folder. Synchronous, because editors ask for lenses synchronously.
 */
export function fileVariables(
  file: string,
  base: Readonly<Record<string, string | undefined>>,
  stops: { workspace?: string | undefined; home: string },
): Readonly<Record<string, string | undefined>> {
  const search = envSearchPath(file, {
    ...stops,
    isRepoRoot: (dir) => existsSync(join(dir, '.git')),
    caseInsensitive: process.platform === 'win32',
  });
  for (const dir of search) {
    const values = dotenvAt(join(dir, '.env'));
    if (values) return { ...base, ...values };
  }
  return base;
}

function dotenvAt(file: string): Record<string, string> | undefined {
  let mtimeMs: number;
  try {
    ({ mtimeMs } = statSync(file));
  } catch {
    return undefined;
  }
  const cached = read.get(file);
  if (cached?.mtimeMs === mtimeMs) return cached.values;
  const values = parseDotenv(readFileSync(file, 'utf8'));
  read.set(file, { mtimeMs, values });
  return values;
}
