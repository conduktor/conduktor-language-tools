import * as vscode from 'vscode';
import { listPath, newResourceYaml, parentsOf, type KindCatalog, type KindVersion } from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';
import { PARENT_KINDS, type ExplorerNode } from '../explorer/explorerModel';

type Ready = Extract<SessionState, { status: 'ready' }>;

export async function newResource(
  sessions: SessionManager,
  node?: ExplorerNode,
): Promise<vscode.TextDocument | undefined> {
  const state = sessions.current();
  if (state.status !== 'ready') {
    void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
    return undefined;
  }
  const kind = node?.type === 'kind' || node?.type === 'parent' ? node.kind : await pickKind(state.spec.catalog);
  if (!kind) return undefined;
  let parents = node?.type === 'parent' ? node.parents : [];
  while (parents.length < kind.parentPathParams.length) {
    const value = await pickParent(state, kind, parents);
    if (!value) return undefined;
    parents = [...parents, value];
  }
  const document = await vscode.workspace.openTextDocument({
    language: 'yaml',
    content: newResourceYaml(kind, parentsOf(kind, parents)),
  });
  await vscode.window.showTextDocument(document);
  return document;
}

async function pickKind(catalog: KindCatalog): Promise<KindVersion | undefined> {
  const items = [...catalog.kindNames()]
    .map((name) => catalog.latest(name)!)
    .sort((a, b) => a.kind.localeCompare(b.kind))
    .map((kind) => ({ label: kind.kind, description: `${kind.group} · v${kind.version}`, kindVersion: kind }));
  return (await vscode.window.showQuickPick(items, { title: 'New Conduktor resource', matchOnDescription: true }))
    ?.kindVersion;
}

async function pickParent(state: Ready, kind: KindVersion, parents: string[]): Promise<string | undefined> {
  const param = kind.parentPathParams[parents.length]!;
  const parentKindName = PARENT_KINDS[param];
  const parentKind = parentKindName ? state.spec.catalog.latest(parentKindName) : undefined;
  let names: string[] = [];
  if (parentKind) {
    try {
      names = (await state.client.list(listPath(parentKind, parentsOf(kind, parents)))).map((r) => r.metadata.name);
    } catch {
      names = [];
    }
  }
  const title = `New ${kind.kind}: which ${param}?`;
  if (names.length === 0) return vscode.window.showInputBox({ title, ignoreFocusOut: true });
  return vscode.window.showQuickPick(names.sort(), { title });
}
