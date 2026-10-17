import * as vscode from 'vscode';
import { parsedDocuments, referenceProblems, type NameLookup } from '@conduktor/core';
import type { SessionManager } from '../connections/session';
import { conduktorDiagnostic, debouncedDiagnostics, rangeIn } from './diagnostics';
import type { Names } from './names';

/** Where core's reference problems find names: the repository and the Console. */
export function nameLookup(names: Names): NameLookup {
  return {
    lookup: (kind, parents) => names.lookup(kind, parents),
    instances: async () => [
      ...((await names.resources('ApplicationInstance', [])) ?? []),
      ...(await names.repoDocuments('ApplicationInstance')).map((document) => document.resource),
    ],
  };
}

export function referenceDiagnostics(sessions: SessionManager, names: Names): vscode.Disposable {
  const lookup = nameLookup(names);
  const check = async (document: vscode.TextDocument, collection: vscode.DiagnosticCollection) => {
    const state = sessions.current();
    if (state.status !== 'ready') {
      collection.delete(document.uri);
      return;
    }
    const text = document.getText();
    const diagnostics: vscode.Diagnostic[] = [];
    for (const parsed of parsedDocuments(text, state.spec.catalog)) {
      if (!parsed.resource) continue;
      const problems = await referenceProblems(
        parsed.text,
        parsed.resource,
        state.spec.catalog,
        state.connection.name,
        lookup,
      );
      for (const { start, end, message, severity } of problems)
        diagnostics.push(conduktorDiagnostic(rangeIn(document, parsed, start, end), message, severity));
    }
    if (!document.isClosed && document.getText() === text) collection.set(document.uri, diagnostics);
  };
  // A change in one document can resolve or break references in the others.
  return debouncedDiagnostics('conduktor-references', check, {
    recheckAllOn: [sessions.onDidChange, names.onDidChange],
    changeRechecksAll: true,
  });
}
