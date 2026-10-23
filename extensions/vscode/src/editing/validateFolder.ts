import * as path from 'node:path';
import * as vscode from 'vscode';
import { outcomes, planDocuments } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { Output } from '../output';
import { fileDocuments, type Source } from './includes';
import type { ResourceController } from './resourceController';
import { track } from '../telemetry';

export interface FolderValidation {
  files: number;
  resources: number;
  failed: number;
  pending: number;
  cancelled: boolean;
}

const LEFT_OUT = '**/{.git,node_modules,.conduktor}/**';

/**
 * Dry-runs every Conduktor YAML under a folder as one plan, so a resource waiting for one created in another of its
 * files reads as pending, and puts the results on each file.
 */
export async function validateFolder(
  sessions: SessionManager,
  controller: ResourceController,
  output: Output,
  foreignEnvironment: (uri: vscode.Uri) => string | undefined,
  folder: vscode.Uri,
  options: { cancelled?: () => boolean } = {},
): Promise<FolderValidation | undefined> {
  const state = sessions.current();
  if (state.status !== 'ready') {
    void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
    return undefined;
  }
  const uris = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*.{yaml,yml}'), LEFT_OUT);
  const files = uris.filter((uri) => foreignEnvironment(uri) === undefined).map((uri) => ({ uri }));
  const { origin, readInclude } = await fileDocuments(files, state.spec.catalog, (file) => file.uri.fsPath);

  const items = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Validating ${path.basename(folder.fsPath)}`,
      cancellable: true,
    },
    (progress, token) => {
      let reported = 0;
      return planDocuments(state.client, state.spec.catalog, [...origin.keys()], {
        readInclude,
        cancelled: () =>
          token.isCancellationRequested || options.cancelled?.() === true || sessions.current() !== state,
        onItem: (done, total) => {
          progress.report({ message: `${done} of ${total} resources`, increment: ((done - reported) / total) * 100 });
          reported = done;
        },
      });
    },
  );
  // The answers belong to the Console that gave them; after a switch they would describe another.
  if (sessions.current() !== state) {
    void vscode.window.showWarningMessage('The connection changed while validating the folder; run it again.');
    return undefined;
  }

  const byFile = new Map<Source<{ uri: vscode.Uri }>, typeof items>();
  // A cancelled run's unchecked resources keep whatever results their files had.
  for (const item of items.filter((i) => i.outcome.status !== 'skipped')) {
    const source = origin.get(item.document);
    if (source) byFile.set(source, [...(byFile.get(source) ?? []), item]);
  }
  if (!items.some((i) => i.outcome.status === 'skipped'))
    controller.rememberFolder(
      folder,
      items.flatMap(({ document: { resource }, outcome }) =>
        resource && ((outcome.status === 'ok' && outcome.result === 'Created') || outcome.status === 'pending')
          ? [resource.metadata.name]
          : [],
      ),
    );
  for (const [{ file, text }, fileItems] of byFile) controller.recordFolderResults(file.uri, text, fileItems);

  track({ name: 'folder.Validated', properties: outcomes(items, state.spec.catalog) });
  const result: FolderValidation = {
    files: byFile.size,
    resources: items.length,
    failed: items.filter((i) => i.outcome.status === 'error').length,
    pending: items.filter((i) => i.outcome.status === 'pending').length,
    cancelled: items.some((i) => i.outcome.status === 'skipped'),
  };
  for (const item of items) {
    const source = origin.get(item.document);
    if (item.outcome.status !== 'error' || !source) continue;
    const file = path.relative(folder.fsPath, source.file.uri.fsPath);
    output.warn(
      `${file}: ${item.document.kind} ${item.document.resource?.metadata.name ?? ''}: ${item.outcome.message}`,
    );
  }
  const summary =
    `Validated ${result.resources} resources in ${result.files} files on ${state.connection.name}: ` +
    `${result.failed} failed, ${result.pending} pending${result.cancelled ? ', cancelled before the end' : ''}.`;
  output.info(summary);
  output.offer(result.failed > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage, summary);
  return result;
}
