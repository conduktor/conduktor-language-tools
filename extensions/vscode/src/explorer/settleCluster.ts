export interface ClusterMemory<S> {
  isCurrent: (state: S) => boolean;
  remembered: (state: S) => string | undefined;
  remember: (state: S, cluster: string | undefined) => PromiseLike<void>;
  show: (cluster: string | undefined) => PromiseLike<void>;
}

// Keeps a remembered cluster only while it exists, and picks the only cluster there is. Listing takes a round trip, so
// a session that was replaced meanwhile settles nothing: its answer is not about the connection now in use.
export async function settleCluster<S>(
  state: S,
  names: () => Promise<string[]>,
  memory: ClusterMemory<S>,
): Promise<void> {
  let listed: string[];
  try {
    listed = await names();
  } catch {
    return;
  }
  if (!memory.isCurrent(state)) return;
  const remembered = memory.remembered(state);
  const cluster = remembered && listed.includes(remembered) ? remembered : listed.length === 1 ? listed[0] : undefined;
  if (cluster !== remembered) await memory.remember(state, cluster);
  if (memory.isCurrent(state)) await memory.show(cluster);
}
