import type { UpsertResult } from '../resources/types';
import { splitPolicyMessages } from './messages';
import type { UpsertItem, UpsertOutcome } from './upsertDocuments';

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

/**
 * What a dry run or apply has to say about a resource, for an editor to show on its first line: one error per policy
 * rule, or why it can only be checked when applied. A success has nothing to say. `where` tells where the resources it
 * waits for are created.
 */
export function outcomeProblems(
  outcome: UpsertOutcome,
  where: string,
): { message: string; severity: 'error' | 'warning' }[] {
  if (outcome.status === 'error')
    return splitPolicyMessages(outcome.message).map((message) => ({ message, severity: 'error' }));
  if (outcome.status === 'pending')
    return [
      {
        message: `Checked when applied: waits for ${outcome.waitingFor.join(', ')}, created ${where}. The Console says: ${outcome.message}`,
        severity: 'warning',
      },
    ];
  return [];
}
