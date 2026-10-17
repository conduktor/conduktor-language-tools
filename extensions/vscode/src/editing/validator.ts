import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import type { ResourceController } from './resourceController';

const DEBOUNCE_MS = 500;
const AT_ONCE = 2;

/**
 * Dry-runs the Conduktor YAML files open in an editor as they are opened and saved, and again when the session changes
 * — a debounced, two-at-a-time queue, so restoring a window full of tabs never floods the Console. A file that already
 * has current results (a folder's run, say) is only checked again when saved.
 */
export class Validator implements vscode.Disposable {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue: vscode.Uri[] = [];
  private running = 0;
  private highest = 0;
  private idle: (() => void)[] = [];
  private readonly listeners: vscode.Disposable[];

  constructor(
    sessions: SessionManager,
    private readonly controller: ResourceController,
    private readonly skip: (uri: vscode.Uri) => boolean,
    private readonly localNames: (uri: vscode.Uri) => Promise<string[]>,
  ) {
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document, false)),
      vscode.workspace.onDidSaveTextDocument((document) => this.schedule(document, true)),
      vscode.workspace.onDidCloseTextDocument((document) => this.forget(document.uri)),
      // A document VS Code loaded in the background is opened only once: its first tab is what shows it to the user.
      vscode.window.tabGroups.onDidChangeTabs(({ opened }) => {
        const shown = new Set(
          opened.flatMap((tab) => (tab.input instanceof vscode.TabInputText ? [tab.input.uri.toString()] : [])),
        );
        vscode.workspace.textDocuments
          .filter((document) => shown.has(document.uri.toString()))
          .forEach((document) => this.schedule(document, false));
      }),
      sessions.onDidChange((state) => {
        if (state.status === 'ready')
          vscode.workspace.textDocuments.forEach((document) => this.schedule(document, false));
      }),
    ];
  }

  /** Resolves once nothing is waiting or running. */
  settled(): Promise<void> {
    return this.busy() ? new Promise((resolve) => this.idle.push(resolve)) : Promise.resolve();
  }

  /** The most validations that ran at once since the last reset. */
  peak(): number {
    return this.highest;
  }

  resetPeak(): void {
    this.highest = 0;
  }

  dispose(): void {
    for (const listener of this.listeners) listener.dispose();
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  private schedule(document: vscode.TextDocument, saved: boolean): void {
    const { uri } = document;
    if (document.languageId !== 'yaml' || uri.scheme !== 'file' || !this.enabled() || this.skip(uri)) return;
    if (!saved && this.controller.hasResults(uri)) return;
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        if (!this.queue.some((queued) => queued.toString() === key)) this.queue.push(uri);
        this.pump();
      }, DEBOUNCE_MS),
    );
  }

  private forget(uri: vscode.Uri): void {
    const key = uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    const queued = this.queue.findIndex((waiting) => waiting.toString() === key);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.wake();
  }

  private pump(): void {
    while (this.running < AT_ONCE) {
      const uri = this.queue.shift();
      if (!uri) break;
      // Only what the user has open: VS Code also loads documents for other reasons (the CLI's Problems, a search).
      if (!shownInTab(uri)) continue;
      this.running++;
      this.highest = Math.max(this.highest, this.running);
      void this.localNames(uri)
        .then((names) => this.controller.validate(uri, names))
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
          this.wake();
        });
    }
    this.wake();
  }

  private wake(): void {
    if (!this.busy()) this.idle.splice(0).forEach((resolve) => resolve());
  }

  private busy(): boolean {
    return this.timers.size > 0 || this.queue.length > 0 || this.running > 0;
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('conduktor.validation').get<boolean>('onOpenAndSave', true);
  }
}

function shownInTab(uri: vscode.Uri): boolean {
  const key = uri.toString();
  return vscode.window.tabGroups.all.some((group) =>
    group.tabs.some((tab) => tab.input instanceof vscode.TabInputText && tab.input.uri.toString() === key),
  );
}
