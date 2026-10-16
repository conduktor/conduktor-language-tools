import { existsSync, lstatSync, realpathSync } from 'node:fs';
import * as path from 'node:path';
import { ToolError } from './types';

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * A file named relative to `root` that is really inside it: `..` and absolute paths are refused, and so is a symlink
 * (to a file or through a folder, existing or dangling) that leads out — for a file about to be written as much as for
 * one being read. Returns the path as named, so it still matches the editor's open documents.
 */
export function containedFile(root: string, file: string): string {
  if (path.isAbsolute(file)) throw new Error(`${file} is absolute; give a path relative to the workspace.`);
  const resolved = path.resolve(root, file);
  const outside = () => new Error(`${file} is outside the workspace; only workspace files are read.`);
  if (!isInside(root, resolved)) throw outside();
  // The deepest part that exists decides where the path really goes.
  let existing = resolved;
  const rest: string[] = [];
  while (!existsSync(existing)) {
    if (isSymlink(existing)) throw outside();
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  const real = path.join(existsSync(existing) ? realpathSync(existing) : existing, ...rest);
  if (!isInside(existsSync(root) ? realpathSync(root) : root, real)) throw outside();
  return resolved;
}

function isSymlink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
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

// The CLI reads schemaFile and descriptionFile relative to where it runs: the workspace folder holding the file. A
// file outside the workspace (a sync folder elsewhere) has no such place, so its own folder stands in.
export function includeRoot(file: string, folders: readonly string[]): string {
  const holding = folders.filter((folder) => isInside(folder, file)).sort((a, b) => b.length - a.length);
  return holding[0] ?? path.dirname(file);
}
