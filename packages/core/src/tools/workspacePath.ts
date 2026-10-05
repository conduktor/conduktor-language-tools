import { existsSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { ToolError } from './types';

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * A file named relative to `root` that is really inside it: `..` and absolute paths are refused, and so is a symlink
 * (to a file or through a folder) that leads out. Returns the real path that was checked.
 */
export function containedFile(root: string, file: string): string {
  if (path.isAbsolute(file)) throw new Error(`${file} is absolute; give a path relative to the workspace.`);
  const resolved = path.resolve(root, file);
  const outside = () => new Error(`${file} is outside the workspace; only workspace files are read.`);
  if (!isInside(root, resolved)) throw outside();
  if (!existsSync(resolved)) return resolved;
  const real = realpathSync(resolved);
  if (!isInside(existsSync(root) ? realpathSync(root) : root, real)) throw outside();
  return real;
}

// An agent names files relative to the workspace, so it can only ever reach what the user opened.
export function workspaceFile(root: string | undefined, file: string): string {
  if (!root) throw new ToolError('No workspace folder is open; pass the YAML text instead.');
  try {
    return containedFile(root, file);
  } catch (error) {
    throw new ToolError((error as Error).message);
  }
}
