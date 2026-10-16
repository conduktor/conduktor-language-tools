import * as vscode from 'vscode';

export type Confirm = (message: string, detail: string, ...actions: string[]) => Promise<string | undefined>;

export const modalConfirm: Confirm = async (message, detail, ...actions) =>
  vscode.window.showWarningMessage(message, { modal: true, detail }, ...actions);
