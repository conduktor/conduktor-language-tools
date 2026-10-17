import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  canChange,
  catalogDocuments,
  containedFile,
  fileVariables,
  includeRoot,
  isInside,
  outcomeLabel,
  outcomeProblems,
  planDocuments,
  summarise,
  upsertDocuments,
  type ResourceDocument,
  type UpsertItem,
  type UpsertOutcome,
} from '@conduktor/core';
import { DiagnosticSeverity, type CodeAction, type CodeLens, type Diagnostic, type Range } from 'vscode-languageserver';
import type { TextDocument } from 'vscode-languageserver-textdocument';
import type { ReadySession, Session } from './session';

export const COMMANDS = {
  dryRun: 'conduktor.dryRun',
  apply: 'conduktor.apply',
  switchMode: 'conduktor.switchMode',
} as const;

const DEBOUNCE_MS = 500;
const AT_ONCE = 2;

type Action = 'dry run' | 'applied';
type Env = Readonly<Record<string, string | undefined>>;

interface LastResult {
  action: Action;
  outcome: UpsertOutcome;
  start: number;
}

/** What the dry runs need from the server around them. */
export interface ResourcesHost {
  /** The session, once it has a Console that accepted the token. */
  session(): ReadySession | undefined;
  document(uri: string): TextDocument | undefined;
  workspaceFolders(): readonly string[];
  /** The environment ${VAR} references are filled from, before a file's .env. */
  env: Env;
  home: string;
  /** Results for the file changed: its diagnostics and lenses are to be published again. */
  changed(uri: string): void;
  show(level: 'info' | 'warning', message: string): void;
  confirm(message: string, action: string): Promise<boolean>;
  log(message: string): void;
  progress<T>(title: string, task: () => Promise<T>): Promise<T>;
}

/**
 * Dry runs and applies against the Console, as the VS Code extension's ResourceController does, over LSP: results go
 * to diagnostics (failures, on the resource's first line, since the Console's errors carry no field path) and lenses
 * (everything else); Dry run and Apply are commands, reached from code actions and lenses.
 */
export class Resources {
  private readonly results = new Map<string, Map<number, LastResult>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly queue: string[] = [];
  private running = 0;

  constructor(private readonly host: ResourcesHost) {}

  /** A dry run of a file shortly after it is opened (unless it has results) or saved, two files at a time. */
  schedule(uri: string, saved: boolean): void {
    if (!saved && this.results.has(uri)) return;
    clearTimeout(this.timers.get(uri));
    this.timers.set(
      uri,
      setTimeout(() => {
        this.timers.delete(uri);
        if (!this.queue.includes(uri)) this.queue.push(uri);
        this.pump();
      }, DEBOUNCE_MS),
    );
  }

  /** Forgets every result, when they were another session's. */
  reset(): void {
    this.results.clear();
  }

  /** Results name lines of the text they ran on: an edit makes them wrong. Whether there were any. */
  edited(uri: string): boolean {
    return this.results.delete(uri);
  }

  closed(uri: string): void {
    clearTimeout(this.timers.get(uri));
    this.timers.delete(uri);
    const queued = this.queue.indexOf(uri);
    if (queued >= 0) this.queue.splice(queued, 1);
    this.results.delete(uri);
  }

  diagnostics(document: TextDocument): Diagnostic[] {
    const results = this.results.get(document.uri);
    if (!results) return [];
    return [...results.values()].flatMap(({ outcome, start }) =>
      outcomeProblems(outcome, 'earlier in this file').map(({ message, severity }) => ({
        range: lineAt(document, start),
        message,
        severity: severity === 'error' ? DiagnosticSeverity.Error : DiagnosticSeverity.Warning,
        source: 'Conduktor',
      })),
    );
  }

