/** dev can change the Console, after a confirmation; prod never does. */
export type ConnectionMode = 'dev' | 'prod';

/**
 * A stored mode, from before there were two as well: only `apply` (or `dev`) can change the Console. Anything else,
 * unknown values included, reads as prod, so an old setting never gains that power.
 */
export function migrateMode(stored: unknown): ConnectionMode {
  return stored === 'dev' || stored === 'apply' ? 'dev' : 'prod';
}

export function canChange(mode: ConnectionMode): boolean {
  return mode === 'dev';
}
