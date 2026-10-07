import { randomUUID } from 'node:crypto';
import * as vscode from 'vscode';
import {
  capabilityOf,
  ConsoleClient,
  describeError,
  describeToken,
  normaliseBaseUrl,
  type ConnectionMode,
  type TokenInfo,
} from '@conduktor/vscode-core';
import type { ConnectionStore } from './connectionStore';
import type { SessionManager } from './session';

const MODES: (vscode.QuickPickItem & { mode: ConnectionMode })[] = [
  { mode: 'prod', label: 'Prod', description: 'Never changes the Console: browse, dry run, diff, plan' },
  {
    mode: 'dev',
    label: 'Dev',
    description: 'Can change the Console: apply, save live documents, delete, after a confirmation',
  },
];

export function registerConnectionCommands(store: ConnectionStore, sessions: SessionManager): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('conduktor.addConnection', () => addConnection(store, sessions)),
    vscode.commands.registerCommand('conduktor.removeConnection', () => removeConnection(store)),
    vscode.commands.registerCommand('conduktor.switchConnection', () => switchConnection(store)),
    vscode.commands.registerCommand('conduktor.changeMode', () => changeMode(store)),
  ];
}

async function addConnection(store: ConnectionStore, sessions: SessionManager): Promise<void> {
  const url = await vscode.window.showInputBox({
    title: 'Conduktor Console URL',
    value: 'http://localhost:8080',
    ignoreFocusOut: true,
    validateInput: (value) => (/^https?:\/\/\S+$/.test(value.trim()) ? undefined : 'Enter an http(s) URL'),
  });
  if (!url) return;
  const token = (
    await vscode.window.showInputBox({
      title: 'Personal access token or admin API key',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => (value.trim() ? undefined : 'A token is required'),
    })
  )?.trim();
  if (!token) return;

  let info: TokenInfo;
  try {
    info = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Checking the token…' },
      () => new ConsoleClient({ baseUrl: url, token, userAgent: sessions.userAgent }).whoami(),
    );
    capabilityOf(info);
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not connect: ${describeError(error)}`);
    return;
  }

  const name = await vscode.window.showInputBox({
    title: 'Connection name',
    value: new URL(url.trim()).host,
    ignoreFocusOut: true,
  });
  if (!name) return;
  const mode = await vscode.window.showQuickPick(MODES, { title: 'What may this connection change?' });
  if (!mode) return;

  await store.add({ id: randomUUID(), name, url: normaliseBaseUrl(url), mode: mode.mode }, token);
  void vscode.window.showInformationMessage(`Connected to ${name} as ${describeToken(info)}.`);
}

async function removeConnection(store: ConnectionStore): Promise<void> {
  const picked = await pickConnection(store, 'Remove which connection?');
  if (!picked) return;
  const confirm = await vscode.window.showWarningMessage(
    `Remove ${picked.label} and forget its token?`,
    { modal: true },
    'Remove',
  );
  if (confirm === 'Remove') await store.remove(picked.id);
}

async function switchConnection(store: ConnectionStore): Promise<void> {
  const picked = await pickConnection(store, 'Switch to which connection?');
  if (picked) await store.setActive(picked.id);
}

async function changeMode(store: ConnectionStore): Promise<void> {
  const connection = store.active();
  if (!connection) {
    void vscode.window.showInformationMessage('No Conduktor connections yet.');
    return;
  }
  const items = MODES.map((m) =>
    m.mode === connection.mode ? { ...m, description: `${m.description} (current)` } : m,
  );
  const picked = await vscode.window.showQuickPick(items, { title: `What may ${connection.name} change?` });
  if (picked && picked.mode !== connection.mode) await store.update({ ...connection, mode: picked.mode });
}

async function pickConnection(store: ConnectionStore, title: string) {
  const active = store.active();
  const items = store.all().map((c) => ({
    id: c.id,
    label: c.name,
    description: `${c.url} · ${c.mode}`,
    picked: c.id === active?.id,
  }));
  if (items.length === 0) {
    void vscode.window.showInformationMessage('No Conduktor connections yet.');
    return undefined;
  }
  return vscode.window.showQuickPick(items, { title });
}
