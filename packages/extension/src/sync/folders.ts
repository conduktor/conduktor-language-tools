import * as path from 'node:path';
import { isInside } from '@conduktor/vscode-core';

export function inWorkspace(target: string, folders: readonly string[] | undefined): boolean {
  return (folders ?? []).some((folder) => isInside(folder, target));
}

// The CLI reads schemaFile and descriptionFile relative to where it runs: the workspace folder holding the file. A
// file outside the workspace (a sync folder elsewhere) has no such place, so its own folder stands in.
export function includeRoot(file: string, folders: readonly string[]): string {
  const holding = folders.filter((folder) => isInside(folder, file)).sort((a, b) => b.length - a.length);
  return holding[0] ?? path.dirname(file);
}