  lenses(document: TextDocument): CodeLens[] {
    const session = this.host.session();
    if (!session) return [];
    const documents = this.documentsOf(document, session);
    const canApply = canChange(session.connection.mode);
    const lens = (start: number, title: string, command: string, index?: number): CodeLens => ({
      range: lineAt(document, start),
      command: { title, command, arguments: index === undefined ? [document.uri] : [document.uri, index] },
    });
    const lenses: CodeLens[] = [];
    const [first] = documents;
    if (first && documents.length > 1) {
      lenses.push(lens(first.start, `Dry run all (${documents.length})`, COMMANDS.dryRun));
      if (canApply) lenses.push(lens(first.start, `Apply all (${documents.length})`, COMMANDS.apply));
    }
    for (const { index, start } of documents) {
      const last = this.results.get(document.uri)?.get(index);
      const suffix = (action: Action) => (last?.action === action ? ` · ${outcomeLabel(last.outcome)}` : '');
      lenses.push(lens(start, `Dry run${suffix('dry run')}`, COMMANDS.dryRun, index));
      if (canApply) lenses.push(lens(start, `Apply${suffix('applied')}`, COMMANDS.apply, index));
    }
    return lenses;
  }

  actions(document: TextDocument, range: Range): CodeAction[] {
    const session = this.host.session();
    if (!session) return [];
    const documents = this.documentsOf(document, session);
    const at = document.offsetAt(range.start);
    const here = documents.find((d) => d.start <= at && at <= d.end);
    const { name, mode } = session.connection;
    const action = (title: string, command: string, index?: number): CodeAction => ({
      title,
      command: { title, command, arguments: index === undefined ? [document.uri] : [document.uri, index] },
    });
    const actions: CodeAction[] = [];
    const subject = here && `${here.kind} ${here.resource?.metadata.name ?? ''}`.trim();
    if (here) actions.push(action(`Dry run ${subject} on ${name}`, COMMANDS.dryRun, here.index));
    if (documents.length > 1)
      actions.push(action(`Dry run the ${documents.length} resources of this file`, COMMANDS.dryRun));
    if (canChange(mode)) {
      if (here) actions.push(action(`Apply ${subject} to ${name}`, COMMANDS.apply, here.index));
      if (documents.length > 1)
        actions.push(action(`Apply the ${documents.length} resources of this file`, COMMANDS.apply));
    }
    return actions;
  }

  async execute(command: string, args: readonly unknown[]): Promise<void> {
    const [uri, index] = args;
    if (typeof uri !== 'string' || (index !== undefined && typeof index !== 'number')) return;
    if (command === COMMANDS.dryRun) await this.run(uri, index, false);
    if (command === COMMANDS.apply) await this.run(uri, index, true);
  }

  private pump(): void {
    while (this.running < AT_ONCE) {
      const uri = this.queue.shift();
      if (uri === undefined) return;
      this.running++;
      void this.validate(uri)
        .catch((error: unknown) => this.host.log(`Dry run of ${uri} failed: ${String(error)}`))
        .finally(() => {
          this.running--;
          this.pump();
        });
    }
  }

  /** A dry run with nothing to say: its results only go to the file's diagnostics and lenses. */
  private async validate(uri: string): Promise<void> {
    const session = this.host.session();
    const document = this.host.document(uri);
    if (!session || !document) return;
    const documents = this.documentsOf(document, session);
    if (documents.length === 0) return;
    const stale = this.staleness(session, document);
    const plan = await planDocuments(session.client, session.spec.catalog, documents, {
      readInclude: this.includeReader(uri),
      cancelled: stale,
    });
    if (!stale()) this.record(uri, plan, 'dry run');
  }

