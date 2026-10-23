import * as vscode from 'vscode';
import {
  catalogDocuments,
  comparableYaml,
  ConsoleError,
  describeError,
  expandIncludes,
  kindOf,
  resourcePath,
  type Resource,
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { includeReaderFor } from './includes';
import { variablesFor } from './variables';
import { track } from '../telemetry';

const COMPARE_SCHEME = 'conduktor-compare';

export class Compare implements vscode.TextDocumentContentProvider, vscode.Disposable {
  // The live side holds the Console's version, secrets included, so it is kept only while its diff is open.
  private readonly contents = new Map<string, string>();
  private readonly registrations: vscode.Disposable[];
  private next = 0;

  constructor(private readonly sessions: SessionManager) {
    this.registrations = [
      vscode.workspace.registerTextDocumentContentProvider(COMPARE_SCHEME, this),
      vscode.workspace.onDidCloseTextDocument((document) => this.contents.delete(document.uri.toString())),
      vscode.window.tabGroups.onDidChangeTabs(({ closed }) => {
        for (const { input } of closed) {
          if (input instanceof vscode.TabInputTextDiff)
            [input.original, input.modified].forEach((uri) => this.contents.delete(uri.toString()));
        }
      }),
    ];
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? '';
  }

  async diffWithLive(uri: vscode.Uri, index?: number): Promise<void> {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return;
    }
    const document = await vscode.workspace.openTextDocument(uri);
    const documents = catalogDocuments(document.getText(), state.spec.catalog, { env: variablesFor(uri) });
    // Without an index (the editor title, the palette) the document under the cursor is the one meant.
    const shown = (editor: vscode.TextEditor | undefined) => editor?.document.uri.toString() === uri.toString();
    const editor = shown(vscode.window.activeTextEditor)
      ? vscode.window.activeTextEditor
      : vscode.window.visibleTextEditors.find(shown);
    const cursor = editor ? document.offsetAt(editor.selection.active) : 0;
    const target =
      index === undefined
        ? (documents.find((d) => d.start <= cursor && cursor <= d.end) ?? documents[0])
        : documents.find((d) => d.index === index);
    if (!target) {
      void vscode.window.showWarningMessage('No Conduktor resource to compare in this file.');
      return;
    }
    if (!target.resource) {
      void vscode.window.showErrorMessage(`Cannot compare: ${target.error ?? 'not a Conduktor resource'}`);
      return;
    }
    try {
      await this.diffResource(expandIncludes(target.resource, includeReaderFor(uri)));
      track({ name: 'resource.Diffed', properties: { kind: kindOf(target.kind, state.spec.catalog) } });
    } catch (error) {
      void vscode.window.showErrorMessage(`Cannot compare: ${describeError(error)}`);
    }
  }

  async diffResource(resource: Resource): Promise<void> {
    const state = this.sessions.current();
    if (state.status !== 'ready') throw new Error('Not connected');
    const kind = state.spec.catalog.resolve(resource.apiVersion, resource.kind);
    if (!kind) throw new Error(`${resource.kind} ${resource.apiVersion} is not available on ${state.connection.name}`);

    let live = '';
    let exists = true;
    try {
      live = comparableYaml(await state.client.get(resourcePath(kind, resource)));
    } catch (error) {
      if (!(error instanceof ConsoleError && error.status === 404)) throw error;
      exists = false;
    }
    const id = ++this.next;
    const file = `${resource.kind}-${resource.metadata.name}.yaml`;
    const left = this.put(`/${id}/live/${file}`, live);
    const right = this.put(`/${id}/local/${file}`, comparableYaml(resource));
    const subject = `${resource.kind} ${resource.metadata.name}`;
    const title = exists
      ? `${subject}: ${state.connection.name} ↔ local`
      : `${subject}: not on ${state.connection.name} yet`;
    await vscode.commands.executeCommand('vscode.diff', left, right, title);
  }

  dispose(): void {
    for (const registration of this.registrations) registration.dispose();
    this.contents.clear();
  }

  private put(path: string, text: string): vscode.Uri {
    const uri = vscode.Uri.from({ scheme: COMPARE_SCHEME, path });
    this.contents.set(uri.toString(), text);
    return uri;
  }
}
