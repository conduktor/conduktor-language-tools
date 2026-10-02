export { syncPath } from './paths';
export { withSecretPlaceholders } from './placeholders';
export { isDrifted, syncStatus, type SyncStatus } from './status';

export interface SyncIndexEntry {
  kind: string;
  apiVersion: string;
  parents: string[];
  name: string;
  syncedAt: string;
}

export interface SyncIndex {
  version: 1;
  entries: Record<string, SyncIndexEntry>;
}
