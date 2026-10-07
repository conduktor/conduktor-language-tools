import type { ConsoleClient } from '../client/consoleClient';
import type { KindCatalog } from '../openapi/kindCatalog';
import type { ResourceDocument } from '../resources/parseDocuments';
import { upsertDocuments, type UpsertItem, type UpsertOptions } from './upsertDocuments';

// Console's dry run cannot see what earlier steps of the same plan would create, so a dependent fails with a not-found
// or no-permission error that names the missing resource (`Group with id 'x' not found`, `… on app x`). Those are
// pending, not failures.
export async function planDocuments(
  client: Pick<ConsoleClient, 'upsert'>,
  catalog: KindCatalog,
  documents: readonly ResourceDocument[],
  options: Pick<UpsertOptions, 'readInclude' | 'onItem' | 'cancelled'> = {},
): Promise<UpsertItem[]> {
  const items = await upsertDocuments(client, catalog, documents, { ...options, dryRun: true });
  const willExist: string[] = [];
  return items.map((item) => {
    const { outcome } = item;
    const name = item.document.resource?.metadata.name;
    if (outcome.status === 'ok' && outcome.result === 'Created' && name) willExist.push(name);
    if (outcome.status !== 'error' || !WAITING_STATUSES.has(outcome.httpStatus ?? 0)) return item;
    const waitingFor = willExist.filter((created) => created !== name && mentions(outcome.message, created));
    if (waitingFor.length === 0) return item;
    if (name) willExist.push(name);
    return { ...item, outcome: { status: 'pending', message: outcome.message, waitingFor } };
  });
}

const WAITING_STATUSES = new Set([403, 404]);

function mentions(message: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w.-])${escaped}($|[^\\w.-])`).test(message);
}
