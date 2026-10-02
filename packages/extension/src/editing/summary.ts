import type { UpsertItem, UpsertResult } from '@conduktor/vscode-core';

const RESULTS: UpsertResult[] = ['Created', 'Updated', 'NotChanged'];

export function summarise(connectionName: string, items: readonly UpsertItem[]): { text: string; failed: number } {
  const count = (result: UpsertResult) =>
    items.filter((i) => i.outcome.status === 'ok' && i.outcome.result === result).length;
  const failed = items.filter((i) => i.outcome.status === 'error').length;
  const parts = RESULTS.map((result) => [count(result), result] as const)
    .filter(([n]) => n > 0)
    .map(([n, result]) => `${n} ${result}`);
  if (failed > 0) parts.push(`${failed} failed`);
  return { text: `Dry run on ${connectionName}: ${parts.join(', ')}`, failed };
}
