import * as path from 'node:path';
import { ToolError } from './types';

export function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

// An agent names files relative to the workspace, so it can only ever reach what the user opened.
export function workspaceFile(root: string | undefined, file: string): string {
  if (!root) throw new ToolError('No workspace folder is open; pass the YAML text instead.');
  if (path.isAbsolute(file)) throw new ToolError(`${file} is absolute; give a path relative to the workspace.`);
  const resolved = path.resolve(root, file);
  if (!isInside(root, resolved))
    throw new ToolError(`${file} is outside the workspace; only workspace files are read.`);
  return resolved;
}
