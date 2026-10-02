import type { ConsoleClient } from '../client/consoleClient';
import { ConsoleError, describeError } from '../client/errors';
import type { KindCatalog } from '../openapi/kindCatalog';
import { upsertTarget } from '../openapi/paths';
import { expandIncludes } from '../resources/includes';
import { sortForApply } from '../resources/ordering';
import type { ResourceDocument } from '../resources/parseDocuments';
import type { UpsertResult } from '../resources/types';

export type UpsertOutcome =
  | { status: 'ok'; result: UpsertResult }
  | { status: 'error'; message: string; httpStatus?: number }
  | { status: 'pending'; message: string; waitingFor: string[] }
  | { status: 'skipped' };

export interface UpsertItem {
  document: ResourceDocument;
  outcome: UpsertOutcome;
}

// Given the document too, since documents applied together can come from files in different folders.
export type ReadInclude = (path: string, document: ResourceDocument) => string;

export interface UpsertOptions {
  dryRun: boolean;
  stopOnError?: boolean;
  readInclude?: ReadInclude;
}

export async function upsertDocuments(
  client: Pick<ConsoleClient, 'upsert'>,
  catalog: KindCatalog,
  documents: readonly ResourceDocument[],
  options: UpsertOptions,
): Promise<UpsertItem[]> {
  const items: UpsertItem[] = [];
  let stopped = false;
  for (const document of sortForApply(documents, catalog)) {
    const outcome: UpsertOutcome = stopped
      ? { status: 'skipped' }
      : await upsertOne(client, catalog, document, options);
    stopped ||= options.stopOnError === true && outcome.status === 'error';
    items.push({ document, outcome });
  }
  return items;
}

async function upsertOne(
  client: Pick<ConsoleClient, 'upsert'>,
  catalog: KindCatalog,
  document: ResourceDocument,
  options: UpsertOptions,
): Promise<UpsertOutcome> {
  const { resource } = document;
  if (!resource) return { status: 'error', message: document.error ?? 'Not a Conduktor resource' };
  const kind = catalog.resolve(resource.apiVersion, resource.kind);
  if (!kind)
    return { status: 'error', message: `${resource.kind} ${resource.apiVersion} is not available on this Console` };
  try {
    const { readInclude } = options;
    const expanded = expandIncludes(resource, readInclude && ((path) => readInclude(path, document)));
    const response = await client.upsert(upsertTarget(kind, expanded), expanded, { dryRun: options.dryRun });
    return { status: 'ok', result: response.upsertResult };
  } catch (error) {
    const httpStatus = error instanceof ConsoleError ? error.status : undefined;
    return { status: 'error', message: describeError(error), ...(httpStatus && { httpStatus }) };
  }
}