  private async run(uri: string, index: number | undefined, apply: boolean): Promise<void> {
    const session = this.host.session();
    if (!session) {
      this.host.show(
        'warning',
        'No Console to ask: name one in ~/.config/conduktor/console.json, with CONDUKTOR_TOKEN set.',
      );
      return;
    }
    const { name, mode } = session.connection;
    if (apply && !canChange(mode)) {
      this.host.show(
        'warning',
        `${name} is in prod mode, which never changes it. Set "mode": "dev" in console.json to apply.`,
      );
      return;
    }
    const document = this.host.document(uri);
    if (!document) return;
    const documents = this.documentsOf(document, session).filter((d) => index === undefined || d.index === index);
    if (documents.length === 0) {
      this.host.show('warning', `No Conduktor resources to ${apply ? 'apply' : 'dry-run'} here.`);
      return;
    }

    const { client, spec } = session;
    const readInclude = this.includeReader(uri);
    const stale = this.staleness(session, document);
    const plan = await this.host.progress(`Dry run on ${name}`, () =>
      planDocuments(client, spec.catalog, documents, { readInclude }),
    );
    if (!stale()) this.record(uri, plan, 'dry run');
    const summary = summarise(name, plan);
    this.host.log(summary.text);
    const path = filePath(uri);
    if (path) this.host.log(`Same from a shell: conduktor apply -f ${path}${apply ? '' : ' --dry-run'}`);
    if (!apply || summary.failed > 0) {
      this.host.show(summary.failed > 0 ? 'warning' : 'info', summary.text);
      return;
    }
    if (plan.every((item) => item.outcome.status === 'ok' && item.outcome.result === 'NotChanged')) {
      this.host.show('info', `Nothing to apply on ${name}: everything is unchanged.`);
      return;
    }
    const pending = plan.filter((item) => item.outcome.status === 'pending').length;
    const detail =
      pending > 0
        ? ` ${pending} can only be checked once the resources before them exist; resources are applied one at a time, in order, stopping at the first failure.`
        : '';
    if (!(await this.host.confirm(`Apply to ${name}? ${summary.text}.${detail}`, 'Apply'))) return;

    // What was dry-run and confirmed is what is applied, even if the file changed since.
    const items = await this.host.progress(`Applying to ${name}`, () =>
      upsertDocuments(client, spec.catalog, documents, { dryRun: false, readInclude, stopOnError: true }),
    );
    if (!stale()) this.record(uri, items, 'applied');
    const applied = summarise(name, items, 'Applied to');
    this.host.log(applied.text);
    this.host.show(applied.failed > 0 ? 'warning' : 'info', applied.text);
  }

  private record(uri: string, items: readonly UpsertItem[], action: Action): void {
    const byIndex = this.results.get(uri) ?? new Map<number, LastResult>();
    for (const { document, outcome } of items) byIndex.set(document.index, { action, outcome, start: document.start });
    this.results.set(uri, byIndex);
    this.host.changed(uri);
  }

  // Another session's answer, or one for text edited since, would land on the wrong Console or lines.
  private staleness(session: Session, document: TextDocument): () => boolean {
    const { version } = document;
    return () => this.host.session() !== session || this.host.document(document.uri)?.version !== version;
  }

  private documentsOf(document: TextDocument, session: Session): ResourceDocument[] {
    return catalogDocuments(document.getText(), session.spec.catalog, { env: this.variables(document.uri) });
  }

  // The Console token is in this server's environment; a resource never gets it from a ${CONDUKTOR_TOKEN}.
  private variables(uri: string): Env {
    const path = filePath(uri);
    if (!path) return this.host.env;
    const workspace = this.host
      .workspaceFolders()
      .filter((folder) => isInside(folder, path))
      .sort((a, b) => b.length - a.length)[0];
    return fileVariables(path, this.host.env, { workspace, home: this.host.home });
  }

  private includeReader(uri: string): ((file: string) => string) | undefined {
    const path = filePath(uri);
    if (!path) return undefined;
    // A cloned repository's schemaFile must not reach past it: what is read is sent to the Console.
    return (file) => readFileSync(containedFile(includeRoot(path, this.host.workspaceFolders()), file), 'utf8');
  }
}

function filePath(uri: string): string | undefined {
  return uri.startsWith('file:') ? fileURLToPath(uri) : undefined;
}

function lineAt(document: TextDocument, offset: number): Range {
  const { line } = document.positionAt(offset);
  const text = document.getText({ start: { line, character: 0 }, end: { line: line + 1, character: 0 } });
  return { start: { line, character: 0 }, end: { line, character: text.replace(/\r?\n$/, '').length } };
}
