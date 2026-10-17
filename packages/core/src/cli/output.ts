export interface CliOutcome {
  kind: string;
  name: string;
  result: 'Created' | 'Updated' | 'NotChanged' | 'failed';
  message?: string;
}

// The lines ctl prints per resource (cmd/apply.go, pkg/client); a whole line each, so a diff line quoting one never
// matches.
const RESULT = /^([A-Za-z]+)\/(\S+): (Created|Updated|NotChanged)(?: \(dry-run\))?$/;
const APPLY_FAILED = /^Could not apply resource ([A-Za-z]+)\/(\S+): (.*)$/;

/** What ctl did to each resource, in the order it said so: results from stdout, then failures from stderr. */
export function readCliOutput(stdout: string, stderr: string): CliOutcome[] {
  const outcomes: CliOutcome[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [, kind, name, result] = RESULT.exec(line) ?? [];
    if (kind !== undefined && name !== undefined && result !== undefined)
      outcomes.push({ kind, name, result: result as CliOutcome['result'] });
  }
  for (const line of stderr.split(/\r?\n/)) {
    const [, kind, name, message] = APPLY_FAILED.exec(line) ?? [];
    if (kind !== undefined && name !== undefined && message !== undefined)
      outcomes.push({ kind, name, result: 'failed', message });
  }
  return outcomes;
}
