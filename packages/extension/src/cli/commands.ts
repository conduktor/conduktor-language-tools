import * as vscode from 'vscode';
import { canChange, rangeOf, readCliOutput, type CliOutcome } from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { CliRun, CliRunner } from './runner';

interface Ran {
  outcomes: CliOutcome[];
  run: CliRun;
  /** Kind/name of each resource whose file was removed: ctl leaves it on the Console. */
  removed: string[];
}

/** Plan and Apply an environment with ctl: a summary, failures as Problems on their files, and applied files marked. */
export function registerCliCommands(
  cli: CliRunner,
  sync: SyncFolder,
  sessions: SessionManager,
  confirm: Confirm,
): vscode.Disposable[] {
  const problems = vscode.languages.createDiagnosticCollection('conduktor-cli');

  const execute = async (action: 'plan' | 'apply'): Promise<Ran | undefined> => {
    const state = sessions.current();
    const env = sync.environment();
    if (state.status !== 'ready' || !env || !sync.syncRoot()) return undefined;
    let run: CliRun | undefined;
    try {
      run = await cli.run(action);
    } catch (error) {
      void vscode.window.showErrorMessage((error as Error).message);
      return undefined;
    }
    if (!run || run.cancelled) return undefined;
    // Results name files of the environment the run started in; after a switch they would land on another one's.
    if (sessions.current() !== state) {
      void vscode.window.showWarningMessage('The connection changed while ctl ran; its results are in the CLI panel.');
      return undefined;
    }
    const outcomes = readCliOutput(run.stdout, run.stderr);
    await showProblems(problems, sync, outcomes);
    if (action === 'apply') await sync.markAppliedFiles(appliedFiles(sync, outcomes));
    const removed = (await sync.removedFiles()).map((r) => `${r.kind}/${r.name}`);
    return { outcomes, run, removed };
  };

  const report = (action: 'plan' | 'apply', ran: Ran) => {
    const env = sync.environment();
    const left = ran.removed.length > 0 ? `; ${ran.removed.length} removed from the folder, left on the Console` : '';
    const summary = `${summarise(ran.outcomes) || 'nothing to do'}${left}`;
    const failed = ran.run.exitCode !== 0 || ran.outcomes.some((o) => o.result === 'failed');
    const reason = ran.run.exitCode !== 0 ? ` ${lastLine(ran.run.stderr)}` : '';
    const message = `${action === 'plan' ? 'Plan' : 'Apply'} of ${env}: ${summary}.${reason}`;
    const show = failed ? vscode.window.showErrorMessage : vscode.window.showInformationMessage;
    void show(message, 'Show Output').then((choice) => {
      if (choice) cli.channel.show();
    });
  };

  return [
    problems,
    vscode.commands.registerCommand('conduktor.planEnvironment', async () => {
      const ran = await execute('plan');
      if (ran) report('plan', ran);
      return ran?.outcomes;
    }),
    vscode.commands.registerCommand('conduktor.applyEnvironment', async () => {
      const state = sessions.current();
      const env = sync.environment();
      if (state.status !== 'ready' || !env) {
        void vscode.window.showWarningMessage('Connect to a Console and choose a sync folder first.');
        return undefined;
      }
      if (!canChange(state.connection.mode)) {
        void vscode.window.showWarningMessage(
          `${state.connection.name} is in prod mode; Plan shows what would change.`,
        );
        return undefined;
      }
      // Always a fresh plan first, so the confirmation says what this Apply will do.
      const plan = await execute('plan');
      if (!plan) return undefined;
      const choice = await confirm(
        `Apply environment ${env} to ${state.connection.name} with ctl?`,
        confirmation(plan.outcomes, plan.removed),
        'Apply',
      );
      if (choice !== 'Apply') return undefined;
      const ran = await execute('apply');
      if (ran) report('apply', ran);
      return ran?.outcomes;
    }),
  ];
}

function confirmation(outcomes: readonly CliOutcome[], removed: readonly string[]): string {
  const lines = [`Plan: ${summarise(outcomes) || 'nothing to do'}.`];
  if (removed.length > 0)
    lines.push(
      `Removed from the folder, left on the Console: ${list(removed)}. ctl deletes nothing; delete them on the ` +
        'Console if they should go.',
    );
  return lines.join('\n\n');
}

function list(names: readonly string[]): string {
  return names.length > 10 ? `${names.slice(0, 10).join(', ')} and ${names.length - 10} more` : names.join(', ');
}

function summarise(outcomes: readonly CliOutcome[]): string {
  const counts = new Map<string, number>();
  for (const { result } of outcomes) counts.set(result, (counts.get(result) ?? 0) + 1);
  const words: [CliOutcome['result'], string][] = [
    ['Created', 'created'],
    ['Updated', 'updated'],
    ['NotChanged', 'unchanged'],
    ['failed', 'failed'],
  ];
  return words
    .filter(([result]) => counts.has(result))
    .map(([result, word]) => `${counts.get(result)} ${word}`)
    .join(', ');
}

// ctl names a resource by kind and name only, so one in two clusters is every file that matches.
function filesFor(sync: SyncFolder, outcome: Pick<CliOutcome, 'kind' | 'name'>): vscode.Uri[] {
  return sync
    .list()
    .filter((entry) => entry.kind === outcome.kind && entry.name === outcome.name)
    .map((entry) => entry.uri);
}

// A kind and name is marked applied only when every file that has it got a success line and none failed: with twins
// in two clusters, one line cannot say which of them it was.
function appliedFiles(sync: SyncFolder, outcomes: readonly CliOutcome[]): vscode.Uri[] {
  const byName = new Map<string, { kind: string; name: string; ok: number; failed: boolean }>();
  for (const { kind, name, result } of outcomes) {
    const key = `${kind}/${name}`;
    const tally = byName.get(key) ?? { kind, name, ok: 0, failed: false };
    if (result === 'failed') tally.failed = true;
    else tally.ok++;
    byName.set(key, tally);
  }
  return [...byName.values()].flatMap((tally) => {
    const files = filesFor(sync, tally);
    return !tally.failed && tally.ok >= files.length ? files : [];
  });
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
