import * as vscode from 'vscode';
import type { RequestEvent } from '@conduktor/vscode-core';

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

  dispose(): void {
    this.channel.dispose();
  }
}
