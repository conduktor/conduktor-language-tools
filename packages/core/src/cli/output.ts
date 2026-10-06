export interface CliOutcome {
  kind: string;
  name: string;
  result: 'Created' | 'Updated' | 'NotChanged' | 'Deleted' | 'failed';
  message?: string;
}

// The lines ctl prints per resource (cmd/apply.go, internal/cli/delete.go, pkg/client); a whole line each, so a diff
// line quoting one never matches.
const RESULT = /^([A-Za-z]+)\/(\S+): (Created|Updated|NotChanged|Deleted)(?: \(dry-run\))?$/;
const APPLY_FAILED = /^Could not apply resource ([A-Za-z]+)\/(\S+): (.*)$/;
const DELETE_FAILED = /^Could not delete resource ([A-Za-z]+)\/(\S+) missing from state: (.*)$/;

/** What ctl did to each resource, in the order it said so: results from stdout, then failures from stderr. */
export function readCliOutput(stdout: string, stderr: string): CliOutcome[] {
  const outcomes: CliOutcome[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const result = RESULT.exec(line);
    if (result) outcomes.push({ kind: result[1]!, name: result[2]!, result: result[3] as CliOutcome['result'] });
  }
  for (const line of stderr.split(/\r?\n/)) {
    const applied = APPLY_FAILED.exec(line);
    const deleted = DELETE_FAILED.exec(line);
    if (applied) outcomes.push({ kind: applied[1]!, name: applied[2]!, result: 'failed', message: applied[3]! });
    else if (deleted)
      outcomes.push({
        kind: deleted[1]!,
        name: deleted[2]!,
        result: 'failed',
        message: `Could not delete it: ${deleted[3]}`,
      });
  }
  return outcomes;
}
