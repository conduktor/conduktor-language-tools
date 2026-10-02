import type { UpsertItem, UpsertOutcome, UpsertResult } from '@conduktor/vscode-core';

const RESULTS: UpsertResult[] = ['Created', 'Updated', 'NotChanged'];

export function summarise(
  connectionName: string,
  items: readonly UpsertItem[],
  heading = 'Dry run on',
): { text: string; failed: number } {
  const count = (result: UpsertResult) =>
    items.filter((i) => i.outcome.status === 'ok' && i.outcome.result === result).length;
  const having = (status: UpsertOutcome['status']) => items.filter((i) => i.outcome.status === status).length;
  const failed = having('error');
  const parts = RESULTS.map((result) => [count(result), result] as const)
    .filter(([n]) => n > 0)
    .map(([n, result]) => `${n} ${result}`);
  if (having('pending') > 0) parts.push(`${having('pending')} checked when applied`);
  if (failed > 0) parts.push(`${failed} failed`);
  if (having('skipped') > 0) parts.push(`${having('skipped')} skipped`);
  return { text: `${heading} ${connectionName}: ${parts.join(', ')}`, failed };
}

const RESULT_LABELS: Record<UpsertResult, string> = {
  Created: '+ Created',
  Updated: '~ Updated',
  NotChanged: '= NotChanged',
};

export function outcomeLabel(outcome: UpsertOutcome): string {
  switch (outcome.status) {
    case 'ok':
      return RESULT_LABELS[outcome.result];
    case 'pending':
      return '⏳ pending';
    case 'error':
      return '✗ failed';
    case 'skipped':
      return '– skipped';
  }
}
