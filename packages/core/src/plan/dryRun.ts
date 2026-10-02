import type { ConsoleClient } from '../client/consoleClient';
import { describeError } from '../client/errors';
import type { KindCatalog } from '../openapi/kindCatalog';
import { upsertTarget } from '../openapi/paths';
import { expandIncludes } from '../resources/includes';
import { sortForApply } from '../resources/ordering';
import type { ResourceDocument } from '../resources/parseDocuments';
import type { UpsertResult } from '../resources/types';

export type DryRunOutcome = { status: 'ok'; result: UpsertResult } | { status: 'error'; message: string };

export interface DryRunItem {
  document: ResourceDocument;
  outcome: DryRunOutcome;
}

export interface DryRunOptions {
  readInclude?: (path: string) => string;
}

export async function dryRunDocuments(
  client: Pick<ConsoleClient, 'upsert'>,
  catalog: KindCatalog,
  documents: readonly ResourceDocument[],
  options: DryRunOptions = {},
): Promise<DryRunItem[]> {
  const items: DryRunItem[] = [];
  for (const document of sortForApply(documents, catalog)) {
    items.push({ document, outcome: await dryRunOne(client, catalog, document, options) });
  }
  return items;
}

async function dryRunOne(
  client: Pick<ConsoleClient, 'upsert'>,
  catalog: KindCatalog,
  document: ResourceDocument,
  options: DryRunOptions,
): Promise<DryRunOutcome> {
  const { resource } = document;
  if (!resource) return { status: 'error', message: document.error ?? 'Not a Conduktor resource' };
  const kind = catalog.resolve(resource.apiVersion, resource.kind);
  if (!kind)
    return { status: 'error', message: `${resource.kind} ${resource.apiVersion} is not available on this Console` };
  try {
    const expanded = expandIncludes(resource, options.readInclude);
    const response = await client.upsert(upsertTarget(kind, expanded), expanded, { dryRun: true });
    return { status: 'ok', result: response.upsertResult };
  } catch (error) {
    return { status: 'error', message: describeError(error) };
  }
}
