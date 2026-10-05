import * as vscode from 'vscode';
import {
  fixedNames,
  kindSchema,
  listPath,
  newResourceName,
  newResourceYaml,
  nextChoice,
  PARENT_KINDS,
  parentsOf,
  skeletonYaml,
  type Choice,
  type KindCatalog,
  type KindVersion,
} from '@conduktor/vscode-core';
import type { SessionManager, SessionState } from '../connections/session';
import type { ExplorerNode } from '../explorer/explorerModel';
import type { SyncFolder } from '../sync/syncFolder';

type Ready = Extract<SessionState, { status: 'ready' }>;

/** `undefined` when the user dismissed the pick, `null` for leaving an optional variant out. */
export type VariantPicker = (choice: Choice, kind: string) => Promise<string | null | undefined>;

export const quickPickVariant: VariantPicker = async (choice, kind) => {
  const items = [
    ...choice.options.map((option) => ({ label: option, value: option as string | null })),
    ...(choice.optional ? [{ label: '(none)', description: 'leave it out', value: null }] : []),
  ];
  const picked = await vscode.window.showQuickPick(items, {
    title: `New ${kind}: ${[...choice.path.slice(1), choice.field].join('.')}`,
    placeHolder: choice.optional ? 'Choose a variant, or leave it out' : 'Choose a variant',
    ignoreFocusOut: true,
  });
  return picked?.value;
};

export async function newResource(
  sessions: SessionManager,
  sync: SyncFolder,
  cluster: string | undefined,
  node?: ExplorerNode,
  pickVariant: VariantPicker = quickPickVariant,
): Promise<vscode.TextDocument | undefined> {
  const state = sessions.current();
  if (state.status !== 'ready') {
    void vscode.window.showWarningMessage('Connect to a Conduktor Console first.');
    return undefined;
  }
  const kind = node?.type === 'kind' || node?.type === 'parent' ? node.kind : await pickKind(state.spec.catalog);
  if (!kind) return undefined;
  let parents =
    node?.type === 'parent' || node?.type === 'kind'
      ? node.parents
      : kind.parentPathParams[0] === 'cluster' && cluster
        ? [cluster]
        : [];
  while (parents.length < kind.parentPathParams.length) {
    const value = await pickParent(state, kind, parents);
    if (!value) return undefined;
    parents = [...parents, value];
  }
  const template = await templateFor(state, kind, pickVariant);
  if (!template) return undefined;
  const local = await sync.ensureChosen();
  const name = await nameFor(sync, local, kind, parents, template.fixedNames);
  if (!name) {
    void vscode.window.showWarningMessage(
      `Every ${kind.kind} name (${template.fixedNames!.join(', ')}) already has a local file.`,
    );
    return undefined;
  }
  const content = template.render(parentsOf(kind, parents), name);
  const document = local
    ? await vscode.workspace.openTextDocument(await sync.writeNew(kind, parents, content, name))
    : await vscode.workspace.openTextDocument({ language: 'yaml', content });
  await vscode.window.showTextDocument(document);
  return document;
}

interface Template {
  render: (parents: Record<string, string>, name: string) => string;
  fixedNames?: string[];
}

// Built from the kind's schema once its variants are chosen; a kind without a published schema keeps its example.
async function templateFor(state: Ready, kind: KindVersion, pickVariant: VariantPicker): Promise<Template | undefined> {
  if (!kind.bodySchema) return { render: (parents, name) => newResourceYaml(kind, parents, name) };
  const root = kindSchema(state.spec.schema, kind as KindVersion & { bodySchema: string });
  const answers: Record<string, string | null> = {};
  for (let choice = nextChoice(root, answers); choice; choice = nextChoice(root, answers)) {
    const value = await pickVariant(choice, kind.kind);
    if (value === undefined) return undefined;
    answers[choice.path.join('.')] = value;
  }
  return { render: (parents, name) => skeletonYaml(root, kind, parents, name, answers), fixedNames: fixedNames(root) };
}

// A kind limited to a few names (Integration) takes the first one without a local file, so the file and the document
// agree and an existing resource is never drafted over; any other kind gets a free variant of its example name.
async function nameFor(
  sync: SyncFolder,
  local: boolean,
  kind: KindVersion,
  parents: string[],
  fixed: readonly string[] | undefined,
): Promise<string | undefined> {
  if (!fixed) return local ? sync.freeName(kind, parents, newResourceName(kind)) : newResourceName(kind);
  if (!local) return fixed[0];
  for (const candidate of fixed) if ((await sync.freeName(kind, parents, candidate)) === candidate) return candidate;
  return undefined;
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
