import * as vscode from 'vscode';
import { stringify } from 'yaml';
import {
  canChange,
  describeError,
  itemPath,
  kebabCase,
  parentsOf,
  withSecretPlaceholders,
  type KindCatalog,
  type KindVersion,
} from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { SessionManager } from '../connections/session';
import { isLiveScheme, parseLiveUriParts } from '../liveFs/uris';
import type { ResourceNode } from './explorerModel';
import type { ExplorerProvider } from './explorerProvider';

interface Target {
  kind: KindVersion;
  parents: string[];
  name: string;
}

export function registerResourceCommands(
  sessions: SessionManager,
  explorer: ExplorerProvider,
  confirm: Confirm,
  onDeleted: () => void,
): vscode.Disposable[] {
  return [
    vscode.commands.registerCommand('conduktor.copyToWorkspace', (target?: ResourceNode | vscode.Uri) =>
      copyToWorkspace(sessions, target),
    ),
    vscode.commands.registerCommand('conduktor.deleteResource', (node: ResourceNode) =>
      deleteResource(sessions, explorer, confirm, node, onDeleted),
    ),
  ];
}

async function copyToWorkspace(sessions: SessionManager, target?: ResourceNode | vscode.Uri): Promise<void> {
  const state = sessions.current();
  if (state.status !== 'ready') {
    void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
    return;
  }
  const resolved = resolveTarget(state.spec.catalog, target);
  if (!resolved) {
    void vscode.window.showWarningMessage('Pick a Console resource to copy.');
    return;
  }
  const { kind, parents, name } = resolved;
  try {
    const resource = await state.client.get(itemPath(kind, parentsOf(kind, parents), name));
    const folder = vscode.workspace.workspaceFolders?.[0];
    const file = `${kebabCase(kind.kind)}-${name}.yaml`;
    const destination = await vscode.window.showSaveDialog({
      title: `Copy ${kind.kind} ${name} to the workspace`,
      defaultUri: folder ? vscode.Uri.joinPath(folder.uri, file) : undefined,
      filters: { YAML: ['yaml', 'yml'] },
    });
    if (!destination) return;
    const { resource: copy, variables } = withSecretPlaceholders(resource, parents);
    await vscode.workspace.fs.writeFile(destination, new TextEncoder().encode(stringify(copy)));
    await vscode.window.showTextDocument(destination);
    if (variables.length > 0) {
      void vscode.window.showInformationMessage(
        `Secrets were left out of the copy; set ${variables.join(', ')} before applying it.`,
      );
    }
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not copy ${kind.kind} ${name}: ${describeError(error)}`);
  }
}

async function deleteResource(
  sessions: SessionManager,
  explorer: ExplorerProvider,
  confirm: Confirm,
  node: ResourceNode,
  onDeleted: () => void,
): Promise<void> {
  const state = sessions.current();
  if (state.status !== 'ready' || !canChange(state.connection.mode)) {
    void vscode.window.showWarningMessage('Deleting needs a connection in dev mode ("Conduktor: Change Mode").');
    return;
  }
  const subject = `${node.kind.kind} ${node.name}`;
  const where = node.parents.length > 0 ? ` (${node.parents.join(' / ')})` : '';
  const choice = await confirm(
    `Delete ${subject} from ${state.connection.name}?`,
    `This deletes ${subject}${where} from the Console. It cannot be undone.`,
    'Delete',
  );
  if (choice !== 'Delete') return;
  try {
    await state.client.delete(itemPath(node.kind, parentsOf(node.kind, node.parents), node.name));
    void vscode.window.showInformationMessage(`Deleted ${subject} from ${state.connection.name}.`);
    onDeleted();
    explorer.refresh();
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not delete ${subject}: ${describeError(error)}`);
  }
}

function resolveTarget(catalog: KindCatalog, target: ResourceNode | vscode.Uri | undefined): Target | undefined {
  if (target && !(target instanceof vscode.Uri))
    return { kind: target.kind, parents: target.parents, name: target.name };
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  if (!uri || !isLiveScheme(uri.scheme)) return undefined;
  const ref = parseLiveUriParts(uri.authority, uri.path);
  const kind = ref && catalog.resolve(`v${ref.version}`, ref.kind);
  return ref && kind ? { kind, parents: ref.parents, name: ref.name } : undefined;
}
