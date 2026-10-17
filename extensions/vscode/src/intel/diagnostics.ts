import * as vscode from 'vscode';

const SEVERITIES = {
  error: vscode.DiagnosticSeverity.Error,
  warning: vscode.DiagnosticSeverity.Warning,
  information: vscode.DiagnosticSeverity.Information,
} as const;

export function conduktorDiagnostic(
  range: vscode.Range,
  message: string,
  severity: keyof typeof SEVERITIES,
): vscode.Diagnostic {
  const diagnostic = new vscode.Diagnostic(range, message, SEVERITIES[severity]);
  diagnostic.source = 'Conduktor';
  return diagnostic;
}

/** The range between two offsets of a document that starts at `parsed.start` in its file. */
export function rangeIn(document: vscode.TextDocument, parsed: { start: number }, start: number, end: number) {
  return new vscode.Range(document.positionAt(parsed.start + start), document.positionAt(parsed.start + end));
}

/**
 * Diagnostics for the open YAML documents, each checked once it has stopped changing for a moment. Every one is checked
 * again on `recheckAllOn`, and on a change to any of them when `changeRechecksAll`.
 */
export function debouncedDiagnostics(
  name: string,
  check: (document: vscode.TextDocument, collection: vscode.DiagnosticCollection) => unknown,
  { recheckAllOn, changeRechecksAll = false }: { recheckAllOn: vscode.Event<unknown>[]; changeRechecksAll?: boolean },
): vscode.Disposable {
  const collection = vscode.languages.createDiagnosticCollection(name);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const schedule = (document: vscode.TextDocument) => {
    if (document.languageId !== 'yaml') return;
    const key = document.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => void check(document, collection), 300),
    );
  };
  const all = () => vscode.workspace.textDocuments.forEach((d) => schedule(d));
  const listeners = [
    vscode.workspace.onDidOpenTextDocument(schedule),
    vscode.workspace.onDidChangeTextDocument((e) =>
      changeRechecksAll ? e.document.languageId === 'yaml' && all() : schedule(e.document),
    ),
    vscode.workspace.onDidCloseTextDocument((d) => collection.delete(d.uri)),
    ...recheckAllOn.map((event) => event(all)),
  ];
  all();
  return new vscode.Disposable(() => {
    for (const l of listeners) l.dispose();
    timers.forEach((t) => clearTimeout(t));
    collection.dispose();
  });
}
