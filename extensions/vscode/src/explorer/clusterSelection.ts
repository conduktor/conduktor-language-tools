import * as vscode from 'vscode';
import { describeError, listPath } from '@conduktor/core';
import type { SessionManager, SessionState } from '../connections/session';
import { settleCluster } from './settleCluster';

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
    if (this.sessions.current() === state) await this.show(cluster);
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
    if (picked && this.sessions.current() === state) await this.set(picked.label);
    return picked?.label;
  }

  dispose(): void {
    this.sessionListener.dispose();
    this.changed.dispose();
  }

  private settle(state: Ready): Promise<void> {
    return settleCluster(state, () => clusterNames(state), {
      isCurrent: (candidate) => this.sessions.current() === candidate,
      remembered: (candidate) => this.context.globalState.get<string>(key(candidate.connection.id)),
      remember: (candidate, cluster) => this.context.globalState.update(key(candidate.connection.id), cluster),
      show: (cluster) => this.show(cluster),
    });
  }

  private async show(cluster: string | undefined): Promise<void> {
    await vscode.commands.executeCommand('setContext', 'conduktor.cluster', cluster);
    this.changed.fire(cluster);
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
