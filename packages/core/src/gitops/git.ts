/**
 * Where `git rev-parse --show-toplevel` says the repository is: its top level, nothing when there is none, or an error
 * for any other failure — a folder git refuses to trust is still inside a repository and must not get one of its own.
 */
export function gitTopLevel(result: { code: number | null; stdout: string; stderr: string }): {
  top?: string;
  error?: string;
} {
  if (result.code === 0) return { top: result.stdout.trim() };
  if (/not a git repository/i.test(result.stderr)) return {};
  return { error: `git failed: ${result.stderr.trim().split('\n')[0]}` };
}
