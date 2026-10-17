import * as vscode from 'vscode';
import type { RequestEvent } from '@conduktor/core';

export class Output implements vscode.Disposable {
  private readonly channel = vscode.window.createOutputChannel('Conduktor', { log: true });

  request(event: RequestEvent): void {
    this.channel.info(`${event.method} ${event.path} → ${event.status} (${event.durationMs} ms)`);
  }

  info(message: string): void {
    this.channel.info(message);
  }

  warn(message: string): void {
    this.channel.warn(message);
  }

  error(message: string): void {
    this.channel.error(message);
  }

  show(): void {
    this.channel.show(true);
  }

  /** A notification with a Show Output button that opens this log. */
  offer(notify: (message: string, ...items: string[]) => Thenable<string | undefined>, message: string): void {
    void notify(message, 'Show Output').then((choice) => {
      if (choice) this.show();
    });
  }

  /** A failure offers to open this log; a success is only said. */
  report(message: string, failed: boolean): void {
    if (failed) this.offer(vscode.window.showWarningMessage, message);
    else void vscode.window.showInformationMessage(message);
  }

  dispose(): void {
    this.channel.dispose();
  }
}
