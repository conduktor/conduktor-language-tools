import type { UpsertItem, UpsertOutcome, UpsertResult } from '@conduktor/vscode-core';

const RESULTS: UpsertResult[] = ['Created', 'Updated', 'NotChanged'];

export function summarise(
  connectionName: string,
  items: readonly UpsertItem[],
  heading = 'Dry run on',
): { text: string; failed: number } {
  const count = (result: UpsertResult) =>
    items.filter((i) => i.outcome.status === 'ok' && i.outcome.result === result).length;
  const failed = items.filter((i) => i.outcome.status === 'error').length;
  const parts = RESULTS.map((result) => [count(result), result] as const)
    .filter(([n]) => n > 0)
    .map(([n, result]) => `${n} ${result}`);
  if (failed > 0) parts.push(`${failed} failed`);
  return { text: `${heading} ${connectionName}: ${parts.join(', ')}`, failed };
}

const RESULT_LABELS: Record<UpsertResult, string> = {
  Created: '+ Created',
  Updated: '~ Updated',
  NotChanged: '= NotChanged',
};

export function outcomeLabel(outcome: UpsertOutcome): string {
  return outcome.status === 'ok' ? RESULT_LABELS[outcome.result] : '✗ failed';
}
