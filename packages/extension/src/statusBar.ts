import * as vscode from 'vscode';
import { describeToken } from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from './connections/session';

export function createStatusBar(sessions: SessionManager): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
  item.command = 'conduktor.switchConnection';

  const render = (state: SessionState) => {
    if (state.status === 'none') {
      item.hide();
      return;
    }
    const { connection } = state;
    const detail =
      state.status === 'ready'
        ? `${state.capability} · ${connection.mode}`
        : state.status === 'loading'
          ? 'connecting…'
          : 'offline';
    item.text = `$(plug) ${connection.name} · ${detail}`;
    item.tooltip =
      state.status === 'ready'
        ? `${connection.url}\n${describeToken(state.token)}\nOpenAPI: ${state.spec.source}`
        : state.status === 'error'
          ? state.message
          : connection.url;
    item.backgroundColor =
      state.status === 'error'
        ? new vscode.ThemeColor('statusBarItem.errorBackground')
        : connection.mode === 'apply'
          ? new vscode.ThemeColor('statusBarItem.warningBackground')
          : undefined;
    item.show();
  };

  render(sessions.current());
  return vscode.Disposable.from(item, sessions.onDidChange(render));
}
