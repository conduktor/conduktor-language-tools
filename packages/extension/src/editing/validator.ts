import * as vscode from 'vscode';
import type { SessionManager } from '../connections/session';
import type { ResourceController } from './resourceController';

const DEBOUNCE_MS = 500;
const AT_ONCE = 2;

/**
 * Dry-runs Conduktor YAML files as they are opened and saved, and the open ones again when the session changes —
 * a debounced, two-at-a-time queue, so restoring a window full of tabs never floods the Console.
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
  ) {
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument((document) => this.schedule(document)),
      vscode.workspace.onDidSaveTextDocument((document) => this.schedule(document)),
      sessions.onDidChange((state) => {
        if (state.status === 'ready') vscode.workspace.textDocuments.forEach((document) => this.schedule(document));
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
    this.listeners.forEach((listener) => listener.dispose());
    this.timers.forEach((timer) => clearTimeout(timer));
  }

  private schedule(document: vscode.TextDocument): void {
    const { uri } = document;
    if (document.languageId !== 'yaml' || uri.scheme !== 'file' || !this.enabled() || this.skip(uri)) return;
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

  private pump(): void {
    while (this.running < AT_ONCE && this.queue.length > 0) {
      const uri = this.queue.shift()!;
      this.running++;
      this.highest = Math.max(this.highest, this.running);
      void this.controller
        .validate(uri)
        .catch(() => undefined)
        .finally(() => {
          this.running--;
          this.pump();
          if (!this.busy()) this.idle.splice(0).forEach((resolve) => resolve());
        });
    }
  }

  private busy(): boolean {
    return this.timers.size > 0 || this.queue.length > 0 || this.running > 0;
  }

  private enabled(): boolean {
    return vscode.workspace.getConfiguration('conduktor.validation').get<boolean>('onOpenAndSave', true);
  }
}
