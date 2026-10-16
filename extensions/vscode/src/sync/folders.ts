import { isInside } from '@conduktor/core';

export function inWorkspace(target: string, folders: readonly string[] | undefined): boolean {
  return (folders ?? []).some((folder) => isInside(folder, target));
}
