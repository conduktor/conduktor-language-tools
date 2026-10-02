import * as vscode from 'vscode';
import { describeError, listPath } from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';

type Ready = Extract<SessionState, { status: 'ready' }>;

export class ClusterSelection implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<string | undefined>();
  readonly onDidChange = this.changed.event;
  private readonly sessionListener: vscode.Disposable;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly sessions: SessionManager,
  ) {
    this.sessionListener = sessions.onDidChange((state) => {
      if (state.status === 'ready') void this.settle(state);
    });
  }

  current(): string | undefined {
    const state = this.sessions.current();
    return state.status === 'ready' ? this.context.globalState.get<string>(key(state.connection.id)) : undefined;
  }

  async set(cluster: string | undefined): Promise<void> {
    const state = this.sessions.current();
    if (state.status !== 'ready') return;
    await this.context.globalState.update(key(state.connection.id), cluster);
    await vscode.commands.executeCommand('setContext', 'conduktor.cluster', cluster);
    this.changed.fire(cluster);
  }

  async pick(): Promise<string | undefined> {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
      return undefined;
    }
    let names: string[];
    try {
      names = await clusterNames(state);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not list clusters: ${describeError(error)}`);
      return undefined;
    }
    const current = this.current();
    const picked = await vscode.window.showQuickPick(
      names.map((name) => ({ label: name, description: name === current ? 'selected' : undefined })),
      { title: `Which cluster on ${state.connection.name}?` },
    );
    if (picked) await this.set(picked.label);
    return picked?.label;
  }

  dispose(): void {
    this.sessionListener.dispose();
    this.changed.dispose();
  }

  // Keeps a remembered cluster only while it exists, and picks the only cluster there is.
  private async settle(state: Ready): Promise<void> {
    let names: string[];
    try {
      names = await clusterNames(state);
    } catch {
      return;
    }
    const current = this.current();
    if (current && names.includes(current)) {
      await vscode.commands.executeCommand('setContext', 'conduktor.cluster', current);
      this.changed.fire(current);
      return;
    }
    await this.set(names.length === 1 ? names[0] : undefined);
  }
}

async function clusterNames(state: Ready): Promise<string[]> {
  const kind = state.spec.catalog.latest('KafkaCluster');
  if (!kind) return [];
  return (await state.client.list(listPath(kind, {}))).map((r) => r.metadata.name).sort((a, b) => a.localeCompare(b));
}

function key(connectionId: string): string {
  return `conduktor.cluster.${connectionId}`;
}
