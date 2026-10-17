import {
  describeSources,
  documentAt,
  isRecord,
  listPath,
  NameIndex,
  parentsOf,
  referenceAt,
  valueAt,
  type KindCatalog,
  type NameLookup,
  type NameSource,
  type Resource,
} from '@conduktor/core';
import { CompletionItemKind, type CompletionItem, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import { valueEdit } from './completions';
import type { ReadySession } from './session';
import type { Located } from './workspaceIndex';

/** The resource being written, by its document and where it starts there. */
export interface Editing {
  uri: string;
  start: number;
}

// The Console's lists change under the user (a cluster added in the UI): they are asked again after this long.
const LIST_TTL_MS = 60_000;

export interface NamesHost {
  session(): ReadySession | undefined;
  /** Resolves once the session has loaded, or once waiting for it is no longer worth it. */
  settled(): Promise<void>;
  located(catalog: KindCatalog): Promise<Located[]>;
}

/** The names a reference can take: what the workspace defines, and what the Console holds. */
export class Names {
  private lists = new Map<string, { at: number; resources: Promise<Resource[] | undefined> }>();
  private listedFor: ReadySession | undefined;

  constructor(private readonly host: NamesHost) {}

  /**
   * `editing` is the resource being written, whose half-typed name is not one to offer. `checked` is true only when the
   * Console answered: a name missing from both is only missing then.
   */
  async lookup(
    catalog: KindCatalog,
    kind: string,
    parents: readonly string[],
    editing?: Editing,
  ): Promise<{ names: { name: string; sources: NameSource[] }[]; checked: boolean }> {
    const index = new NameIndex();
    const params = catalog.latest(kind)?.parentPathParams ?? [];
    for (const resource of await this.localResources(catalog, editing)) {
      const { name } = metadataOf(resource);
      if (resource.kind === kind && typeof name === 'string' && sameParents(parentsIn(resource, params), parents))
        index.add(kind, parents, name, 'repo');
    }
    await this.host.settled();
    const live = await this.listed(kind, parents);
    for (const resource of live ?? []) index.add(kind, parents, resource.metadata.name, 'console');
    return { names: index.list(kind, parents), checked: live !== undefined };
  }

  /** The lookups core's reference problems need, against a catalog. */
  lookupFor(catalog: KindCatalog): NameLookup {
    return {
      lookup: (kind, parents) => this.lookup(catalog, kind, parents),
      instances: async () => [
        ...(await this.consoleResources('ApplicationInstance', [])),
        ...(await this.localResources(catalog)).filter((resource) => resource.kind === 'ApplicationInstance'),
      ],
    };
  }

  /** Every resource the workspace holds, of any kind, but the one being written. */
  async localResources(catalog: KindCatalog, editing?: Editing): Promise<Resource[]> {
    return (await this.host.located(catalog)).flatMap(({ document, start, resource }) =>
      document.uri === editing?.uri && start === editing.start ? [] : [resource],
    );
  }

  /**
   * The Console's resources of a kind under its parents, none without a Console. What a completion most needs: one
   * asked right after opening waits for the Console to connect.
   */
  async consoleResources(kind: string, parents: readonly string[]): Promise<Resource[]> {
    await this.host.settled();
    return (await this.listed(kind, parents)) ?? [];
  }

  private listed(kind: string, parents: readonly string[]): Promise<Resource[] | undefined> {
    const session = this.host.session();
    if (session !== this.listedFor) {
      this.lists = new Map();
      this.listedFor = session;
    }
    const target = session?.spec.catalog.latest(kind);
    if (!session || !target) return Promise.resolve(undefined);
    const path = listPath(target, parentsOf(target, [...parents]));
    const cached = this.lists.get(path);
    if (cached && Date.now() - cached.at < LIST_TTL_MS) return cached.resources;
    const resources = session.client.list(path).catch(() => {
      // A failed list is asked again next time rather than remembered.
      this.lists.delete(path);
      return undefined;
    });
    this.lists.set(path, { at: Date.now(), resources });
    return resources;
  }
}

/** The resource under the cursor, as being edited, and the scalar under the cursor, at offsets in the whole file. */
export function resourceAt(document: TextDocument, position: Position, catalog: KindCatalog) {
  const offset = document.offsetAt(position);
  const parsed = documentAt(document.getText(), offset, catalog);
  if (!parsed?.resource) return undefined;
  const at = valueAt(parsed.text, offset - parsed.start);
  const value = at && { ...at, start: parsed.start + at.start, end: parsed.start + at.end };
  return { resource: parsed.resource, editing: { uri: document.uri, start: parsed.start }, offset, value };
}

/** The names a reference under the cursor can take — a Topic's cluster, an Application's owner — or `undefined`. */
export async function referenceCompletions(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
  names: Names,
  typedSpace: boolean,
): Promise<CompletionItem[] | undefined> {
  const here = resourceAt(document, position, catalog);
  if (!here?.value) return undefined;
  const { resource, value } = here;
  const reference = referenceAt(resource, catalog, value.path);
  // A resource's own name: the ones that exist already, to write one that is there. Not on a space, where a new name
  // is as likely as an existing one and the list would only be in the way.
  const target = reference?.parents
    ? { kind: reference.kind, parents: reference.parents }
    : !typedSpace && value.path.join('.') === 'metadata.name'
      ? ownScope(resource, catalog)
      : undefined;
  if (!target) return undefined;

  const quote = /^["']/.exec(document.getText().slice(value.start, value.end))?.[0] ?? '';
  const edit = valueEdit(document, value.start, value.end);
  const { names: found } = await names.lookup(catalog, target.kind, target.parents, here.editing);
  return found.map(({ name, sources }) => ({
    label: name,
    kind: CompletionItemKind.Reference,
    detail: `${target.kind} · ${describeSources(sources)}`,
    ...(quote && { filterText: `${quote}${name}` }),
    textEdit: edit(`${quote}${name}${quote}`),
  }));
}

/** Where typing a space opens completion: right after `key: ` or a list's `- `, where a value starts. */
export function atValueStart(document: TextDocument, position: Position): boolean {
  const line = document.getText({ start: { line: position.line, character: 0 }, end: position });
  return /(?:^|\S):\s$|^\s*-\s$/.test(line);
}

/** Where a resource's name lives: its kind, under the parents it names (a Topic's cluster), once they are all set. */
export function ownScope(resource: Resource, catalog: KindCatalog): { kind: string; parents: string[] } | undefined {
  const params = catalog.latest(resource.kind)?.parentPathParams;
  if (!params) return undefined;
  const parents = parentsIn(resource, params);
  return parents.every((parent) => parent !== '') ? { kind: resource.kind, parents } : undefined;
}

export function parentsIn(resource: Resource, params: readonly string[]): string[] {
  const metadata = metadataOf(resource);
  return params.map((param) => {
    const value = metadata[param];
    return typeof value === 'string' ? value : '';
  });
}

/** A resource's metadata as written: a file being typed may have none yet, whatever its type says. */
export function metadataOf(resource: Resource): Record<string, unknown> {
  const metadata: unknown = resource.metadata;
  return isRecord(metadata) ? metadata : {};
}

export function sameParents(a: readonly string[], b: readonly string[]): boolean {
  return a.join('/') === b.join('/');
}
