import * as vscode from 'vscode';
import {
  findReferences,
  isRecord,
  matcher,
  overlapsOf,
  patternTraps,
  patternTypeOf,
  rangeOf,
  type Instance,
  type KindCatalog,
  type Resource,
  parsedDocuments,
  type ParsedDocument,
} from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import type { Names } from './names';

export class ReferenceDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection('conduktor-references');
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly listeners: vscode.Disposable[];

  constructor(
    private readonly sessions: SessionManager,
    private readonly names: Names,
  ) {
    const all = () => vscode.workspace.textDocuments.forEach((d) => this.schedule(d));
    this.listeners = [
      vscode.workspace.onDidOpenTextDocument((d) => this.schedule(d)),
      // A change in one document can resolve or break references in the others.
      vscode.workspace.onDidChangeTextDocument((e) => e.document.languageId === 'yaml' && all()),
      vscode.workspace.onDidCloseTextDocument((d) => this.collection.delete(d.uri)),
      sessions.onDidChange(all),
      names.onDidChange(all),
    ];
    all();
  }

  private schedule(document: vscode.TextDocument): void {
    if (document.languageId !== 'yaml') return;
    const key = document.uri.toString();
    clearTimeout(this.timers.get(key));
    this.timers.set(
      key,
      setTimeout(() => void this.check(document), 300),
    );
  }

  private async check(document: vscode.TextDocument): Promise<void> {
    const state = this.sessions.current();
    if (state.status !== 'ready') {
      this.collection.delete(document.uri);
      return;
    }
    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    for (const parsed of parsedDocuments(text, state.spec.catalog)) {
      if (!parsed.resource) continue;
      diagnostics.push(...(await this.references(parsed, document, state.spec.catalog, state.connection.name)));
      if (parsed.resource.kind === 'ApplicationInstance') diagnostics.push(...(await this.overlaps(parsed, document)));
    }
    if (!document.isClosed && document.getText() === text) this.collection.set(document.uri, diagnostics);
  }

  private async references(
    parsed: ParsedDocument,
    document: vscode.TextDocument,
    catalog: KindCatalog,
    consoleName: string,
  ): Promise<vscode.Diagnostic[]> {
    const found: vscode.Diagnostic[] = [];
    for (const reference of findReferences(parsed.resource, catalog)) {
      const range = rangeIn(parsed, document, reference.path);
      if (!range) continue;
      const { pattern } = reference;
      if (pattern)
        for (const trap of patternTraps(pattern.reading, pattern.type, reference.value))
          found.push(problem(range, trap.message, trap.error ? Severity.Error : Severity.Warning));
      if (reference.wildcard || !reference.parents) continue;
      const { names, checked } = await this.names.lookup(reference.kind, reference.parents);
      if (!checked) continue;
      // A permission's LITERAL foo* is a prefix too; any other LITERAL names one resource.
      const isPattern = pattern?.type === 'PREFIXED' || (pattern?.reading === 'rbac' && reference.value.endsWith('*'));
      if (isPattern) {
        const matches = matcher(pattern!.reading, pattern!.type, reference.value);
        if (!names.some((n) => matches(n.name)))
          found.push(problem(range, `Matches no ${reference.kind} yet.`, Severity.Information));
      } else if (!names.some((n) => n.name === reference.value)) {
        found.push(
          problem(
            range,
            `${reference.kind} '${reference.value}' is not in the repository or on ${consoleName}.`,
            Severity.Warning,
          ),
        );
      }
    }
    return found;
  }

  private async overlaps(parsed: ParsedDocument, document: vscode.TextDocument): Promise<vscode.Diagnostic[]> {
    const subject = instanceOf(parsed.resource!);
    if (!subject) return [];
    const byName = new Map<string, Instance>();
    const add = (resource: Resource) => {
      const instance = instanceOf(resource);
      if (instance) byName.set(instance.name, instance);
    };
    ((await this.names.resources('ApplicationInstance', [])) ?? []).forEach(add);
    (await this.names.repoResources('ApplicationInstance')).forEach(add);
    return overlapsOf(subject, [...byName.values()]).flatMap(({ index, instance, resource }) => {
      const range = rangeIn(parsed, document, ['spec', 'resources', index, 'name']);
      const owner = instance === subject.name ? 'this instance' : instance;
      const message = `Overlaps ${resource.type} ${resource.name} (${resource.patternType}) owned by ${owner}.`;
      return range ? [problem(range, message, Severity.Warning)] : [];
    });
  }

  dispose(): void {
    this.listeners.forEach((l) => l.dispose());
    this.timers.forEach((t) => clearTimeout(t));
    this.collection.dispose();
  }
}

const Severity = vscode.DiagnosticSeverity;

function instanceOf(resource: Resource): Instance | undefined {
  const spec = isRecord(resource.spec) ? resource.spec : {};
  if (typeof spec.cluster !== 'string' || !Array.isArray(spec.resources)) return undefined;
  return {
    name: resource.metadata.name,
    cluster: spec.cluster,
    resources: spec.resources.filter(isRecord).map((r) => ({
      type: String(r.type),
      name: String(r.name ?? ''),
      patternType: patternTypeOf(r.patternType),
      ...(typeof r.connectCluster === 'string' && { connectCluster: r.connectCluster }),
    })),
  };
}

function rangeIn(
  parsed: ParsedDocument,
  document: vscode.TextDocument,
  path: (string | number)[],
): vscode.Range | undefined {
  const range = rangeOf(parsed.text, path);
  return (
    range &&
    new vscode.Range(document.positionAt(parsed.start + range[0]), document.positionAt(parsed.start + range[1]))
  );
}

function problem(range: vscode.Range, message: string, severity: vscode.DiagnosticSeverity): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, severity);
  diagnostic.source = 'Conduktor';
  return diagnostic;
}
