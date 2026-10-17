import {
  describeSources,
  documentAt,
  isRecord,
  listPath,
  NameIndex,
  parentsOf,
  parsedDocuments,
  referenceAt,
  valueAt,
  type KindCatalog,
  type NameLookup,
  type NameSource,
  type Resource,
} from '@conduktor/core';
import { CompletionItemKind, type CompletionList, type Position } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ReadySession } from './session';

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
  /** Whether a session is still connecting to its Console. */
  connecting(): boolean;
  documents(): readonly TextDocument[];
}

/** The names a reference can take: what the open files define, and what the Console holds. */
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
    for (const resource of this.localResources(catalog, editing)) {
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
        ...this.localResources(catalog).filter((resource) => resource.kind === 'ApplicationInstance'),
      ],
    };
  }

  /**
   * Whether what was looked up may still miss the Console's names, its session still connecting: a completion list
   * says so, for the editor to ask again as the user types.
   */
  incomplete(): boolean {
    return this.host.connecting();
  }

  /** Every resource the open files hold, of any kind, but the one being written. */
  localResources(catalog: KindCatalog, editing?: Editing): Resource[] {
    return this.host
      .documents()
      .flatMap((document) =>
        parsedDocuments(document.getText(), catalog).flatMap(({ start, resource }) =>
          resource && !(document.uri === editing?.uri && start === editing.start) ? [resource] : [],
        ),
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

/** The names a reference under the cursor can take — a Topic's cluster, an Application's owner — or `undefined`. */
export async function referenceCompletions(
  document: TextDocument,
  position: Position,
  catalog: KindCatalog,
  names: Names,
  options: { typedSpace: boolean },
): Promise<CompletionList | undefined> {
  const text = document.getText();
  const offset = document.offsetAt(position);
  const parsed = documentAt(text, offset, catalog);
  if (!parsed?.resource) return undefined;
  const at = valueAt(parsed.text, offset - parsed.start);
  if (!at) return undefined;
  const reference = referenceAt(parsed.resource, catalog, at.path);
  // A resource's own name: the ones that exist already, to write one that is there. Not on a space, where a new name
  // is as likely as an existing one and the list would only be in the way.
  const target = reference?.parents
    ? { kind: reference.kind, parents: reference.parents }
    : !options.typedSpace && at.path.join('.') === 'metadata.name'
      ? ownScope(parsed.resource, catalog)
      : undefined;
  if (!target) return undefined;

  const start = parsed.start + at.start;
  const end = parsed.start + at.end;
  const quote = /^["']/.exec(text.slice(start, end))?.[0] ?? '';
  // `cluster:` with nothing after it yet: a value needs the space.
  const space = text[start - 1] === ':' ? ' ' : '';
  const range = { start: document.positionAt(start), end: document.positionAt(end) };
  const { names: found } = await names.lookup(catalog, target.kind, target.parents, {
    uri: document.uri,
    start: parsed.start,
  });
  return {
    isIncomplete: names.incomplete(),
    items: found.map(({ name, sources }) => ({
      label: name,
      kind: CompletionItemKind.Reference,
      detail: `${target.kind} · ${describeSources(sources)}`,
      ...(quote && { filterText: `${quote}${name}` }),
      textEdit: { range, newText: `${space}${quote}${name}${quote}` },
    })),
  };
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
