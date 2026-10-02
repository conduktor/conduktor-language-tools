import { isInside } from '@conduktor/vscode-core';

export function inWorkspace(target: string, folders: readonly string[] | undefined): boolean {
  return (folders ?? []).some((folder) => isInside(folder, target));
}
