import * as vscode from 'vscode';
import { describeError, type KindVersion } from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { ExplorerNode } from '../explorer/explorerModel';
import type { SessionManager } from '../connections/session';
import { LIVE_SCHEME, parseLiveUriParts } from '../liveFs/uris';
import type { SyncFolder } from './syncFolder';

const LARGE_SYNC = 20;

export function registerSyncCommands(
  sync: SyncFolder,
  confirm: Confirm,
  sessions: SessionManager,
): vscode.Disposable[] {
  const guarded =
    <A extends unknown[]>(run: (...args: A) => Promise<unknown>) =>
    async (...args: A) => {
      try {
        await run(...args);
      } catch (error) {
        void vscode.window.showErrorMessage(describeError(error));
      }
    };
  const targetUri = (target?: ExplorerNode | vscode.Uri): vscode.Uri | undefined => {
    if (target instanceof vscode.Uri) return target;
    if (target?.type === 'resource') return sync.entryFor(target.kind.kind, target.parents, target.name)?.uri;
    return vscode.window.activeTextEditor?.document.uri;
  };

  return [
    vscode.commands.registerCommand(
      'conduktor.syncLocally',
      guarded(async (node?: ExplorerNode) => {
        if (node?.type === 'resource') {
          const uri = await sync.syncResource(node.kind, node.parents, node.name);
          await vscode.window.showTextDocument(uri);
          return;
        }
        if (node?.type !== 'kind' && node?.type !== 'parent') {
          void vscode.window.showInformationMessage(
            'Choose Sync Locally on a resource, a kind or a cluster in the tree.',
          );
          return;
        }
        const parents = node.type === 'parent' ? node.parents : [];
        if (parents.length < node.kind.parentPathParams.length) {
          void vscode.window.showInformationMessage(
            `Open a ${node.kind.parentPathParams[parents.length]} under ${node.kind.kind} and sync from there.`,
          );
          return;
        }
        const count = await sync.syncAll(
          node.kind,
          parents,
          async (total) =>
            total <= LARGE_SYNC ||
            (await confirm(
              `Sync ${total} ${node.kind.kind} resources locally?`,
              'Each becomes a file in the sync folder.',
              'Sync',
            )) === 'Sync',
        );
        if (count !== undefined)
          void vscode.window.showInformationMessage(`Synced ${count} ${node.kind.kind} resources.`);
      }),
    ),
    vscode.commands.registerCommand(
      'conduktor.editLocally',
      guarded(async (target?: ExplorerNode | vscode.Uri) => {
        const resource = resourceToEdit(sessions, target);
        if (!resource) throw new Error('Open a Console resource to edit it locally.');
        await vscode.window.showTextDocument(await sync.syncResource(resource.kind, resource.parents, resource.name));
      }),
    ),
    vscode.commands.registerCommand(
      'conduktor.refreshSync',
      guarded(() => sync.refresh({ drift: true })),
    ),
    vscode.commands.registerCommand(
      'conduktor.discardChanges',
      guarded(async (target?: ExplorerNode | vscode.Uri) => {
        const uri = targetUri(target);
        if (!uri) return;
        const choice = await confirm(
          'Discard local changes?',
          `${vscode.workspace.asRelativePath(uri)} goes back to the version last synced or applied.`,
          'Discard',
        );
        if (choice === 'Discard') await sync.discard(uri);
      }),
    ),
    vscode.commands.registerCommand(
      'conduktor.resyncFromConsole',
      guarded(async (target?: ExplorerNode | vscode.Uri) => {
        const uri = targetUri(target);
        if (!uri) return;
        const choice = await confirm(
          'Replace the local file with the Console version?',
          `${vscode.workspace.asRelativePath(uri)} is overwritten with what the Console holds now.`,
          'Re-sync',
        );
        if (choice === 'Re-sync') await sync.resync(uri);
      }),
    ),
    vscode.commands.registerCommand(
      'conduktor.showRequiredVariables',
      guarded(async () => {
        const variables = await sync.requiredVariables();
        if (variables.length === 0) {
          void vscode.window.showInformationMessage('The sync folder needs no environment variables.');
          return;
        }
        const picked = await vscode.window.showQuickPick(
          variables.map((v) => ({ label: v.name, description: v.set ? 'set' : 'not set', picked: !v.set })),
          {
            title: 'Environment variables the sync folder needs (VS Code must be started with them)',
            canPickMany: true,
          },
        );
        if (picked?.length) {
          await vscode.env.clipboard.writeText(picked.map((p) => `export ${p.label}=`).join('\n'));
          void vscode.window.showInformationMessage(`Copied ${picked.length} export lines to fill in.`);
        }
      }),
    ),
  ];
}

function resourceToEdit(
  sessions: SessionManager,
  target?: ExplorerNode | vscode.Uri,
): { kind: KindVersion; parents: string[]; name: string } | undefined {
  if (target && !(target instanceof vscode.Uri)) return target.type === 'resource' ? target : undefined;
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  const ref = uri?.scheme === LIVE_SCHEME ? parseLiveUriParts(uri.authority, uri.path) : undefined;
  const state = sessions.current();
  const kind = ref && state.status === 'ready' ? state.spec.catalog.resolve(`v${ref.version}`, ref.kind) : undefined;
  return ref && kind ? { kind, parents: ref.parents, name: ref.name } : undefined;
}
