import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as vscode from 'vscode';
import {
  leftState,
  planWarnings,
  rangeOf,
  readCliOutput,
  STATE_DIR,
  type CliOutcome,
  type StateResource,
} from '@conduktor/vscode-core';
import type { Confirm } from '../confirm';
import type { SessionManager } from '../connections/session';
import type { SyncFolder } from '../sync/syncFolder';
import type { CliRun, CliRunner } from './runner';

interface Ran {
  outcomes: CliOutcome[];
  run: CliRun;
  deleted: StateResource[];
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
    const syncRoot = sync.syncRoot();
    if (state.status !== 'ready' || !env || !syncRoot) return undefined;
    const statePath = join(syncRoot.fsPath, STATE_DIR, 'state', `${env}.json`);
    const before = action === 'apply' ? readText(statePath) : undefined;
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
    // ctl prints nothing for a delete outside a dry run; what left its state is what it deleted.
    const deleted = action === 'apply' ? leftState(before, readText(statePath), state.spec.catalog) : [];
    if (action === 'apply') await sync.markAppliedFiles(appliedFiles(sync, outcomes), deleted);
    return { outcomes, run, deleted };
  };

  const report = (action: 'plan' | 'apply', ran: Ran) => {
    const env = sync.environment();
    const summary = summarise(ran.outcomes, ran.deleted.length);
    const failed = ran.run.exitCode !== 0 || ran.outcomes.some((o) => o.result === 'failed');
    const reason = ran.run.exitCode !== 0 ? ` ${lastLine(ran.run.stderr)}` : '';
    const message = `${action === 'plan' ? 'Plan' : 'Apply'} of ${env}: ${summary || 'nothing to do'}.${reason}`;
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
      if (state.connection.mode !== 'apply') {
        void vscode.window.showWarningMessage(
          `${state.connection.name} is not in apply mode; Plan shows what would change.`,
        );
        return undefined;
      }
      // Always a fresh plan first: ctl's deletes are only visible in a dry run, and some are not what they seem.
      const plan = await execute('plan');
      if (!plan) return undefined;
      const choice = await confirm(
        `Apply environment ${env} to ${state.connection.name} with ctl?`,
        confirmation(plan.outcomes),
        'Apply',
      );
      if (choice !== 'Apply') return undefined;
      const ran = await execute('apply');
      if (ran) report('apply', ran);
      return ran?.outcomes;
    }),
  ];
}

function confirmation(outcomes: readonly CliOutcome[]): string {
  const { deleted, recreated } = planWarnings(outcomes);
  const lines = [`Plan: ${summarise(outcomes, 0) || 'nothing to do'}.`];
  if (recreated.length > 0)
    lines.push(
      `Deleted and created again, losing their data: ${list(recreated)}. ctl matches what it applied by all of a ` +
        'resource’s metadata, so a changed description or a first label reads as a different resource.',
    );
  const plain = deleted.filter((name) => !recreated.includes(name));
  if (plain.length > 0) lines.push(`Deleted on the Console (their files were removed): ${list(plain)}.`);
  return lines.join('\n\n');
}

function list(names: readonly string[]): string {
  return names.length > 10 ? `${names.slice(0, 10).join(', ')} and ${names.length - 10} more` : names.join(', ');
}

function summarise(outcomes: readonly CliOutcome[], deletes: number): string {
  const counts = new Map<string, number>();
  for (const { result } of outcomes) counts.set(result, (counts.get(result) ?? 0) + 1);
  if (deletes > 0) counts.set('Deleted', deletes);
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
    if (result === 'Deleted') continue;
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

function readText(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
}

function lastLine(text: string): string {
  return text.trim().split(/\r?\n/).at(-1) ?? '';
}
