import { dirname } from 'node:path';

/** KEY=value lines, as docker --env-file reads them: no expansion, comments, blank and malformed lines skipped. */
export function parseDotenv(text: string): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    if (match) variables[match[1]!] = match[2]!;
  }
  return variables;
}

/**
 * The folders whose .env a file's ${VAR} values may come from, nearest first: from the file's own folder up to the
 * first that is its workspace folder, a repository root or the home folder — never a stranger's .env further up.
 */
export function envSearchPath(
  file: string,
  stops: { workspace?: string; home: string; isRepoRoot: (dir: string) => boolean },
): string[] {
  const folders: string[] = [];
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    folders.push(dir);
    if (dir === stops.workspace || dir === stops.home || stops.isRepoRoot(dir) || dirname(dir) === dir) return folders;
  }
}
