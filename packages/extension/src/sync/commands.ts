import * as vscode from 'vscode';
import {
  bootstrapProgress,
  describeBootstrap,
  describeError,
  type BootstrapStage,
  type KindCatalog,
  type KindVersion,
} from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { ExplorerNode } from '../explorer/explorerModel';
import type { ConnectionStore } from '../connections/connectionStore';
import type { SessionManager } from '../connections/session';
import type { Output } from '../output';
import { isLiveScheme, parseLiveUriParts } from '../liveFs/uris';
import { inWorkspace } from './folders';
import { chooseFolder, type SyncFolder } from './syncFolder';

const LARGE_SYNC = 20;
const inform = (message: string) => void vscode.window.showInformationMessage(message);

export function registerSyncCommands(
  sync: SyncFolder,
  confirm: Confirm,
  sessions: SessionManager,
  connections: ConnectionStore,
  output: Output,
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
        const { parents } = node;
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
      'conduktor.syncEverything',
      guarded(async () => {
        const state = sessions.current();
        if (state.status !== 'ready') throw new Error('Connect to a Conduktor Console first.');
        if (!(await sync.ensureChosen())) return;
        const kinds = await pickKinds(state.spec.catalog, new Set(await sync.managedKinds()));
        if (!kinds) return;
        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Syncing everything from ${state.connection.name}`,
            cancellable: true,
          },
          (progress, token) => {
            const reporter = bootstrapReporter(progress, output);
            return sync
              .syncEverything(kinds, {
                cancelled: () => token.isCancellationRequested,
                onProgress: (stage) => reporter.report(stage),
              })
              .finally(() => reporter.dispose());
          },
        );
        const { headline, details } = describeBootstrap(sync.environment() ?? state.connection.name, result);
        output.info(headline);
        details.forEach((line) => output.info(`  ${line}`));
        const show = await (result.conflicts.length + result.skipped.length > 0
          ? vscode.window.showWarningMessage(headline, 'Show Output')
          : vscode.window.showInformationMessage(headline, 'Show Output'));
        if (show) output.show();
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
      'conduktor.setSyncFolder',
      guarded(async () => {
        const previous = sync.syncRoot();
        const root = await chooseFolder(previous);
        if (!root) return;
        if (previous && previous.toString() !== root.toString()) {
          const names = connections.all().map((c) => c.name);
          const move = await confirm(
            'Move the existing environments?',
            `From ${previous.fsPath} to ${root.fsPath}. Without moving, files already synced stay where they are and are no longer tracked.`,
            'Move',
            'Leave Them',
          );
          if (move === 'Move') inform(`Moved ${await sync.moveConnectionFolders(previous, root, names)} environments.`);
          if (move === undefined) return;
        }
        await sync.setSyncRoot(root);
        const folders = vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath);
        if (!inWorkspace(root.fsPath, folders)) {
          const add = await vscode.window.showInformationMessage(
            `Sync folder set to ${root.fsPath}. Add it to the workspace so its files show in the Explorer and Source Control?`,
            'Add to Workspace',
          );
          if (add)
            vscode.workspace.updateWorkspaceFolders(vscode.workspace.workspaceFolders?.length ?? 0, 0, { uri: root });
        } else {
          void vscode.window.showInformationMessage(`Sync folder set to ${vscode.workspace.asRelativePath(root)}.`);
        }
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

async function pickKinds(catalog: KindCatalog, selected: ReadonlySet<string>): Promise<string[] | undefined> {
  const items = [...catalog.kindNames()]
    .map((name) => catalog.latest(name)!)
    .sort((a, b) => a.order - b.order || a.kind.localeCompare(b.kind))
    .map((kind) => ({ label: kind.kind, description: kind.group, picked: selected.has(kind.kind) }));
  const picked = await vscode.window.showQuickPick(items, {
    title: 'Which kinds does this repository manage?',
    placeHolder: 'User is left out by default: SSO or SCIM usually owns it',
    canPickMany: true,
    ignoreFocusOut: true,
  });
  return picked && picked.length > 0 ? picked.map((item) => item.label) : undefined;
}

function resourceToEdit(
  sessions: SessionManager,
  target?: ExplorerNode | vscode.Uri,
): { kind: KindVersion; parents: string[]; name: string } | undefined {
  if (target && !(target instanceof vscode.Uri)) return target.type === 'resource' ? target : undefined;
  const uri = target ?? vscode.window.activeTextEditor?.document.uri;
  const ref = uri && isLiveScheme(uri.scheme) ? parseLiveUriParts(uri.authority, uri.path) : undefined;
  const state = sessions.current();
  const kind = ref && state.status === 'ready' ? state.spec.catalog.resolve(`v${ref.version}`, ref.kind) : undefined;
  return ref && kind ? { kind, parents: ref.parents, name: ref.name } : undefined;
}

/**
 * Sync Everything's notification: each stage's message, a clock on the lists it still waits for (the Console can take a
 * minute over one), and how long each stage took in the output.
 */
function bootstrapReporter(progress: vscode.Progress<{ message?: string; increment?: number }>, output: Output) {
  let reported = 0;
  let last: { stage: BootstrapStage; at: number } | undefined;
  let current: { stage: BootstrapStage['stage']; since: number } | undefined;
  const show = () => {
    if (!last) return;
    const { message, percent } = bootstrapProgress(last.stage, Date.now() - last.at);
    progress.report({ message, increment: percent - reported });
    reported = percent;
  };
  const finish = () => {
    if (current)
      output.info(`Sync Everything, ${current.stage}: ${((Date.now() - current.since) / 1000).toFixed(1)} s`);
  };
  const ticker = setInterval(show, 1000);
  return {
    report(stage: BootstrapStage) {
      if (stage.stage !== current?.stage) {
        finish();
        current = { stage: stage.stage, since: Date.now() };
      }
      last = { stage, at: Date.now() };
      show();
    },
    dispose() {
      clearInterval(ticker);
      finish();
    },
  };
}
