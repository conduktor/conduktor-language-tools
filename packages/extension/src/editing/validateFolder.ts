import * as path from 'node:path';
import * as vscode from 'vscode';
import { catalogDocuments, planDocuments, type ReadInclude, type ResourceDocument } from '@conduktor/vscode-core';
import type { SessionManager } from '../connections/session';
import type { Output } from '../output';
import { includeReaderFor } from './includes';
import type { ResourceController } from './resourceController';
import { variablesFor } from './variables';

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
  const origin = new Map<ResourceDocument, { uri: vscode.Uri; read?: (file: string) => string }>();
  const texts = new Map<string, { uri: vscode.Uri; text: string }>();
  for (const uri of uris.filter((u) => foreignEnvironment(u) === undefined)) {
    const text = new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
    const documents = catalogDocuments(text, state.spec.catalog, { env: variablesFor(uri) });
    if (documents.length === 0) continue;
    texts.set(uri.toString(), { uri, text });
    const read = includeReaderFor(uri);
    documents.forEach((document) => origin.set(document, { uri, read }));
  }
  const readInclude: ReadInclude = (file, document) => {
    const source = origin.get(document);
    if (!source?.read) throw new Error(`${source?.uri.fsPath ?? 'the file'} is not a local file`);
    return source.read(file);
  };

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

  const byFile = new Map<string, typeof items>();
  // A cancelled run's unchecked resources keep whatever results their files had.
  for (const item of items.filter((i) => i.outcome.status !== 'skipped')) {
    const key = origin.get(item.document)!.uri.toString();
    byFile.set(key, [...(byFile.get(key) ?? []), item]);
  }
  if (!items.some((i) => i.outcome.status === 'skipped'))
    controller.rememberFolder(
      folder,
      items.flatMap((i) =>
        (i.outcome.status === 'ok' && i.outcome.result === 'Created') || i.outcome.status === 'pending'
          ? [i.document.resource!.metadata.name]
          : [],
      ),
    );
  for (const [key, fileItems] of byFile) {
    const { uri, text } = texts.get(key)!;
    controller.recordFolderResults(uri, text, fileItems);
  }

  const result: FolderValidation = {
    files: byFile.size,
    resources: items.length,
    failed: items.filter((i) => i.outcome.status === 'error').length,
    pending: items.filter((i) => i.outcome.status === 'pending').length,
    cancelled: items.some((i) => i.outcome.status === 'skipped'),
  };
  for (const item of items) {
    if (item.outcome.status !== 'error') continue;
    const file = path.relative(folder.fsPath, origin.get(item.document)!.uri.fsPath);
    output.warn(
      `${file}: ${item.document.kind} ${item.document.resource?.metadata.name ?? ''}: ${item.outcome.message}`,
    );
  }
  const summary =
    `Validated ${result.resources} resources in ${result.files} files on ${state.connection.name}: ` +
    `${result.failed} failed, ${result.pending} pending${result.cancelled ? ', cancelled before the end' : ''}.`;
  output.info(summary);
  const show = result.failed > 0 ? vscode.window.showWarningMessage : vscode.window.showInformationMessage;
  void show(summary, 'Show Output').then((choice) => {
    if (choice) output.show();
  });
  return result;
}
