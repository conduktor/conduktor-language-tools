import * as vscode from 'vscode';
import { rangeOf, readCliOutput, type CliOutcome } from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { CliRun, CliRunner } from './runner';

/** Plan and Apply an environment with ctl: a summary, failures as Problems on their files, and applied files marked. */
export function registerCliCommands(
  cli: CliRunner,
  sync: SyncFolder,
  sessions: SessionManager,
  confirm: Confirm,
): vscode.Disposable[] {
  const problems = vscode.languages.createDiagnosticCollection('conduktor-cli');
  let lastPlan: { env: string; outcomes: CliOutcome[] } | undefined;

  const run = async (action: 'plan' | 'apply'): Promise<CliOutcome[] | undefined> => {
    const env = sync.environment();
    let result: CliRun | undefined;
    try {
      result = await cli.run(action);
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
      return undefined;
    }
    if (!result || result.cancelled) return undefined;
    const outcomes = readCliOutput(result.stdout, result.stderr);
    await showProblems(problems, sync, outcomes);
    if (action === 'plan' && env) lastPlan = { env, outcomes };
    if (action === 'apply') {
      lastPlan = undefined;
      const applied = outcomes.filter(
        (o) => o.result === 'Created' || o.result === 'Updated' || o.result === 'NotChanged',
      );
      await sync.markAppliedFiles(applied.flatMap((o) => filesFor(sync, o)));
    }
    const summary = summarise(outcomes);
    const failed = result.exitCode !== 0 || outcomes.some((o) => o.result === 'failed');
    const message = `${action === 'plan' ? 'Plan' : 'Apply'} of ${env}: ${summary || 'nothing to do'}`;
    const show = failed ? vscode.window.showErrorMessage : vscode.window.showInformationMessage;
    void show(failed && !summary ? `${message}. ${lastLine(result.stderr)}` : message, 'Show Output').then((choice) => {
      if (choice) cli.channel.show();
    });
    return outcomes;
  };

  return [
    problems,
    vscode.commands.registerCommand('conduktor.planEnvironment', () => run('plan')),
    vscode.commands.registerCommand('conduktor.applyEnvironment', async () => {
      const state = sessions.current();
      const env = sync.environment();
      if (state.status !== 'ready' || !env) {
        void vscode.window.showWarningMessage('Connect to a Console and choose a sync folder first.');
        return undefined;
      }
      if (state.connection.mode !== 'apply') {
        void vscode.window.showWarningMessage(
          `${state.connection.name} is not in apply mode; Plan shows what would change.`,
        );
        return undefined;
      }
      const planned =
        lastPlan?.env === env ? `Last plan: ${summarise(lastPlan.outcomes) || 'nothing to do'}.` : 'Not planned yet.';
      const choice = await confirm(
        `Apply environment ${env} to ${state.connection.name} with ctl?`,
        `${planned} Files removed since the last apply are deleted on the Console.`,
        'Apply',
      );
      return choice === 'Apply' ? run('apply') : undefined;
    }),
  ];
}

function summarise(outcomes: readonly CliOutcome[]): string {
  const counts = new Map<string, number>();
  for (const { result } of outcomes) counts.set(result, (counts.get(result) ?? 0) + 1);
  const words: [CliOutcome['result'], string][] = [
    ['Created', 'created'],
    ['Updated', 'updated'],
    ['Deleted', 'deleted'],
    ['NotChanged', 'unchanged'],
    ['failed', 'failed'],
  ];
  return words
    .filter(([result]) => counts.has(result))
    .map(([result, word]) => `${counts.get(result)} ${word}`)
    .join(', ');
}

// ctl names a resource by kind and name only, so one in two clusters is every file that matches.
function filesFor(sync: SyncFolder, outcome: CliOutcome): vscode.Uri[] {
  return sync
    .list()
    .filter((entry) => entry.kind === outcome.kind && entry.name === outcome.name)
    .map((entry) => entry.uri);
}

async function showProblems(
  problems: vscode.DiagnosticCollection,
  sync: SyncFolder,
  outcomes: readonly CliOutcome[],
): Promise<void> {
  problems.clear();
  const byFile = new Map<string, { uri: vscode.Uri; diagnostics: vscode.Diagnostic[] }>();
  for (const outcome of outcomes.filter((o) => o.result === 'failed')) {
    for (const uri of filesFor(sync, outcome)) {
      const document = await vscode.workspace.openTextDocument(uri);
      const at = rangeOf(document.getText(), ['metadata', 'name']);
      const range = at
        ? new vscode.Range(document.positionAt(at[0]), document.positionAt(at[1]))
        : new vscode.Range(0, 0, 0, 0);
      const diagnostic = new vscode.Diagnostic(
        range,
        outcome.message ?? 'ctl could not apply it',
        vscode.DiagnosticSeverity.Error,
      );
      diagnostic.source = 'ctl';
      const entry = byFile.get(uri.toString()) ?? { uri, diagnostics: [] };
      entry.diagnostics.push(diagnostic);
      byFile.set(uri.toString(), entry);
    }
  }
  for (const { uri, diagnostics } of byFile.values()) problems.set(uri, diagnostics);
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1) ?? '';
}
