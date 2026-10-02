import * as vscode from 'vscode';
import type { ConnectionMode } from '@conduktor/vscode-core';

export interface Connection {
  id: string;
  name: string;
  url: string;
  mode: ConnectionMode;
}

const SECTION = 'conduktor';
const SETTING = 'connections';
const ACTIVE_KEY = 'conduktor.activeConnection';
const tokenKey = (id: string) => `conduktor.token.${id}`;

export class ConnectionStore implements vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private readonly configListener: vscode.Disposable;

  constructor(private readonly context: vscode.ExtensionContext) {
    this.configListener = vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(`${SECTION}.${SETTING}`)) this.changed.fire();
    });
  }

  all(): Connection[] {
    return vscode.workspace.getConfiguration(SECTION).get<Connection[]>(SETTING, []);
  }

  active(): Connection | undefined {
    const id = this.context.globalState.get<string>(ACTIVE_KEY);
    const connections = this.all();
    return connections.find((c) => c.id === id) ?? connections[0];
  }

  async add(connection: Connection, token: string): Promise<void> {
    await this.context.secrets.store(tokenKey(connection.id), token);
    await this.save([...this.all().filter((c) => c.id !== connection.id), connection]);
    await this.setActive(connection.id);
  }

  async update(connection: Connection): Promise<void> {
    await this.save(this.all().map((c) => (c.id === connection.id ? connection : c)));
  }

  async remove(id: string): Promise<void> {
    await this.context.secrets.delete(tokenKey(id));
    await this.save(this.all().filter((c) => c.id !== id));
  }

  async setActive(id: string): Promise<void> {
    await this.context.globalState.update(ACTIVE_KEY, id);
    this.changed.fire();
  }

  token(id: string): Thenable<string | undefined> {
    return this.context.secrets.get(tokenKey(id));
  }

  dispose(): void {
    this.configListener.dispose();
    this.changed.dispose();
  }

  private async save(connections: Connection[]): Promise<void> {
    await vscode.workspace.getConfiguration(SECTION).update(SETTING, connections, vscode.ConfigurationTarget.Global);
  }
}
