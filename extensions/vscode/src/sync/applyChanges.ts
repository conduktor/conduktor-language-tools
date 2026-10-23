import * as vscode from 'vscode';
import { canChange, outcomes, planDocuments, summarise, upsertDocuments, type UpsertItem } from '@conduktor/core';
import type { Confirm } from '../confirm';
import type { SessionManager } from '../connections/session';
import { fileDocuments } from '../editing/includes';
import { isInView } from '../explorer/explorerModel';
import type { Output } from '../output';
import { driftNotes, sharedIdentities } from './conflicts';
import type { SyncFolder } from './syncFolder';
import { track } from '../telemetry';

export async function applyAllChanges(
  sessions: SessionManager,
  sync: SyncFolder,
  confirm: Confirm,
  output: Output,
  cluster: string | undefined,
): Promise<UpsertItem[] | undefined> {
  const state = sessions.current();
  if (state.status !== 'ready' || !canChange(state.connection.mode)) {
    void vscode.window.showWarningMessage('Applying needs a connection in dev mode ("Conduktor: Change Mode").');
    return undefined;
  }
  await saveOpenChanges(sync);
  await sync.refresh({ drift: true });
  const changed = sync
    .list()
    .filter((entry) => entry.status !== 'synced' && isInView(state.spec.catalog, cluster, entry));
  if (changed.length === 0) {
    void vscode.window.showInformationMessage('No local changes to apply.');
    return [];
  }
  const shared = sharedIdentities(changed);
  if (shared.length > 0) {
    void vscode.window.showWarningMessage(
      `Several files describe the same resource, so nothing was applied. Keep one of each: ${shared.join('; ')}.`,
    );
    return undefined;
  }

  const { origin, readInclude } = await fileDocuments(changed, state.spec.catalog, (entry) => entry.path);
  const documents = [...origin.keys()];
  const name = state.connection.name;
  const fileOf = (item: UpsertItem) => origin.get(item.document)?.file.path ?? '?';

  const plan = await planDocuments(state.client, state.spec.catalog, documents, { readInclude });
  track({ name: 'resources.Checked', properties: outcomes(plan, state.spec.catalog) });
  const preview = summarise(name, plan);
  output.info(preview.text);
  plan.forEach((item) => output.info(`  ${fileOf(item)}: ${describe(item)}`));
  if (preview.failed > 0) {
    output.offer(vscode.window.showWarningMessage, `${preview.text}. Fix the failures first.`);
    return plan;
  }

  const overwrites = plan
    .filter((item) => item.outcome.status === 'ok' && item.outcome.result === 'Updated')
    .flatMap((item) => {
      const entry = origin.get(item.document)?.file;
      return entry?.status === 'new' ? [entry.path] : [];
    });
  const detail = [
    preview.text,
    plan.some((item) => item.outcome.status === 'pending') &&
      'Some can only be checked once the resources before them exist. Resources are applied one at a time, in order, stopping at the first failure.',
    ...driftNotes(changed),
    overwrites.length > 0 &&
      `New files for resources that already exist, which they will replace: ${overwrites.join(', ')}.`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const scope = cluster ? `global resources and cluster ${cluster}` : 'global resources';
  if ((await confirm(`Apply ${changed.length} local changes to ${name} (${scope})?`, detail, 'Apply')) !== 'Apply')
    return plan;

  const items = await upsertDocuments(state.client, state.spec.catalog, documents, {
    dryRun: false,
    readInclude,
    stopOnError: true,
  });
  track({ name: 'resources.Applied', properties: { ...outcomes(items, state.spec.catalog), from: 'changes' } });
  const result = summarise(name, items, 'Applied to');
  output.info(result.text);
  items.forEach((item) => output.info(`  ${fileOf(item)}: ${describe(item)}`));

  for (const { file: entry, text } of new Set(origin.values())) {
    const own = items.filter((item) => origin.get(item.document)?.file === entry);
    if (own.every((item) => item.outcome.status === 'ok')) await sync.markApplied(entry.uri, text);
  }
  output.report(result.text, result.failed > 0);
  return items;
}

async function saveOpenChanges(sync: SyncFolder): Promise<void> {
  for (const document of vscode.workspace.textDocuments) {
    if (document.isDirty && sync.contains(document.uri)) await document.save();
  }
}

function describe(item: UpsertItem): string {
  const { outcome } = item;
  const subject = `${item.document.kind} ${item.document.resource?.metadata.name ?? ''}`.trim();
  switch (outcome.status) {
    case 'ok':
      return `${subject} ${outcome.result}`;
    case 'pending':
      return `${subject} checked when applied (waits for ${outcome.waitingFor.join(', ')})`;
    case 'error':
      return `${subject} failed: ${outcome.message}`;
    case 'skipped':
      return `${subject} skipped after an earlier failure`;
  }
}
