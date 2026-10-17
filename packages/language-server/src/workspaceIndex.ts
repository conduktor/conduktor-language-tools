import type { Dirent } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsedDocuments, type KindCatalog, type Resource } from '@conduktor/core';
import { TextDocument } from 'vscode-languageserver-textdocument';

/** A resource in a document: where it starts there and its own text. */
export interface Located {
  document: TextDocument;
  start: number;
  text: string;
  resource: Resource;
}

export interface IndexHost {
  folders(): readonly string[];
  /** The documents open in the editor, which win over their files on disk. */
  open(): readonly TextDocument[];
  log(message: string): void;
}

// Dependencies and build output hold copies of resources, or YAML of their own; dot-folders are tools' state.
const SKIPPED = new Set(['node_modules', 'dist', 'out', 'target']);
// A folder opened at the home directory would be read for minutes: the scan stops at these, and says so.
const MAX_FILES = 5_000;
const MAX_ENTRIES = 100_000;
const MAX_BYTES = 1024 * 1024;
const YAML = /\.ya?ml$/;
// Without a kind, a file holds no resource, and is not kept.
const KIND = /^kind\s*:/m;

/** The workspace folders' YAML files, read once and again when they change, under the documents open in the editor. */
export class WorkspaceIndex {
  private readonly disk = new Map<string, TextDocument>();
  private readonly parsed = new WeakMap<TextDocument, { version: number; catalog: KindCatalog; located: Located[] }>();
  // The latest read of each file: an older one finishing last does not win.
  private readonly reads = new Map<string, number>();
  private read = 0;
  private scanned: Promise<void> = Promise.resolve();

  constructor(private readonly host: IndexHost) {}

  scan(): void {
    this.scanned = this.walk().catch((error: unknown) =>
      this.host.log(`Reading the workspace failed: ${String(error)}`),
    );
  }

  /** The open documents, and the files on disk that are not open. */
  async documents(): Promise<TextDocument[]> {
    await this.scanned;
    const open = this.host.open();
    const uris = new Set(open.map((document) => document.uri));
    return [...open, ...[...this.disk.values()].filter((document) => !uris.has(document.uri))];
  }

  /** Every resource of every document, each document parsed once per version. */
  async located(catalog: KindCatalog): Promise<Located[]> {
    return (await this.documents()).flatMap((document) => this.locatedIn(document, catalog));
  }

  /** A file created, changed or deleted on disk, or closed in the editor: read again. */
  async changed(uri: string): Promise<void> {
    await this.scanned;
    const path = uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
    if (!path || !YAML.test(path) || !this.host.folders().some((folder) => inside(folder, path))) return;
    const read = ++this.read;
    this.reads.set(uri, read);
    const text = await readYaml(path);
    if (this.reads.get(uri) !== read) return;
    if (text === undefined) this.disk.delete(uri);
    else this.disk.set(uri, TextDocument.create(uri, 'yaml', 0, text));
  }

  private locatedIn(document: TextDocument, catalog: KindCatalog): Located[] {
    const cached = this.parsed.get(document);
    if (cached?.version === document.version && cached.catalog === catalog) return cached.located;
    const located = parsedDocuments(document.getText(), catalog).flatMap(({ start, text, resource }) =>
      resource ? [{ document, start, text, resource }] : [],
    );
    this.parsed.set(document, { version: document.version, catalog, located });
    return located;
  }

  private async walk(): Promise<void> {
    const pending = [...this.host.folders()];
    let entries = 0;
    let files = 0;
    for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
      const children: Dirent[] = await readdir(folder, { withFileTypes: true }).catch(() => []);
      entries += children.length;
      // Symbolic links are not followed: one can loop, or leave the workspace.
      for (const child of children)
        if (child.isDirectory() && !child.name.startsWith('.') && !SKIPPED.has(child.name))
          pending.push(join(folder, child.name));
      const yaml = children.filter((child) => child.isFile() && YAML.test(child.name)).slice(0, MAX_FILES - files);
      files += yaml.length;
      const texts = await Promise.all(yaml.map((child) => readYaml(join(folder, child.name))));
      yaml.forEach((child, i) => {
        const text = texts[i];
        const uri = pathToFileURL(join(folder, child.name)).href;
        if (text !== undefined) this.disk.set(uri, TextDocument.create(uri, 'yaml', 0, text));
      });
      if (files >= MAX_FILES || entries >= MAX_ENTRIES) {
        this.host.log(
          `Stopped reading the workspace after ${files} YAML files: names in the others count once they are open.`,
        );
        return;
      }
    }
  }
}

/** A file's text, if it can hold a resource; `undefined` when it is gone, too large, or has no kind. */
async function readYaml(path: string): Promise<string | undefined> {
  try {
    if ((await stat(path)).size > MAX_BYTES) return undefined;
    const text = await readFile(path, 'utf8');
    return KIND.test(text) ? text : undefined;
  } catch {
    return undefined;
  }
}

/** Whether the path is in the folder, outside the folders the scan skips. */
function inside(folder: string, path: string): boolean {
  const parts = relative(folder, path).split(sep);
  return parts[0] !== '..' && parts.slice(0, -1).every((part) => !part.startsWith('.') && !SKIPPED.has(part));
}
