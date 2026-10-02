import type { UpsertItem } from '@conduktor/vscode-core';

// The text sent to the Console, once all of the file is there: it becomes the file's base in the sync folder.
export function appliedText(text: string, documentsInFile: number, items: readonly UpsertItem[]): string | undefined {
  return items.length === documentsInFile && items.every((item) => item.outcome.status === 'ok') ? text : undefined;
}
